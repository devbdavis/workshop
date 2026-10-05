import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SessionId, TrackId } from '@foundation/types';
import { loadPrefs, playPing, unlockAudio } from './prefs';
import { AlertChips } from './AlertChips';

export interface SessionAlert {
  id: string;
  kind: 'needs-input' | 'idle';
  trackId: TrackId;
  sessionId: SessionId;
  sessionName: string | undefined;
  timestamp: string;
}

interface SessionAlertsContextValue {
  unread: SessionAlert[];
  open: (alert: SessionAlert) => void;
  clearAll: () => void;
}

const SessionAlertsContext = createContext<SessionAlertsContextValue | undefined>(undefined);

export function useSessionAlerts(): SessionAlertsContextValue {
  const ctx = useContext(SessionAlertsContext);
  if (!ctx) throw new Error('useSessionAlerts must be used within SessionAlertsProvider');
  return ctx;
}

function alertUrl(alert: SessionAlert): string {
  return `/tracks/${alert.trackId}?session=${alert.sessionId}`;
}

function alertTitle(alert: SessionAlert): string {
  const who = alert.sessionName ?? `Session ${alert.sessionId.slice(0, 8)}`;
  return alert.kind === 'needs-input' ? `${who} needs input` : `${who} is idle`;
}

export function SessionAlertsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<SessionAlert[]>([]);
  const [chips, setChips] = useState<SessionAlert[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  // Read inside the WS handler without retriggering the socket effect on every navigation.
  const locationRef = useRef(location);
  locationRef.current = location;

  const open = useCallback((alert: SessionAlert) => {
    setUnread((prev) => prev.filter((a) => a.sessionId !== alert.sessionId));
    setChips((prev) => prev.filter((a) => a.id !== alert.id));
    navigate(alertUrl(alert));
  }, [navigate]);

  const dismissChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setUnread([]);
  }, []);

  // Clear unread for the track being viewed once it's actually visible/focused.
  useEffect(() => {
    const match = location.pathname.match(/^\/tracks\/([^/]+)$/);
    if (!match) return;
    const trackId = match[1];
    function clearIfLooking() {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        setUnread((prev) => prev.filter((a) => a.trackId !== trackId));
      }
    }
    clearIfLooking();
    document.addEventListener('visibilitychange', clearIfLooking);
    window.addEventListener('focus', clearIfLooking);
    return () => {
      document.removeEventListener('visibilitychange', clearIfLooking);
      window.removeEventListener('focus', clearIfLooking);
    };
  }, [location.pathname]);

  // Pings fire from background tabs, so the AudioContext must be unlocked on an earlier gesture.
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  useEffect(() => {
    document.title = unread.length > 0 ? `(${unread.length}) Workshop` : 'Workshop';
  }, [unread.length]);

  // Single events socket for the whole app, auto-reconnecting like TrackView's.
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as {
            type: string;
            trackId: string;
            sessionId?: string;
            sessionName?: string;
            timestamp?: string;
          };
          if (event.type !== 'session:needs-input' && event.type !== 'session:idle-alert') return;
          if (!event.sessionId) return;

          const prefs = loadPrefs();
          if (event.type === 'session:idle-alert' && !prefs.idle) return;

          const alert: SessionAlert = {
            id: `${event.sessionId}-${Date.now()}`,
            kind: event.type === 'session:needs-input' ? 'needs-input' : 'idle',
            trackId: event.trackId as TrackId,
            sessionId: event.sessionId as SessionId,
            sessionName: event.sessionName,
            timestamp: event.timestamp ?? new Date().toISOString(),
          };

          const looking =
            document.visibilityState === 'visible' &&
            document.hasFocus() &&
            locationRef.current.pathname === `/tracks/${alert.trackId}`;

          if (!looking) {
            setUnread((prev) => [...prev.filter((a) => a.sessionId !== alert.sessionId), alert]);
            if (prefs.sound) playPing(prefs.volume);
            if (prefs.system && 'Notification' in window && Notification.permission === 'granted') {
              try {
                const n = new Notification(alertTitle(alert), {
                  body: alert.kind === 'needs-input' ? 'Waiting for your input' : 'Idle after working',
                  tag: alert.sessionId,
                });
                n.onclick = () => {
                  window.focus();
                  open(alert);
                  n.close();
                };
              } catch {
                // Notification can throw on mobile Chrome without a service worker — fine to skip
              }
            }
          }

          if (prefs.chip) {
            setChips((prev) => [...prev.filter((a) => a.sessionId !== alert.sessionId), alert]);
            setTimeout(() => dismissChip(alert.id), 30_000);
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 2_000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [open, dismissChip]);

  return (
    <SessionAlertsContext.Provider value={{ unread, open, clearAll }}>
      {children}
      <AlertChips chips={chips} onOpen={open} onDismiss={dismissChip} />
    </SessionAlertsContext.Provider>
  );
}
