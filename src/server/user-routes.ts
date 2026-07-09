/**
 * Profile + per-user settings endpoints (lightweight multi-user layer).
 *
 *   GET    /api/users              — list profiles
 *   POST   /api/users              — create a profile { name, color? }
 *   PATCH  /api/users/:id          — rename / recolor a profile
 *   DELETE /api/users/:id          — remove a profile
 *   GET    /api/me                 — resolve the active profile from the cookie
 *   PUT    /api/me/profile         — select the active profile (sets cookie)
 *   POST   /api/me/profile/clear   — clear the active profile cookie
 *   GET    /api/me/settings        — all key/value settings for the active profile
 *   PUT    /api/me/settings/:key   — set one setting for the active profile
 *   PUT    /api/tracks/:id/prefs   — favorite/hidden for the active profile
 *   PUT    /api/tracks/:id/owner   — set the shared owner tag on a track
 */

import { Router } from 'express';
import type { UserRepository } from '@domain/user/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TrackId, UserId } from '@foundation/types';
import { getProfileId, PROFILE_COOKIE } from './profile.js';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export interface UserRouterDeps {
  users: UserRepository;
  tracks: TrackRepository;
}

export function createUserRouter({ users, tracks }: UserRouterDeps): Router {
  const router = Router();

  // --- Profiles ---

  router.get('/users', (_req, res) => {
    res.json(users.findAll());
  });

  router.post('/users', (req, res) => {
    const { name, color } = req.body as { name?: string; color?: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    res.status(201).json(users.create({ name: name.trim(), color }));
  });

  router.patch('/users/:id', (req, res) => {
    const { name, color } = req.body as { name?: string; color?: string };
    const updated = users.update(req.params.id as UserId, { name, color });
    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(updated);
  });

  router.delete('/users/:id', (req, res) => {
    res.json({ ok: users.delete(req.params.id as UserId) });
  });

  // --- Active profile (cookie) ---

  router.get('/me', (req, res) => {
    const id = getProfileId(req);
    const user = id ? users.findById(id) : null;
    res.json({ user });
  });

  router.put('/me/profile', (req, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId || !users.findById(userId as UserId)) {
      res.status(400).json({ error: 'Unknown profile' });
      return;
    }
    res.cookie(PROFILE_COOKIE, userId, {
      sameSite: 'strict',
      path: '/',
      maxAge: ONE_YEAR_MS,
    });
    res.json({ ok: true });
  });

  router.post('/me/profile/clear', (_req, res) => {
    res.clearCookie(PROFILE_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // --- Per-user settings ---

  router.get('/me/settings', (req, res) => {
    const id = getProfileId(req);
    if (!id) {
      res.json({});
      return;
    }
    res.json(users.getAllSettings(id));
  });

  router.put('/me/settings/:key', (req, res) => {
    const id = getProfileId(req);
    if (!id) {
      res.status(400).json({ error: 'No profile selected' });
      return;
    }
    const { value } = req.body as { value?: string };
    if (typeof value !== 'string') {
      res.status(400).json({ error: 'value (string) is required' });
      return;
    }
    users.setSetting(id, req.params.key, value);
    res.json({ ok: true });
  });

  // --- Per-track prefs + owner tag ---

  router.put('/tracks/:id/prefs', (req, res) => {
    const id = getProfileId(req);
    if (!id) {
      res.status(400).json({ error: 'No profile selected' });
      return;
    }
    const { favorite, hidden } = req.body as { favorite?: boolean; hidden?: boolean };
    const prefs = users.setTrackPref(id, req.params.id as TrackId, {
      isFavorite: favorite,
      isHidden: hidden,
    });
    res.json(prefs);
  });

  router.put('/tracks/:id/owner', (req, res) => {
    const { userId } = req.body as { userId?: string | null };
    const ownerId = userId ? (userId as UserId) : null;
    if (ownerId && !users.findById(ownerId)) {
      res.status(400).json({ error: 'Unknown profile' });
      return;
    }
    const ok = tracks.setOwner(req.params.id as TrackId, ownerId);
    if (!ok) {
      res.status(404).json({ error: 'Track not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
