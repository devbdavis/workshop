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

/**
 * Custom OSC 8 link handler. Without this, xterm.js's `defaultActivate`
 * (in `OscLinkProvider.ts`) pops a `confirm("...WARNING: This link could
 * potentially be dangerous")` dialog on every click. tmux now passes OSC 8
 * through to xterm (see `ensureTmuxHyperlinks` in terminal/manager.ts), so
 * Claude's markdown links would all hit that dialog.
 *
 * We open in a new tab with `noopener,noreferrer` so the popup can't reach
 * back into Workshop via `window.opener`. xterm's built-in URL-protocol
 * filter (which restricts to http/https unless `allowNonHttpProtocols` is
 * set) still applies upstream of this handler.
 */
const LINK_HANDLER = {
  activate(_event: MouseEvent, uri: string) {
    window.open(uri, '_blank', 'noopener,noreferrer');
  },
};

const IS_MAC =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform);
const IS_WINDOWS =
  typeof navigator !== 'undefined' && /win/i.test(navigator.platform) && !IS_MAC;
/** Anything that isn't Mac or Windows we treat as Linux/BSD. */
const IS_LINUX = !IS_MAC && !IS_WINDOWS;

/**
 * Strip trailing whitespace from each line of a terminal selection.
 *
 * xterm.js's `getSelection()` returns intermediate lines padded with the
 * space cells that happen to sit between the last printed glyph and the
 * right edge of the selection — so copying multiple lines yanks in a
 * column of trailing blanks along with the actual content.  We trim
 * spaces/tabs per line but preserve line breaks (CR, LF, CRLF) so the
 * shape of the selection survives.
 */
function trimTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+(\r\n|\r|\n|$)/g, '$1');
}

/**
 * Write text to the system clipboard.  Prefers the async Clipboard API when
 * available, but falls back to a hidden-textarea + `execCommand('copy')` —
 * the async API silently fails when the document loses transient focus
 * between keystrokes, which manifested as "Cmd+C only works once" on macOS
 * Chrome.  Both paths restore the previously focused element so the next
 * keystroke still lands in the terminal.
 */
function writeToClipboard(text: string): void {
  const previousFocus = document.activeElement as HTMLElement | null;
  const restoreFocus = () => {
    if (previousFocus && typeof previousFocus.focus === 'function' && document.activeElement !== previousFocus) {
      previousFocus.focus();
    }
  };

  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(ta);
    restoreFocus();
  };

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(restoreFocus).catch(fallback);
  } else {
    fallback();
  }
}

/**
 * Copy/paste key handling.
 *
 * Modifiers per platform:
 * - macOS: Cmd (Meta) — the OS standard.
 * - Linux: Ctrl+Shift OR Alt — Konsole/gnome-terminal use Ctrl+Shift, but Alt
 *   is widely used in terminal emulators and Linux browsers don't eat Alt+V
 *   as a menu accelerator the way Windows does.
 * - Windows: Ctrl+Shift only — Alt is reserved by the OS/browser for menu
 *   accelerators (Alt+V opens the View menu / context popup), so we don't
 *   bind it there.
 *
 * Plus Shift+Insert pastes on every platform (X11 convention).
 * Plain Ctrl+C must always pass through as SIGINT.
 *
 * Paste implementation note: we deliberately do NOT call
 * `navigator.clipboard.readText()` here. That API triggers Chrome's
 * clipboard permission prompt on Linux (the small popup that appeared
 * "for 3 seconds" before the paste went through). Instead, we return
 * `false` from the custom key handler — which makes xterm.js skip its
 * own keystroke processing (so we don't get a stray ^V written to the
 * shell) — but we deliberately do NOT call `preventDefault()`. That lets
 * the browser's native paste action proceed: it fires a `paste` event
 * on xterm.js's hidden textarea, and xterm.js's own paste handler
 * (handlePasteEvent in browser/Clipboard.ts) reads `clipboardData`
 * synchronously — no permission prompt — and feeds the text into the
 * terminal via the core data event, including bracketed-paste mode and
 * CRLF normalisation.  The previous "double paste" hazard doesn't apply
 * because we no longer have two competing paste paths.
 *
 * Returns true if the event should continue to xterm.js, false to consume it.
 */
function handleClipboardKey(
  term: Terminal,
  event: KeyboardEvent,
  _ws: WebSocket,
): boolean {
  if (event.type !== 'keydown') return true;

  const copyModifier = IS_MAC
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : (event.ctrlKey && event.shiftKey && !event.altKey)
      // Alt+C / Alt+V on Linux only — Windows treats Alt as menu accelerator.
      || (IS_LINUX && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey);
  const key = event.key.toLowerCase();

  if (copyModifier && key === 'c') {
    if (!term.hasSelection()) return true; // nothing selected — let it fall through
    const selection = trimTrailingWhitespace(term.getSelection());
    event.preventDefault();
    event.stopPropagation();
    writeToClipboard(selection);
    return false;
  }

  if ((copyModifier && key === 'v') || (event.shiftKey && event.key === 'Insert')) {
    // Skip xterm.js processing (avoids ^V being written to the shell) but
    // do NOT preventDefault — let the browser's native paste action fire,
    // which dispatches a `paste` event on the textarea that xterm.js's
    // own handler picks up. See the function-level comment for the full
    // rationale.
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
      linkHandler: LINK_HANDLER,
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

    // ── Native copy: rewrite clipboard data to drop trailing whitespace ──
    // Catches right-click → Copy, Edit menu → Copy, and anything else that
    // dispatches a real `copy` event on xterm.js's hidden textarea
    // (keyboard shortcuts go through handleClipboardKey instead).  Reads
    // the selection from whichever terminal is active — scrollback if
    // present, live otherwise.
    const copyHandler = (event: ClipboardEvent) => {
      const activeTerm = scrollbackRef.current?.term ?? term;
      if (!activeTerm.hasSelection()) return;
      const trimmed = trimTrailingWhitespace(activeTerm.getSelection());
      event.clipboardData?.setData('text/plain', trimmed);
      event.preventDefault();
    };
    container.addEventListener('copy', copyHandler, { capture: true });

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
        linkHandler: LINK_HANDLER,
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
        // Clipboard shortcuts work identically to live mode.  For paste,
        // the browser's native paste action fires a `paste` event on the
        // scrollback terminal's textarea — xterm.js's paste handler picks
        // it up and triggers `onData` (below), which calls exitScrollback()
        // and forwards the text to the shell.  We deliberately do NOT
        // exitScrollback() here in the keydown handler: that would dispose
        // the scrollback terminal before the paste event has a chance to
        // fire, and the paste would be lost.
        if (!handleClipboardKey(scrollTerm, event, ws)) return false;
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
      container.removeEventListener('copy', copyHandler, true);
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
