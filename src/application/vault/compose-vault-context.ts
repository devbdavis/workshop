import type { VaultReader } from '@infrastructure/vault/reader.js';

/**
 * Extract the last N entries from a markdown section.
 * Entries are delimited by "### " headings.
 */
function lastNEntries(content: string, n: number): string {
  const entries: string[] = [];
  let current = '';

  for (const line of content.split('\n')) {
    if (line.startsWith('### ')) {
      if (current.trim()) {
        entries.push(current);
      }
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current.trim()) {
    entries.push(current);
  }

  return entries.slice(-n).join('\n').trim();
}

/**
 * Compose vault content for injection into a session's system prompt.
 * Reads the 3 hot files (overview, decisions, learnings) and assembles them.
 * Returns null if no vault content exists.
 */
export function composeVaultContext(reader: VaultReader, trackSlug: string): string | null {
  const files = reader.readTrackFiles(trackSlug);

  // If nothing exists at all, return null
  if (!files.overview && !files.decisions && !files.learnings) {
    return null;
  }

  const sections: string[] = [];

  if (files.overview) {
    sections.push(`### Overview\n\n${files.overview}`);
  }

  if (files.decisions) {
    const recent = lastNEntries(files.decisions, 5);
    if (recent) {
      sections.push(`### Recent Decisions\n\n${recent}`);
    }
  }

  if (files.learnings) {
    const recent = lastNEntries(files.learnings, 5);
    if (recent) {
      sections.push(`### Recent Learnings\n\n${recent}`);
    }
  }

  if (sections.length === 0) {
    return null;
  }

  const body = sections.join('\n\n');

  const instructions = `### Using the Vault

When you make important decisions, discover gotchas, or complete significant work, record it using the workshop vault MCP tools:
- Architectural/design decisions → append to decisions.md
- Gotchas, patterns, lessons → append to learnings.md
- Session progress → append to progress.md
- New topics → create new .md files as needed

Use WikiLinks ([[note-name]]) to cross-reference other notes.
Available tools: workshop_vault_read, workshop_vault_list, workshop_vault_write, workshop_vault_append`;

  return `## Persistent Memory (Obsidian Vault)\n\n${body}\n\n${instructions}`;
}
