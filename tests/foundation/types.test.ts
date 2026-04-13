import { describe, it, expect } from 'vitest';
import {
  isDefaultAiCli,
  isSessionProvider,
  parseDefaultAiCli,
  parseSessionProvider,
  resolveSessionProvider,
} from '@foundation/types';

describe('session/default CLI parsing', () => {
  describe('isSessionProvider', () => {
    it('accepts all supported providers', () => {
      expect(isSessionProvider('claude')).toBe(true);
      expect(isSessionProvider('cursor')).toBe(true);
      expect(isSessionProvider('codex')).toBe(true);
      expect(isSessionProvider('gemini')).toBe(true);
    });

    it('rejects unsupported values', () => {
      expect(isSessionProvider('gpt')).toBe(false);
      expect(isSessionProvider('')).toBe(false);
      expect(isSessionProvider(null)).toBe(false);
    });
  });

  describe('isDefaultAiCli', () => {
    it('accepts only claude and cursor', () => {
      expect(isDefaultAiCli('claude')).toBe(true);
      expect(isDefaultAiCli('cursor')).toBe(true);
      expect(isDefaultAiCli('codex')).toBe(false);
      expect(isDefaultAiCli(undefined)).toBe(false);
    });
  });

  describe('parse helpers', () => {
    it('falls back to claude for invalid explicit providers', () => {
      expect(parseSessionProvider('invalid')).toBe('claude');
    });

    it('falls back to claude for invalid default CLI values', () => {
      expect(parseDefaultAiCli('codex')).toBe('claude');
    });
  });

  describe('resolveSessionProvider', () => {
    it('uses explicit provider when valid', () => {
      expect(resolveSessionProvider('codex', 'cursor')).toBe('codex');
    });

    it('uses saved default when provider is omitted', () => {
      expect(resolveSessionProvider(undefined, 'cursor')).toBe('cursor');
      expect(resolveSessionProvider(null, 'cursor')).toBe('cursor');
    });

    it('falls back to claude when explicit provider is invalid', () => {
      expect(resolveSessionProvider('invalid', 'cursor')).toBe('claude');
    });
  });
});
