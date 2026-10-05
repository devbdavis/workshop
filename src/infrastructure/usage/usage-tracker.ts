import fs from 'fs';

import type { SettingsRepository } from '@domain/repo/repository';
import { DEFAULT_PROJECTS_DIR, listJsonlFiles, parseJsonlLines } from './jsonl.js';

const SETTINGS_KEY = 'usage_pacing';
const WINDOW_MS = 5 * 60 * 60 * 1000;

interface AssistantUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AssistantEntry {
  type: string;
  timestamp: string;
  message?: { usage?: AssistantUsage };
}

export interface WindowTokens {
  windowTokens: number;
  windowStartAt: string;
  entryCount: number;
}

export interface UsageCalibration {
  ceilingTokens?: number;
  lastResetAt?: string;
  updatedAt?: string;
}

export interface UsageStatus {
  windowTokens: number;
  ceilingTokens: number | null;
  fraction: number | null;
  windowStartAt: string;
}

export interface UsageTracker {
  readWindowTokens(): WindowTokens;
  getCalibration(): UsageCalibration;
  recordCeiling(tokensAtLimit: number, resetAt?: string): void;
  getUsageStatus(): UsageStatus;
  isOverThreshold(fraction?: number): boolean;
}

export interface UsageTrackerDeps {
  settings: SettingsRepository;
  projectsDir?: string;
  now?: () => number;
}

function sumUsage(usage: AssistantUsage | undefined): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function readFileTokens(filePath: string, windowStartMs: number): { tokens: number; count: number } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { tokens: 0, count: 0 };
  }
  let tokens = 0;
  let count = 0;
  for (const raw of parseJsonlLines(content)) {
    const entry = raw as AssistantEntry;
    if (entry.type !== 'assistant') continue;
    const entryMs = Date.parse(entry.timestamp);
    if (Number.isNaN(entryMs) || entryMs < windowStartMs) continue;
    tokens += sumUsage(entry.message?.usage);
    count += 1;
  }
  return { tokens, count };
}

export function createUsageTracker(deps: UsageTrackerDeps): UsageTracker {
  const settings = deps.settings;
  const projectsDir = deps.projectsDir ?? DEFAULT_PROJECTS_DIR;
  const now = deps.now ?? ((): number => Date.now());

  function readWindowTokens(): WindowTokens {
    const nowMs = now();
    const windowStartMs = nowMs - WINDOW_MS;
    const windowStartAt = new Date(windowStartMs).toISOString();

    let windowTokens = 0;
    let entryCount = 0;
    for (const file of listJsonlFiles(projectsDir)) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (stat.mtimeMs < windowStartMs) continue; // perf guard: file untouched in window can't hold in-window entries
      const { tokens, count } = readFileTokens(file, windowStartMs);
      windowTokens += tokens;
      entryCount += count;
    }
    return { windowTokens, windowStartAt, entryCount };
  }

  function getCalibration(): UsageCalibration {
    const raw = settings.get(SETTINGS_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as UsageCalibration;
    } catch {
      return {};
    }
  }

  function recordCeiling(tokensAtLimit: number, resetAt?: string): void {
    const current = getCalibration();
    const ceilingTokens = Math.max(current.ceilingTokens ?? 0, tokensAtLimit);
    const next: UsageCalibration = {
      ceilingTokens,
      lastResetAt: resetAt ?? current.lastResetAt,
      updatedAt: new Date(now()).toISOString(),
    };
    settings.set(SETTINGS_KEY, JSON.stringify(next));
  }

  function getUsageStatus(): UsageStatus {
    const { windowTokens, windowStartAt } = readWindowTokens();
    const { ceilingTokens } = getCalibration();
    const fraction = ceilingTokens ? windowTokens / ceilingTokens : null;
    return { windowTokens, ceilingTokens: ceilingTokens ?? null, fraction, windowStartAt };
  }

  function isOverThreshold(fraction = 0.75): boolean {
    const status = getUsageStatus();
    if (status.fraction === null) return false; // uncalibrated: reactive backstop covers the first window
    return status.fraction >= fraction;
  }

  return { readWindowTokens, getCalibration, recordCeiling, getUsageStatus, isOverThreshold };
}
