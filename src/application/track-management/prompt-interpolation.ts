import type { Track } from '@foundation/types';

/**
 * Context object used for template variable interpolation.
 * The track must have repos and tickets populated.
 */
export interface TrackContext {
  track: Track;
}

/**
 * Interpolates a template string with track context variables.
 *
 * Supported variables:
 *   {{track.id}}              - Track ID
 *   {{track.name}}            - Track name
 *   {{track.description}}     - Track description (or empty string)
 *   {{track.repos}}           - Comma-separated list of repo paths
 *   {{track.repos[N].path}}   - Path of the Nth repo (0-indexed)
 *   {{track.repos[N].branch}} - Branch of the Nth repo (0-indexed)
 *   {{track.tickets}}         - Comma-separated list of ticket external IDs
 *
 * Unresolved variables are left as-is in the output.
 */
export function interpolateTemplate(template: string, ctx: TrackContext): string {
  const { track } = ctx;
  const repos = track.repos ?? [];
  const tickets = track.tickets ?? [];

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();

    if (key === 'track.id') return track.id;
    if (key === 'track.name') return track.name;
    if (key === 'track.description') return track.description ?? '';

    if (key === 'track.repos') {
      return repos.map((r) => r.path).join(', ');
    }

    if (key === 'track.tickets') {
      return tickets.map((t) => t.externalId).join(', ');
    }

    // Handle indexed repo access: track.repos[N].path or track.repos[N].branch
    const repoMatch = key.match(/^track\.repos\[(\d+)\]\.(\w+)$/);
    if (repoMatch) {
      const index = parseInt(repoMatch[1], 10);
      const field = repoMatch[2];
      const repo = repos[index];
      if (!repo) return _match; // Leave unresolved if index out of bounds
      if (field === 'path') return repo.path;
      if (field === 'branch') return repo.branch ?? '';
      return _match; // Unknown field, leave unresolved
    }

    // Unresolved variable — leave as-is
    return _match;
  });
}
