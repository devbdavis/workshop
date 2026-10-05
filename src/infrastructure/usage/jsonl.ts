import fs from 'fs';
import path from 'path';
import os from 'os';

export const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Recursively lists .jsonl files under dir, skipping anything unreadable (deleted mid-scan, permissions, etc).
export function listJsonlFiles(dir: string): string[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const dirent of dirents) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      files.push(...listJsonlFiles(full));
    } else if (dirent.isFile() && dirent.name.endsWith('.jsonl')) {
      files.push(full);
    }
  }
  return files;
}

/** Parses newline-delimited JSON, skipping blank lines and malformed/partial ones (e.g. mid-write). */
export function parseJsonlLines(content: string): unknown[] {
  const entries: unknown[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return entries;
}
