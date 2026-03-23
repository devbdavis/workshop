import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import {
  generateAuthToken,
  readAuthToken,
  ensureAuthToken,
  verifyToken,
  getAuthTokenPath,
} from '@foundation/auth';

describe('auth', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  let origToken: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-auth-test-'));
    origHome = process.env.HOME;
    origToken = process.env.WORKSHOP_AUTH_TOKEN;
    process.env.HOME = tmpDir;
    delete process.env.WORKSHOP_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (origToken !== undefined) {
      process.env.WORKSHOP_AUTH_TOKEN = origToken;
    } else {
      delete process.env.WORKSHOP_AUTH_TOKEN;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateAuthToken', () => {
    it('returns a 64-char hex string', () => {
      const token = generateAuthToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns unique values', () => {
      const a = generateAuthToken();
      const b = generateAuthToken();
      expect(a).not.toBe(b);
    });
  });

  describe('verifyToken', () => {
    it('returns true for matching tokens', () => {
      expect(verifyToken('abc123', 'abc123')).toBe(true);
    });

    it('returns false for mismatched tokens', () => {
      expect(verifyToken('abc123', 'xyz789')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(verifyToken('', 'abc')).toBe(false);
      expect(verifyToken('abc', '')).toBe(false);
      expect(verifyToken('', '')).toBe(false);
    });

    it('returns false for different-length strings', () => {
      expect(verifyToken('short', 'muchlonger')).toBe(false);
    });
  });

  describe('getAuthTokenPath', () => {
    it('uses HOME to build the path', () => {
      const p = getAuthTokenPath();
      expect(p).toBe(path.join(tmpDir, '.workshop', 'auth-token'));
    });
  });

  describe('readAuthToken', () => {
    it('prefers WORKSHOP_AUTH_TOKEN env var', () => {
      process.env.WORKSHOP_AUTH_TOKEN = 'env-token-value';
      expect(readAuthToken()).toBe('env-token-value');
    });

    it('trims whitespace from env var', () => {
      process.env.WORKSHOP_AUTH_TOKEN = '  spaced-token  ';
      expect(readAuthToken()).toBe('spaced-token');
    });

    it('returns null when no token exists', () => {
      expect(readAuthToken()).toBeNull();
    });
  });

  describe('ensureAuthToken', () => {
    it('creates token file when none exists', () => {
      const token = ensureAuthToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      const written = readFileSync(
        path.join(tmpDir, '.workshop', 'auth-token'),
        'utf-8',
      ).trim();
      expect(written).toBe(token);
    });

    it('returns existing token from env without writing', () => {
      process.env.WORKSHOP_AUTH_TOKEN = 'existing-env-token';
      const token = ensureAuthToken();
      expect(token).toBe('existing-env-token');
    });
  });
});
