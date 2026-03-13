import fs from 'fs';
import path from 'path';
import { trackVaultPath } from './utils.js';

export interface VaultProvisioner {
  /** Create vault folder for a track with starter files. Idempotent — does not overwrite existing files. */
  provisionTrack(trackSlug: string, trackName: string): void;
  /** Check if a track's vault folder already exists. */
  isProvisioned(trackSlug: string): boolean;
}

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: "${v}"`);
  return `---\n${lines.join('\n')}\n---`;
}

export function createVaultProvisioner(vaultRoot: string): VaultProvisioner {
  return {
    provisionTrack(trackSlug: string, trackName: string): void {
      const trackDir = trackVaultPath(vaultRoot, trackSlug);
      fs.mkdirSync(trackDir, { recursive: true });

      const now = new Date().toISOString().slice(0, 10);

      const files: Record<string, string> = {
        '_overview.md': [
          frontmatter({
            title: `${trackName} - Overview`,
            type: 'workshop-overview',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '',
        ].join('\n'),

        'decisions.md': [
          frontmatter({
            title: `${trackName} - Decisions`,
            type: 'workshop-decisions',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Decisions',
          '',
        ].join('\n'),

        'learnings.md': [
          frontmatter({
            title: `${trackName} - Learnings`,
            type: 'workshop-learnings',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Learnings',
          '',
        ].join('\n'),

        'progress.md': [
          frontmatter({
            title: `${trackName} - Progress`,
            type: 'workshop-progress',
            track: trackSlug,
            created: now,
            last_updated: now,
          }),
          '',
          '# Progress',
          '',
        ].join('\n'),
      };

      for (const [fileName, content] of Object.entries(files)) {
        const filePath = path.join(trackDir, fileName);
        // Do NOT overwrite existing files (idempotent)
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content, 'utf-8');
        }
      }
    },

    isProvisioned(trackSlug: string): boolean {
      const trackDir = trackVaultPath(vaultRoot, trackSlug);
      return fs.existsSync(trackDir);
    },
  };
}
