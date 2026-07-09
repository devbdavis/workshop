/**
 * Authentication middleware for Workshop.
 *
 * Checks every request for a valid auth token via:
 *   1. Authorization: Bearer <token> header
 *   2. workshop_token cookie
 *   3. ?token=<token> query parameter
 *
 * Provides utility functions for WebSocket upgrade auth as well.
 */

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import { ensureAuthToken, verifyToken } from '@foundation/auth.js';

let serverToken: string | null = null;

/** Initialise the token on first call. */
function getServerToken(): string {
  if (!serverToken) {
    serverToken = ensureAuthToken();
  }
  return serverToken;
}

/** Parse a specific cookie value from a raw Cookie header string. */
export function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Extract a token from an incoming HTTP request, checking all three sources.
 */
export function extractToken(req: IncomingMessage): string | null {
  // 1. Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. Cookie
  const cookieToken = parseCookie(req.headers.cookie, 'workshop_token');
  if (cookieToken) return cookieToken;

  // 3. Query parameter
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  return null;
}

/**
 * Validate a token extracted from a request against the server's token.
 */
export function validateToken(candidate: string | null): boolean {
  if (!candidate) return false;
  return verifyToken(candidate, getServerToken());
}

/**
 * Express middleware that gates API access behind auth.
 * Mount this AFTER auth routes so /api/auth/* can remain public.
 */
export function createAuthMiddleware() {
  // Eagerly initialise the token
  getServerToken();

  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    if (validateToken(token)) {
      next();
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
  };
}
