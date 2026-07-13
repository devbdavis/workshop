import type { VaultReader } from '@domain/vault/reader.js';

/**
 * Compose a vault *reference* for injection into a session's system prompt.
 *
 * We deliberately do NOT inline the vault contents (overview/decisions/learnings)
 * — those entries are large and clutter context before work even starts. Instead
 * we point the agent at where the vault lives and how to read it on demand.
 * Returns null if no vault content exists for the track.
 */
export function composeVaultContext(reader: VaultReader, trackSlug: string): string | null {
  const files = reader.readTrackFiles(trackSlug);

  // If nothing exists at all, there's nothing to reference.
  if (!files.overview && !files.decisions && !files.learnings) {
    return null;
  }

  const available: string[] = [];
  if (files.overview) available.push('_overview.md');
  if (files.decisions) available.push('decisions.md');
  if (files.learnings) available.push('learnings.md');

  return `## Persistent Memory (Obsidian Vault)

This track has a persistent memory vault (decisions, learnings, progress, and other notes). It is NOT inlined here to keep context lean — read it on demand only if you need it:
- List notes: workshop_vault_list(trackSlug="${trackSlug}")
- Read a note: workshop_vault_read(trackSlug="${trackSlug}", filePath="decisions.md")

Notes currently available: ${available.join(', ')} (plus any others — use workshop_vault_list).

When you make important decisions, discover gotchas, or complete significant work, record it:
- Architectural/design decisions → append to decisions.md
- Gotchas, patterns, lessons → append to learnings.md
- Session progress → append to progress.md
- New topics → create new .md files as needed

Use WikiLinks ([[note-name]]) to cross-reference other notes.
Available tools: workshop_vault_read, workshop_vault_list, workshop_vault_write, workshop_vault_append`;
}
