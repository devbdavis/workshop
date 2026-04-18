import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export type BackupKind = 'daily' | 'weekly';

export interface BackupEntry {
  fileName: string;
  fullPath: string;
  kind: BackupKind;
  /** Filename-encoded timestamp (UTC), used for ordering. */
  timestamp: string;
}

const FILE_RE = /^workshop-backup-(\d{4}-\d{2}-\d{2}T\d{6}Z)-(daily|weekly)\.tar\.br\.enc$/;

export function buildBackupFileName(kind: BackupKind, at: Date): string {
  const iso = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // Re-insert the date dashes so filenames are human-scannable in Finder.
  const date = at.toISOString().slice(0, 10);
  const time = iso.slice(9); // "HHMMSSZ"
  return `workshop-backup-${date}T${time}-${kind}.tar.br.enc`;
}

export function listBackups(directory: string): BackupEntry[] {
  if (!existsSync(directory)) return [];
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(directory)) {
    const match = FILE_RE.exec(name);
    if (!match) continue;
    const fullPath = path.join(directory, name);
    try {
      if (!statSync(fullPath).isFile()) continue;
    } catch {
      continue;
    }
    entries.push({
      fileName: name,
      fullPath,
      timestamp: match[1],
      kind: match[2] as BackupKind,
    });
  }
  // Newest first for easy "keep top N" logic.
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

export interface RetentionPolicy {
  dailies: number;
  weeklies: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  dailies: 3,
  weeklies: 4,
};

export interface PruneResult {
  deleted: string[];
  kept: string[];
}

/**
 * Delete older backups beyond the retention policy. Returns which files were
 * kept and which were removed, so callers can surface a summary to the UI.
 */
export function pruneBackups(directory: string, policy: RetentionPolicy = DEFAULT_RETENTION): PruneResult {
  const entries = listBackups(directory);
  const kept: string[] = [];
  const deleted: string[] = [];

  const dailies = entries.filter((e) => e.kind === 'daily');
  const weeklies = entries.filter((e) => e.kind === 'weekly');

  for (const [group, limit] of [
    [dailies, policy.dailies] as const,
    [weeklies, policy.weeklies] as const,
  ]) {
    group.forEach((entry, idx) => {
      if (idx < limit) {
        kept.push(entry.fullPath);
      } else {
        try {
          unlinkSync(entry.fullPath);
          deleted.push(entry.fullPath);
        } catch {
          // Non-fatal: leave it; next run will try again.
        }
      }
    });
  }

  return { deleted, kept };
}

export function isWeeklyDay(at: Date): boolean {
  // Sunday = 0. Weekly backup rides on top of the daily on Sundays.
  return at.getUTCDay() === 0;
}
