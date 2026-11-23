import { Router } from 'express';
import type { SessionId } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import { devSid } from '@foundation/dev-sid.js';
import { devDomain, devHostname, signDevTicket } from './dev-host.js';

export interface DevServerRoutesDeps {
  sessions: SessionRepository;
  tracks: TrackRepository;
}

export function createDevServerRoutes(deps: DevServerRoutesDeps): Router {
  const router = Router();

  router.get('/sessions/:sessionId/dev-server', (req, res) => {
    const domain = devDomain();
    const session = domain ? deps.sessions.findById(req.params.sessionId as SessionId) : null;
    const track = session && !session.deletedAt ? deps.tracks.findById(session.trackId) : null;
    if (!domain || !session || !track?.devCommand) {
      res.json({ url: null });
      return;
    }
    const proto = req.get('x-forwarded-proto')?.split(',')[0].trim() || req.protocol;
    const ticket = signDevTicket(devSid(session.id), 60);
    res.json({ url: `${proto}://${devHostname(track.name, session.id, domain)}/__workshop/auth?t=${ticket}` });
  });

  return router;
}
