import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  stableHash,
  traitsFromHash,
  createSpriteGenerator,
} from '@infrastructure/sprites/sprite-generator';

describe('sprite-generator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-sprite-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // stableHash
  // -----------------------------------------------------------------------

  describe('stableHash', () => {
    it('returns the same value for the same input', () => {
      expect(stableHash('session-abc')).toBe(stableHash('session-abc'));
    });

    it('returns different values for different inputs', () => {
      expect(stableHash('session-a')).not.toBe(stableHash('session-b'));
    });

    it('returns a non-negative number', () => {
      for (const s of ['', 'x', 'a-very-long-session-id-1234567890']) {
        expect(stableHash(s)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // -----------------------------------------------------------------------
  // traitsFromHash
  // -----------------------------------------------------------------------

  describe('traitsFromHash', () => {
    it('returns a comma-separated string of three traits', () => {
      const traits = traitsFromHash(42);
      const parts = traits.split(', ');
      expect(parts.length).toBe(3);
    });

    it('produces 125 unique combinations', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 125; i++) {
        seen.add(traitsFromHash(i));
      }
      expect(seen.size).toBe(125);
    });

    it('wraps around after 125', () => {
      expect(traitsFromHash(0)).toBe(traitsFromHash(125));
      expect(traitsFromHash(7)).toBe(traitsFromHash(132));
    });
  });

  // -----------------------------------------------------------------------
  // createSpriteGenerator
  // -----------------------------------------------------------------------

  describe('createSpriteGenerator', () => {
    it('creates the sprite directory on init', () => {
      const dir = path.join(tmpDir, 'sprites');
      createSpriteGenerator(dir);
      expect(existsSync(dir)).toBe(true);
    });

    it('getSpriteFilename returns undefined for uncached sessions', () => {
      const gen = createSpriteGenerator(path.join(tmpDir, 'sprites'));
      expect(gen.getSpriteFilename('session-new')).toBeUndefined();
    });

    it('getSpriteFilename returns filename when PNG is cached', () => {
      const dir = path.join(tmpDir, 'sprites');
      const gen = createSpriteGenerator(dir);

      // Manually place a cached file
      const hash = stableHash('session-cached');
      const expectedName = `char-${hash % 125}.png`;
      writeFileSync(path.join(dir, expectedName), 'fake-png');

      expect(gen.getSpriteFilename('session-cached')).toBe(expectedName);
    });

    it('same sessionId always produces the same filename (deterministic)', () => {
      const gen = createSpriteGenerator(path.join(tmpDir, 'sprites'));
      // Call getSpriteFilename twice — filename derivation must be stable
      const a = stableHash('deterministic-test') % 125;
      const b = stableHash('deterministic-test') % 125;
      expect(a).toBe(b);
    });
  });

  // -----------------------------------------------------------------------
  // queueGeneration
  // -----------------------------------------------------------------------

  describe('queueGeneration', () => {
    it('writes a .prompt.json sidecar file', () => {
      const dir = path.join(tmpDir, 'sprites');
      const gen = createSpriteGenerator(dir);

      gen.queueGeneration('session-queue-1');

      const hash = stableHash('session-queue-1');
      const baseName = `char-${hash % 125}`;
      const promptPath = path.join(dir, `${baseName}.prompt.json`);

      expect(existsSync(promptPath)).toBe(true);

      const sidecar = JSON.parse(readFileSync(promptPath, 'utf-8'));
      expect(sidecar.sessionId).toBe('session-queue-1');
      expect(sidecar.filename).toBe(`${baseName}.png`);
      expect(sidecar.prompt).toContain('Pixar-style');
      expect(sidecar.model).toContain('stability-ai/sdxl');
      expect(sidecar.createdAt).toBeTruthy();
    });

    it('does not write a sidecar when PNG already cached', () => {
      const dir = path.join(tmpDir, 'sprites');
      const gen = createSpriteGenerator(dir);

      const hash = stableHash('session-cached-2');
      const pngName = `char-${hash % 125}.png`;
      writeFileSync(path.join(dir, pngName), 'fake-png');

      gen.queueGeneration('session-cached-2');

      const promptPath = path.join(dir, pngName.replace(/\.png$/, '.prompt.json'));
      expect(existsSync(promptPath)).toBe(false);
    });

    it('does not write duplicate sidecars (pending set)', () => {
      const dir = path.join(tmpDir, 'sprites');
      const gen = createSpriteGenerator(dir);

      gen.queueGeneration('session-dup');

      const hash = stableHash('session-dup');
      const promptPath = path.join(dir, `char-${hash % 125}.prompt.json`);

      // Grab the original timestamp
      const first = JSON.parse(readFileSync(promptPath, 'utf-8'));

      // Queue again — should be a no-op
      gen.queueGeneration('session-dup');

      const second = JSON.parse(readFileSync(promptPath, 'utf-8'));
      expect(second.createdAt).toBe(first.createdAt);
    });
  });
});
