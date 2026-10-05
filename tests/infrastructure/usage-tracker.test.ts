import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { createUsageTracker } from '@infrastructure/usage/usage-tracker';
import type { SettingsRepository } from '@domain/repo/repository';

const testDir = path.join(os.tmpdir(), `workshop-test-usage-${randomUUID()}`);

function makeSettingsStub(): SettingsRepository {
  const store = new Map<string, string>();
  return {
    get: (key: string): string | null => store.get(key) ?? null,
    set: (key: string, value: string): void => {
      store.set(key, value);
    },
  };
}

const FIXED_NOW = Date.parse('2026-07-10T05:00:00.000Z');
const WINDOW_START_MS = FIXED_NOW - 5 * 60 * 60 * 1000;

describe('createUsageTracker', () => {
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(testDir, 'project-a'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, lines: string[], mtime?: Date): string {
    const full = path.join(testDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, lines.join('\n') + '\n');
    if (mtime) {
      fs.utimesSync(full, mtime, mtime);
    }
    return full;
  }

  it('sums in-window assistant token fields, skips malformed lines and old files', () => {
    const inWindowTimestamp = new Date(WINDOW_START_MS + 60 * 60 * 1000).toISOString();
    writeFixture('project-a/in-window.jsonl', [
      JSON.stringify({
        type: 'assistant',
        timestamp: inWindowTimestamp,
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 25,
          },
        },
      }),
      'not valid json {{{',
      JSON.stringify({ type: 'user', timestamp: inWindowTimestamp, message: {} }), // wrong type, ignored
      JSON.stringify({
        type: 'assistant',
        timestamp: inWindowTimestamp,
        message: { usage: { input_tokens: 10 } }, // missing sub-fields treated as 0
      }),
    ]);

    const oldTimestamp = new Date(WINDOW_START_MS - 10 * 60 * 60 * 1000).toISOString();
    const oldMtime = new Date(WINDOW_START_MS - 10 * 60 * 60 * 1000);
    writeFixture(
      'project-a/old.jsonl',
      [
        JSON.stringify({
          type: 'assistant',
          timestamp: oldTimestamp,
          message: { usage: { input_tokens: 999999 } },
        }),
      ],
      oldMtime,
    );

    const settings = makeSettingsStub();
    const tracker = createUsageTracker({
      settings,
      projectsDir: testDir,
      now: (): number => FIXED_NOW,
    });

    const result = tracker.readWindowTokens();

    expect(result.windowTokens).toBe(375 + 10);
    expect(result.entryCount).toBe(2);
    expect(result.windowStartAt).toBe(new Date(WINDOW_START_MS).toISOString());
  });

  it('round-trips calibration and never lowers the ceiling', () => {
    const settings = makeSettingsStub();
    const tracker = createUsageTracker({ settings, projectsDir: testDir, now: (): number => FIXED_NOW });

    expect(tracker.getCalibration()).toEqual({});

    tracker.recordCeiling(1000, '2026-07-10T06:00:00.000Z');
    expect(tracker.getCalibration().ceilingTokens).toBe(1000);
    expect(tracker.getCalibration().lastResetAt).toBe('2026-07-10T06:00:00.000Z');

    tracker.recordCeiling(500); // lower observation must not lower the stored ceiling
    expect(tracker.getCalibration().ceilingTokens).toBe(1000);
    expect(tracker.getCalibration().lastResetAt).toBe('2026-07-10T06:00:00.000Z'); // preserved when not provided

    tracker.recordCeiling(2000, '2026-07-10T11:00:00.000Z');
    expect(tracker.getCalibration().ceilingTokens).toBe(2000);
    expect(tracker.getCalibration().lastResetAt).toBe('2026-07-10T11:00:00.000Z');
  });

  it('isOverThreshold is false when uncalibrated, and correct once calibrated', () => {
    const inWindowTimestamp = new Date(WINDOW_START_MS + 60 * 60 * 1000).toISOString();
    writeFixture('project-a/usage.jsonl', [
      JSON.stringify({
        type: 'assistant',
        timestamp: inWindowTimestamp,
        message: { usage: { input_tokens: 750 } },
      }),
    ]);

    const settings = makeSettingsStub();
    const tracker = createUsageTracker({ settings, projectsDir: testDir, now: (): number => FIXED_NOW });

    expect(tracker.isOverThreshold()).toBe(false); // uncalibrated

    tracker.recordCeiling(1000);
    expect(tracker.getUsageStatus().fraction).toBeCloseTo(0.75);
    expect(tracker.isOverThreshold(0.75)).toBe(true);
    expect(tracker.isOverThreshold(0.8)).toBe(false);
  });
});
