import fs from 'fs';
import path from 'path';
import { safePath } from './utils.js';

export interface VaultWriter {
  /** Write or overwrite a file (path relative to vault root). */
  writeFile(filePath: string, content: string): void;
  /** Append a section to an existing file with a newline separator. */
  appendSection(filePath: string, section: string): void;
  /** Create a directory if it doesn't exist (path relative to vault root). */
  ensureDir(dirPath: string): void;
}

export function createVaultWriter(vaultRoot: string): VaultWriter {
  return {
    writeFile(filePath: string, content: string): void {
      const resolved = safePath(vaultRoot, filePath);
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, content, 'utf-8');
    },

    appendSection(filePath: string, section: string): void {
      const resolved = safePath(vaultRoot, filePath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const existing = fs.readFileSync(resolved, 'utf-8');
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      fs.writeFileSync(resolved, existing + separator + section + '\n', 'utf-8');
    },

    ensureDir(dirPath: string): void {
      const resolved = safePath(vaultRoot, dirPath);
      fs.mkdirSync(resolved, { recursive: true });
    },
  };
}
