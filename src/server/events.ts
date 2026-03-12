import { WebSocket } from 'ws';
import type { TrackId } from '@foundation/types';

type EventType = 'track:updated' | 'track:created' | 'track:deleted' | 'session:created' | 'session:updated' | 'session:deleted' | 'summary:updated' | 'todo:created' | 'todo:updated' | 'todo:deleted' | 'todo:dispatched' | 'permission:requested' | 'permission:resolved';

interface WorkshopEvent {
  type: EventType;
  trackId: string;
  timestamp: string;
}

const clients = new Set<WebSocket>();

export function addEventClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function broadcast(type: EventType, trackId: TrackId | string): void {
  const event: WorkshopEvent = {
    type,
    trackId,
    timestamp: new Date().toISOString(),
  };
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}
