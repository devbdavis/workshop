import fs from 'fs';
import path from 'path';
import { safePath, trackVaultPath } from './utils.js';

export interface VaultReader {
  /** Read a file relative to the vault root. Returns content or null if not found. */
  readFile(filePath: string): string | null;
  /** List .md files in a directory relative to vault root. Returns relative file paths. */
  listFiles(dirPath: string): string[];
  /** Read the 3 "hot" files from Workshop/{trackSlug}/ */
  readTrackFiles(trackSlug: string): {
    overview: string | null;
    decisions: string | null;
    learnings: string | null;
  };
}

export function createVaultReader(vaultRoot: string): VaultReader {
  return {
    readFile(filePath: string): string | null {
      try {
        const resolved = safePath(vaultRoot, filePath);
        return fs.readFileSync(resolved, 'utf-8');
      } catch {
        return null;
      }
    },

    listFiles(dirPath: string): string[] {
      try {
        const resolved = safePath(vaultRoot, dirPath);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return [];
        }
        const entries = fs.readdirSync(resolved, { recursive: true });
        return (entries as string[])
          .filter((entry) => typeof entry === 'string' && entry.endsWith('.md'))
          .sort();
      } catch {
        return [];
      }
    },

    readTrackFiles(trackSlug: string) {
      const trackDir = trackVaultPath(vaultRoot, trackSlug);
      const relDir = path.relative(vaultRoot, trackDir);

      const readOne = (fileName: string): string | null => {
        const relPath = path.join(relDir, fileName);
        return this.readFile(relPath);
      };

      return {
        overview: readOne('_overview.md'),
        decisions: readOne('decisions.md'),
        learnings: readOne('learnings.md'),
      };
    },
  };
}
