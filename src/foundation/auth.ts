/**
 * Auth token management for Workshop.
 *
 * Generates, reads, and persists a shared secret used to authenticate
 * all clients (browser, MCP server, shell hooks) against the HTTP API
 * and WebSocket endpoints.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

/** Canonical path to the auth token file, computed at call time. */
export function getAuthTokenPath(): string {
  const home = process.env.HOME || '/tmp';
  return path.join(home, '.workshop', 'auth-token');
}

/** Generate a cryptographically random 64-char hex token. */
export function generateAuthToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Read the auth token from the environment or the filesystem.
 * Returns null if neither source provides one.
 */
export function readAuthToken(): string | null {
  const envToken = process.env.WORKSHOP_AUTH_TOKEN;
  if (envToken) return envToken.trim();

  try {
    return readFileSync(getAuthTokenPath(), 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Ensure an auth token exists. Reads from env/file, or generates
 * a new one and writes it to disk with restrictive permissions.
 */
export function ensureAuthToken(): string {
  const existing = readAuthToken();
  if (existing) return existing;

  const token = generateAuthToken();
  const tokenPath = getAuthTokenPath();
  mkdirSync(path.dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
  console.log(`Auth token written to ${tokenPath}`);
  return token;
}

/**
 * Constant-time comparison of a candidate token against the expected value.
 * Returns false for empty or mismatched-length strings without leaking timing.
 */
export function verifyToken(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
