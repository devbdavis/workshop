import { WebSocket } from 'ws';
import type { TrackId } from '@foundation/types';

type EventType = 'track:updated' | 'track:created' | 'track:deleted' | 'session:created' | 'session:updated' | 'session:deleted' | 'session:idle-alert' | 'session:ready' | 'summary:updated' | 'todo:created' | 'todo:updated' | 'todo:deleted' | 'todo:dispatched' |'scheduled-task:created' | 'scheduled-task:updated' | 'scheduled-task:deleted' | 'scheduled-task:triggered' | 'scheduled-task:failed' | 'workflow:created' | 'workflow:updated' | 'workflow:deleted' | 'workflow:transitioned' | 'workflow:approved' | 'workflow:rejected' | 'workflow:progress' | 'workflow:dispatched' | 'discussion:created' | 'discussion:updated' | 'discussion:message' | 'discussion:vote' | 'discussion:consensus' | 'discussion:closed'
| 'workflow:terminal' | 'mcp-config:updated' | 'plugin:updated' | 'pr:updated';

interface WorkshopEvent {
  type: EventType;
  trackId: string;
  timestamp: string;
  [key: string]: unknown;
}

const clients = new Set<WebSocket>();

export function addEventClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcast(type: EventType, trackId: TrackId | string, payload?: Record<string, unknown>): void {
  const event: WorkshopEvent = {
    type,
    trackId,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}
