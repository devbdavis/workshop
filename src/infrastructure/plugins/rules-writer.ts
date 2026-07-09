import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Plugin, PluginProviders } from '@foundation/types';
import type { InstallStepResult } from '@domain/plugin/installer';
import { detectProviders } from '@domain/plugin/repository';

const execFileAsync = promisify(execFile);

const BLOCK_START = '<!-- workshop:plugins:start -->';
const BLOCK_END = '<!-- workshop:plugins:end -->';

/** Root for Workshop-managed shallow clones of plugin marketplace repos */
export function pluginClonesRoot(): string {
  return path.join(os.homedir(), '.workshop', 'plugins');
}

/** Local clone directory for a marketplace repo ('owner/repo' → owner-repo) */
export function pluginCloneDir(marketplaceRepo: string): string {
  return path.join(pluginClonesRoot(), marketplaceRepo.replace(/\//g, '-'));
}

/** Shallow-clone or fast-forward the plugin repo. Fails soft. */
export async function syncPluginClone(marketplaceRepo: string): Promise<InstallStepResult> {
  const dir = pluginCloneDir(marketplaceRepo);
  try {
    if (existsSync(path.join(dir, '.git'))) {
      await execFileAsync('git', ['-C', dir, 'pull', '--ff-only', '--quiet'], { timeout: 60_000 });
      return { success: true, message: `Updated clone of ${marketplaceRepo}` };
    }
    mkdirSync(pluginClonesRoot(), { recursive: true });
    await execFileAsync(
      'git',
      ['clone', '--depth', '1', '--quiet', `https://github.com/${marketplaceRepo}`, dir],
      { timeout: 120_000 },
    );
    return { success: true, message: `Cloned ${marketplaceRepo}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A stale clone is still usable for rules payloads — only report failure
    // when we have nothing at all.
    if (existsSync(dir)) {
      return { success: true, message: `Using existing clone of ${marketplaceRepo} (update failed: ${msg})` };
    }
    return { success: false, message: msg };
  }
}

/** Detect which providers a cloned plugin repo can reach */
export function detectCloneProviders(marketplaceRepo: string): PluginProviders {
  const dir = pluginCloneDir(marketplaceRepo);
  return detectProviders({
    hasClaudePlugin: existsSync(path.join(dir, '.claude-plugin')),
    hasGeminiExtension: existsSync(path.join(dir, 'gemini-extension.json')),
    hasAgentsMd: existsSync(path.join(dir, 'AGENTS.md')),
  });
}

/**
 * Concatenated AGENTS.md rules of the given (enabled) plugins, read from
 * their local clones. Returns null when no plugin ships rules.
 */
export function readAgentsRules(plugins: Plugin[]): string | null {
  const sections: string[] = [];
  for (const plugin of plugins) {
    const agentsPath = path.join(pluginCloneDir(plugin.marketplaceRepo), 'AGENTS.md');
    if (!existsSync(agentsPath)) continue;
    try {
      const content = readFileSync(agentsPath, 'utf-8').trim();
      if (content) sections.push(content);
    } catch {
      // Unreadable rules file — skip this plugin
    }
  }
  return sections.length > 0 ? sections.join('\n\n---\n\n') : null;
}

/**
 * Write (or remove) the Workshop-managed rules block in ~/.codex/AGENTS.md.
 * Content outside the markers is preserved. Passing null removes the block.
 */
export function writeCodexGlobalRules(rules: string | null): InstallStepResult {
  const codexDir = path.join(os.homedir(), '.codex');
  const agentsPath = path.join(codexDir, 'AGENTS.md');

  try {
    let existing = '';
    if (existsSync(agentsPath)) {
      existing = readFileSync(agentsPath, 'utf-8');
    }

    const blockPattern = new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`);
    const withoutBlock = existing.replace(blockPattern, '\n').replace(/^\n+$/, '');

    if (rules === null) {
      if (!existing.includes(BLOCK_START)) {
        return { success: true, message: 'No codex rules block to remove' };
      }
      writeFileSync(agentsPath, withoutBlock.trimStart(), 'utf-8');
      return { success: true, message: 'Removed codex rules block' };
    }

    const block = `${BLOCK_START}\n<!-- Managed by Workshop — do not edit inside this block -->\n\n${rules}\n${BLOCK_END}\n`;
    const base = withoutBlock.trim();
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(agentsPath, base ? `${base}\n\n${block}` : block, 'utf-8');
    return { success: true, message: 'Updated codex rules block' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
