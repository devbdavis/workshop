import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type { TrackId, TrackSummary, TrackRepo, ExternalTicket } from '@foundation/types';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import type { GitAdapter, GitStatus } from '@domain/git/types.js';

const execFile = promisify(execFileCb);

/** Timeout for claude CLI execution in milliseconds (30 seconds). */
const CLAUDE_TIMEOUT_MS = 30_000;

export interface SummaryGenerationService {
  generateSummary(trackId: TrackId): Promise<TrackSummary>;
  generateIfStale(trackId: TrackId, maxAgeMinutes: number): Promise<TrackSummary | null>;
}

export interface SummaryGenerationDeps {
  trackRepo: TrackRepository;
  ticketRepo: TicketRepository;
  summaryRepo: SummaryRepository;
  gitAdapter: GitAdapter;
}

interface RepoContext {
  repo: TrackRepo;
  status: GitStatus | null;
}

/**
 * Builds the prompt for summary generation from track context.
 */
function buildPrompt(
  trackName: string,
  trackDescription: string | undefined,
  repoContexts: RepoContext[],
  tickets: ExternalTicket[],
): string {
  const lines: string[] = [
    'Generate a concise project status summary for the following work track:',
    '',
    `Track: ${trackName}`,
  ];

  if (trackDescription) {
    lines.push(`Description: ${trackDescription}`);
  }

  if (repoContexts.length > 0) {
    lines.push('', 'Repositories:');
    for (const { repo, status } of repoContexts) {
      if (status) {
        const dirtyLabel = status.dirty ? 'has uncommitted changes' : 'clean';
        lines.push(`- ${repo.path} (branch: ${status.branch}, ${dirtyLabel})`);
      } else {
        lines.push(`- ${repo.path} (git status unavailable)`);
      }
    }
  }

  if (tickets.length > 0) {
    lines.push('', 'Linked Tickets:');
    for (const ticket of tickets) {
      const title = ticket.cachedTitle ?? 'No title';
      const ticketStatus = ticket.cachedStatus ?? 'Unknown';
      lines.push(`- [${ticket.externalId}] ${title} — Status: ${ticketStatus}`);
    }
  }

  lines.push(
    '',
    'Provide a 2-4 sentence summary of the current state of this work track.',
    'Focus on what\'s actively being worked on, any blockers, and next steps.',
    'Be concise and factual.',
  );

  return lines.join('\n');
}

/**
 * Invokes the claude CLI with --print mode to generate text.
 * Returns the generated text or throws on failure.
 */
async function invokeClaude(prompt: string): Promise<string> {
  try {
    const { stdout } = await execFile(
      'claude',
      ['--print', '--model', 'sonnet', prompt],
      { timeout: CLAUDE_TIMEOUT_MS },
    );
    return stdout.trim();
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException & { killed?: boolean };

    if (error.code === 'ENOENT') {
      throw new Error(
        'claude CLI is not installed or not found in PATH. ' +
        'Install it from https://docs.anthropic.com/en/docs/claude-cli',
      );
    }

    if (error.killed) {
      throw new Error(
        `claude CLI timed out after ${CLAUDE_TIMEOUT_MS / 1000} seconds`,
      );
    }

    throw new Error(`claude CLI failed: ${error.message ?? 'unknown error'}`);
  }
}

export function createSummaryGenerationService(
  deps: SummaryGenerationDeps,
): SummaryGenerationService {
  const { trackRepo, ticketRepo, summaryRepo, gitAdapter } = deps;

  return {
    async generateSummary(trackId: TrackId): Promise<TrackSummary> {
      // 1. Look up the track
      const track = trackRepo.findById(trackId);
      if (!track) {
        throw new Error(`Track not found: ${trackId}`);
      }

      // 2. Gather repo contexts with git status
      const repos = trackRepo.findReposByTrack(trackId);
      const repoContexts: RepoContext[] = await Promise.all(
        repos.map(async (repo) => {
          try {
            const isRepo = await gitAdapter.isGitRepo(repo.path);
            if (!isRepo) return { repo, status: null };
            const status = await gitAdapter.getStatus(repo.path);
            return { repo, status };
          } catch {
            return { repo, status: null };
          }
        }),
      );

      // 3. Gather linked tickets
      const tickets = ticketRepo.findByTrack(trackId);

      // 4. Build prompt and invoke claude
      const prompt = buildPrompt(
        track.name,
        track.description,
        repoContexts,
        tickets,
      );
      const content = await invokeClaude(prompt);

      // 5. Store and return the new summary version
      return summaryRepo.create(trackId, content);
    },

    async generateIfStale(
      trackId: TrackId,
      maxAgeMinutes: number,
    ): Promise<TrackSummary | null> {
      const latest = summaryRepo.findLatest(trackId);

      if (latest) {
        const createdAt = new Date(latest.createdAt).getTime();
        const now = Date.now();
        const ageMinutes = (now - createdAt) / (1000 * 60);

        if (ageMinutes < maxAgeMinutes) {
          // Summary is still fresh, no regeneration needed
          return null;
        }
      }

      // Either no summary exists or it's stale — regenerate
      return this.generateSummary(trackId);
    },
  };
}
