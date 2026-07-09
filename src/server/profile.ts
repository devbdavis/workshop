/**
 * Profile resolution for the lightweight multi-user layer.
 *
 * The shared auth token (auth-middleware) is the access boundary. A profile is just
 * *identity* — which of the people sharing this server is acting — carried in the
 * `workshop_profile` cookie and used to scope favorites/hidden/theme/editor settings.
 *
 * A missing or unknown profile yields null: the single-user fallback (all tracks
 * visible, no per-user scoping), so nothing regresses for an un-profiled browser.
 */

import type { Request } from 'express';
import type { UserId } from '@foundation/types';
import { parseCookie } from './auth-middleware.js';

export const PROFILE_COOKIE = 'workshop_profile';

/** Read the selected profile id from the request cookie (null if none). */
export function getProfileId(req: Request): UserId | null {
  const id = parseCookie(req.headers.cookie, PROFILE_COOKIE);
  return id ? (id as UserId) : null;
}
