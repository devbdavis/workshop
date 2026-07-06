import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeGlobalAgent } from './filesystem-scanner.js';

/**
 * Install agent templates marked `autoInstall: true` into ~/.claude/agents/
 * as global agents. Idempotent: an existing global agent file (installed
 * earlier, or user-edited) is never overwritten — template drift is handled
 * by the existing sync-from-template flow in the Agents UI.
 *
 * This is how repo-committed agents (templates/agents/*.md) become Global
 * agents on every Workshop setup without a manual install step.
 */
export function ensureAutoInstallAgents(projectRoot: string): number {
  const tplDir = path.join(projectRoot, 'templates', 'agents');
  if (!fs.existsSync(tplDir)) return 0;

  let installed = 0;
  for (const file of fs.readdirSync(tplDir).filter((f) => f.endsWith('.md'))) {
    try {
      const raw = fs.readFileSync(path.join(tplDir, file), 'utf-8');
      if (!/^autoInstall:\s*true\s*$/m.test(raw)) continue;

      const slug = path.basename(file, '.md');
      const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? slug;

      // Mirror writeGlobalAgent's filename derivation for the existence check
      const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
      const globalPath = path.join(os.homedir(), '.claude', 'agents', `${nameSlug}.md`);
      if (fs.existsSync(globalPath)) continue;

      const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
      const systemPrompt = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
      writeGlobalAgent({
        name,
        description: raw.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '',
        model: raw.match(/^model:\s*(.+)$/m)?.[1]?.trim(),
        color: raw.match(/^color:\s*(.+)$/m)?.[1]?.trim(),
        allowedTools: raw.match(/^tools:\s*(.+)$/m)?.[1]?.split(',').map((t) => t.trim()).filter(Boolean),
        systemPrompt,
        templateName: slug,
      });
      installed++;
      console.log(`[agents] Auto-installed template agent: ${name} (global:${nameSlug})`);
    } catch (err) {
      console.warn(`[agents] Failed to auto-install template ${file}:`, err);
    }
  }
  return installed;
}
