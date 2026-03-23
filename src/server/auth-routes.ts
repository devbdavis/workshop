/**
 * Auth endpoints for Workshop.
 *
 * POST /api/auth/login   — exchange token for a session cookie
 * GET  /api/auth/status  — check if the current request is authenticated
 * POST /api/auth/logout  — clear the session cookie
 */

import { Router } from 'express';
import { extractToken, validateToken } from './auth-middleware.js';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function createAuthRoutes(): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    const { token } = req.body as { token?: string };
    if (!token || !validateToken(token)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    res.cookie('workshop_token', token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: ONE_YEAR_SECONDS * 1000, // express uses milliseconds
    });
    res.json({ ok: true });
  });

  router.get('/status', (req, res) => {
    const token = extractToken(req);
    res.json({ authenticated: validateToken(token) });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie('workshop_token', { path: '/' });
    res.json({ ok: true });
  });

  return router;
}
