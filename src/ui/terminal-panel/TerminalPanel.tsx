import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

/** Shared terminal theme — keeps live and scrollback visually identical. */
const THEME = {
  background: '#0a0a0a',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  selectionBackground: '#334155',
} as const;

const IS_MAC =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform);

/**
 * Copy/paste key handling.  Ctrl+C must stay as SIGINT, so non-Mac platforms
 * use the Windows Terminal / VSCode convention: Ctrl+Shift+C / Ctrl+Shift+V.
 * Alt+C / Alt+V also work on non-Mac as a closer analogue to Mac's Cmd+C.
 * Mac keeps the native Cmd+C / Cmd+V (Alt is Option there — reserved for
 * character input and Option-click selection).  Shift+Insert pastes everywhere.
 *
 * On paste we call `event.preventDefault()` — otherwise the browser still
 * fires its native `paste` event on xterm.js's hidden textarea, xterm sends
 * the clipboard a second time via onData, and the user sees a double paste.
 * This is most visible on macOS Cmd+V, but the same race exists anywhere the
 * browser treats the keystroke as a native paste shortcut.
 *
 * Returns true if the event should continue to xterm.js, false to consume it.
 */
function handleClipboardKey(
  term: Terminal,
  event: KeyboardEvent,
  ws: WebSocket,
): boolean {
  if (event.type !== 'keydown') return true;

  const copyModifier = IS_MAC
    ? event.metaKey && !event.ctrlKey
    : (event.ctrlKey && event.shiftKey) || (event.altKey && !event.ctrlKey && !event.shiftKey);
  const key = event.key.toLowerCase();

  if (copyModifier && key === 'c') {
    const selection = term.getSelection();
    if (!selection) return true; // nothing selected — let it fall through
    event.preventDefault();
    void navigator.clipboard.writeText(selection).catch(() => { /* ignore */ });
    return false;
  }

  if ((copyModifier && key === 'v') || (event.shiftKey && event.key === 'Insert')) {
    event.preventDefault();
    void navigator.clipboard.readText().then((text) => {
      if (text && ws.readyState === WebSocket.OPEN) ws.send(text);
    }).catch(() => { /* clipboard blocked — ignore */ });
    return false;
  }

  return true;
}

interface Props {
  trackId: string;
  sessionId: string;
  autoFocus?: boolean;
  focusTrigger?: number;
}

interface ScrollbackState {
  term: Terminal;
  fitAddon: FitAddon;
  overlay: HTMLDivElement;
  autoExitEnabled: boolean;
  autoExitTimer: ReturnType<typeof setTimeout>;
}

export function TerminalPanel({ trackId, sessionId, autoFocus, focusTrigger }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const scrollbackRef = useRef<ScrollbackState | null>(null);
  const captureInFlightRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Live terminal (tmux attach — runs on the alternate screen) ────
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 1000,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
      theme: THEME,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    fitAddon.fit();
    if (autoFocus) term.focus();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.attachCustomKeyEventHandler((event) => handleClipboardKey(term, event, ws));

    // ── WebSocket ─────────────────────────────────────────────────────
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/tracks/${trackId}/sessions/${sessionId}/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const raw = event.data as string;

      // Server control messages are prefixed with \x00
      if (raw.charCodeAt(0) === 0) {
        try {
          const ctrl = JSON.parse(raw.slice(1));
          if (ctrl.type === 'scrollback') showScrollback(ctrl.content, ctrl.scrollLines);
        } catch { /* bad json — ignore */ }
        return;
      }

      term.write(raw);
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33m[Session disconnected]\x1b[0m\r\n');
    };

    term.onData((data) => {
      captureInFlightRef.current = false; // cancel any pending capture
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // ── Scroll: capture-phase handler ─────────────────────────────────
    // Fires before xterm.js sees the event.  In normal mode, scroll-up
    // requests a pane capture from the server.  In scrollback mode, we
    // let xterm.js handle native scrolling (except scroll-down-at-bottom
    // which exits scrollback).
    const wheelHandler = (e: WheelEvent) => {
      const sb = scrollbackRef.current;

      if (sb) {
        // Scrollback mode — auto-exit when scrolling down at the bottom
        if (e.deltaY > 0 && sb.autoExitEnabled) {
          const buf = sb.term.buffer.active;
          if (buf.viewportY >= buf.baseY) {
            e.preventDefault();
            e.stopPropagation();
            exitScrollback();
          }
        }
        return; // xterm.js handles normal scrollback scrolling
      }

      // Live mode — ALWAYS block wheel events.  tmux uses the alternate
      // screen so xterm.js has no scrollback to scroll; unblocked events
      // get converted to arrow keys and thrash the shell input line.
      e.preventDefault();
      e.stopPropagation();

      if (e.deltaY < 0 && !captureInFlightRef.current) {
        captureInFlightRef.current = true;
        const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 30));
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'capture-scrollback', scrollLines: lines }));
        } else {
          captureInFlightRef.current = false;
        }
      }
    };
    container.addEventListener('wheel', wheelHandler, { passive: false, capture: true });

    // ── Scrollback overlay ────────────────────────────────────────────
    function showScrollback(content: string, scrollLines: number) {
      if (!captureInFlightRef.current || !container) return; // stale/cancelled
      captureInFlightRef.current = false;
      if (scrollbackRef.current) return; // already active

      // Create overlay that covers the live terminal
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:10;';
      container.appendChild(overlay);

      const scrollTerm = new Terminal({
        cursorBlink: false,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        scrollback: 50000,
        theme: THEME,
      });
      const scrollFit = new FitAddon();
      scrollTerm.loadAddon(scrollFit);
      scrollTerm.open(overlay);
      scrollFit.fit();

      // Enable auto-exit-on-scroll-to-bottom after a short delay so the
      // initial programmatic scroll-up doesn't immediately trigger exit.
      const timer = setTimeout(() => {
        if (scrollbackRef.current) scrollbackRef.current.autoExitEnabled = true;
      }, 300);

      scrollbackRef.current = {
        term: scrollTerm,
        fitAddon: scrollFit,
        overlay,
        autoExitEnabled: false,
        autoExitTimer: timer,
      };

      // Write captured pane content, then scroll up to the requested offset
      scrollTerm.write(content.replace(/\r?\n/g, '\r\n'), () => {
        scrollTerm.scrollLines(-scrollLines);
        scrollTerm.focus();
      });

      // Keyboard: arrows/pgup/pgdown navigate, Escape exits, typing exits + forwards
      scrollTerm.attachCustomKeyEventHandler((event) => {
        // Clipboard shortcuts work identically to live mode.  Paste exits
        // scrollback (handleClipboardKey sends the text via `ws`, which the
        // shell will render once we close the overlay).
        if (!handleClipboardKey(scrollTerm, event, ws)) {
          if (event.type === 'keydown' && (event.key === 'v' || event.key === 'V' || event.key === 'Insert')) {
            exitScrollback();
          }
          return false;
        }
        if (event.type !== 'keydown') return true;
        switch (event.key) {
          case 'PageUp':   scrollTerm.scrollPages(-1); return false;
          case 'PageDown':  scrollTerm.scrollPages(1);  return false;
          case 'ArrowUp':   scrollTerm.scrollLines(-3);  return false;
          case 'ArrowDown': scrollTerm.scrollLines(3);   return false;
          case 'Home':      scrollTerm.scrollToTop();     return false;
          case 'End':       scrollTerm.scrollToBottom();  return false;
          case 'Escape':    exitScrollback();              return false;
          default:          return true; // falls through to onData
        }
      });

      // Any printable / control keystroke exits scrollback and forwards to the shell
      scrollTerm.onData((data) => {
        if (data.startsWith('\x1b')) return; // remaining escape sequences — ignore
        exitScrollback();
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });
    }

    function exitScrollback() {
      const sb = scrollbackRef.current;
      if (!sb) return;
      clearTimeout(sb.autoExitTimer);
      sb.term.dispose();
      sb.overlay.remove();
      scrollbackRef.current = null;
      term.focus();
    }

    // ── Resize ────────────────────────────────────────────────────────
    let disposed = false;
    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      fitAddon.fit();
      scrollbackRef.current?.fitAddon.fit();
    });
    resizeObserver.observe(container);

    // ── Cleanup ───────────────────────────────────────────────────────
    return () => {
      disposed = true;
      exitScrollback();
      container.removeEventListener('wheel', wheelHandler, true);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [trackId, sessionId]);

  // Focus pulse — separate effect to avoid recreating the terminal.
  useEffect(() => {
    if (!focusTrigger) return;
    termRef.current?.focus();
  }, [focusTrigger]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative"
      onClick={() => termRef.current?.focus()}
    />
  );
}
