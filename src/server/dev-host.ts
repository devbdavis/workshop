/**
 * Per-session dev-server hostnames (`<track-slug>-<sid>.<WORKSHOP_DEV_DOMAIN>`)
 * and the signed tickets that log a browser in on one of them.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { ensureAuthToken } from '@foundation/auth.js';
import { devSid, SID_LENGTH } from '@foundation/dev-sid.js';

/** The dev-server base domain, or null when the feature is off. */
export function devDomain(): string | null {
  const domain = process.env.WORKSHOP_DEV_DOMAIN?.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return domain || null;
}

/** Lowercase DNS-label slug of a track name, capped so the whole label stays under 63 chars. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'session';
}

export function devHostname(trackName: string, sessionId: string, domain: string): string {
  return `${slug(trackName)}-${devSid(sessionId)}.${domain}`;
}

/**
 * Returns the session sid when `host` is exactly one label under `domain`, else null.
 * The track slug in the label is cosmetic and ignored.
 */
export function parseDevHost(host: string | undefined, domain: string): string | null {
  if (!host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  const suffix = `.${domain}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  const match = label.match(new RegExp(`(?:^|-)([0-9a-f]{${SID_LENGTH}})$`));
  return match ? match[1] : null;
}

function mac(sidValue: string, exp: number): string {
  return createHmac('sha256', ensureAuthToken()).update(`dev:${sidValue}.${exp}`).digest('hex');
}

/** A ticket proving the holder may use the dev server of `sidValue` until it expires. */
export function signDevTicket(sidValue: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `${exp}.${mac(sidValue, exp)}`;
}

export function verifyDevTicket(ticket: string | null | undefined, sidValue: string, now = Date.now()): boolean {
  const match = ticket?.match(/^(\d+)\.([0-9a-f]{64})$/);
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp * 1000 <= now) return false;
  return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(mac(sidValue, exp), 'hex'));
}
