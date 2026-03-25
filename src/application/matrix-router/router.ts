/**
 * Matrix Router — lightweight, deterministic background service.
 *
 * Ensures every track with a matrixRoomId has a live, room-scoped
 * Claude session. Does NOT forward messages — each session's own
 * Matrix MCP instance handles inbound/outbound for its room.
 */
import type { Track, TrackId, SessionId, SessionProvider } from '@foundation/types';
import type { TrackRepository } from '@domain/track/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TicketRepository } from '@domain/ticket/repository';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { TerminalManager } from '@domain/terminal/manager.js';
import { mkdirSync } from 'fs';
import path from 'path';
import type { VaultReader } from '@infrastructure/vault/reader.js';
import { composeVaultContext } from '@application/vault/compose-vault-context.js';
import { interpolateTemplate } from '@application/track-management/prompt-interpolation.js';
import { slugifyTrackName } from '@infrastructure/vault/utils.js';
import {
  prepareMatrixStateDir,
  buildMatrixMcpConfig,
  buildMatrixPromptBlock,
} from './matrix-session-setup.js';

const MATRIX_SESSION_PREFIX = '[matrix] ';
const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface MatrixRouterDeps {
  tracks: TrackRepository;
  sessions: SessionRepository;
  summaries: SummaryRepository;
  tickets: TicketRepository;
  promptTemplates: PromptTemplateRepository;
  terminal: TerminalManager;
  vaultReader: VaultReader;
  broadcast: (type: string, id: string) => void;
}

export interface MatrixRouter {
  start(intervalMs?: number): void;
  stop(): void;
  /** Run a single reconciliation cycle (exposed for testing / manual trigger) */
  reconcile(): Promise<void>;
}

export function createMatrixRouter(deps: MatrixRouterDeps): MatrixRouter {
  let timer: ReturnType<typeof setInterval> | null = null;
  let reconciling = false;

  /** Find the dedicated matrix session for a track, if any */
  function findMatrixSession(trackId: TrackId): { id: SessionId; alive: boolean } | null {
    const trackSessions = deps.sessions.findByTrack(trackId);
    const matrixSession = trackSessions.find(
      (s) => s.name?.startsWith(MATRIX_SESSION_PREFIX) && s.state !== 'dead',
    );
    if (!matrixSession) return null;

    const alive = deps.terminal.isSessionAlive(matrixSession);
    return { id: matrixSession.id, alive };
  }

  /** Compose the full system prompt for a matrix-dedicated session */
  function composeSystemPrompt(track: Track): string {
    const parts: string[] = [];

    // Matrix-specific instructions
    parts.push(buildMatrixPromptBlock(track.matrixRoomId!, track.name));

    // Track context
    if (track.context) {
      parts.push(track.context);
    }

    // Vault context
    const trackSlug = slugifyTrackName(track.name);
    const vaultCtx = composeVaultContext(deps.vaultReader, trackSlug);
    if (vaultCtx) {
      parts.push(vaultCtx);
    }

    // Latest summary
    const summary = deps.summaries.findLatest(track.id);
    if (summary) {
      parts.push(`## Current Status\n\n${summary.content}`);
    }

    // Interpolated template
    if (track.defaultPromptTemplateId) {
      const template = deps.promptTemplates.findById(track.defaultPromptTemplateId);
      if (template) {
        track.tickets = deps.tickets.findByTrack(track.id);
        const interpolated = interpolateTemplate(template.content, { track });
        parts.push(interpolated);
      }
    }

    return parts.join('\n\n---\n\n');
  }

  /** Create a new dedicated matrix session for a track */
  async function createMatrixSession(track: Track): Promise<void> {
    const roomId = track.matrixRoomId!;
    console.log(`Matrix router: creating session for "${track.name}" → ${roomId}`);

    const systemPrompt = composeSystemPrompt(track);

    // Determine working directory from first repo, fallback to home
    const repos = deps.tracks.findReposByTrack(track.id);
    const workingDirectory = repos[0]?.path || process.env.HOME || '/tmp';

    // Create the session — the session dir will be created by terminal manager
    const session = await deps.terminal.createSession(track.id, {
      systemPrompt,
      workingDirectory,
      provider: 'claude' as SessionProvider,
      background: true,
      mcpServers: buildMatrixMcpConfig(
        prepareMatrixStateDir(
          getMatrixStateDir(track.id),
          roomId,
          ['@kazamatzuri:submerged-intelligence.de'],
        ),
      ),
      allowedTools: [
        'mcp__matrix__*',
        'mcp__workshop__*',
      ],
    });

    // Name it so we can identify it later
    deps.sessions.updateName(session.id, `${MATRIX_SESSION_PREFIX}${track.name}`);
    deps.broadcast('session:created', track.id);
    console.log(`Matrix router: session ${session.id} created for "${track.name}"`);
  }

  /** Get a deterministic directory for matrix state */
  function getMatrixStateDir(trackId: TrackId): string {
    const dir = path.join(
      process.env.HOME || '/tmp',
      '.workshop',
      'matrix-sessions',
      trackId,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Single reconciliation cycle */
  async function reconcile(): Promise<void> {
    if (reconciling) return;
    reconciling = true;

    try {
      const allTracks = deps.tracks.findAll();
      const matrixTracks = allTracks.filter((t) => t.matrixRoomId);

      for (const track of matrixTracks) {
        try {
          const existing = findMatrixSession(track.id);

          if (existing && existing.alive) {
            // Session is healthy — nothing to do
            continue;
          }

          if (existing && !existing.alive) {
            // Dead session — clean up before recreating
            console.log(`Matrix router: session for "${track.name}" is dead, recreating`);
            await deps.terminal.destroySession(existing.id);
          }

          // No session or dead session — create one
          await createMatrixSession(track);
        } catch (err) {
          console.error(`Matrix router: failed to ensure session for "${track.name}":`, err);
        }
      }
    } finally {
      reconciling = false;
    }
  }

  return {
    start(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
      if (timer) return;

      // Run first reconciliation after a short delay to let other services start
      setTimeout(() => void reconcile(), 5_000);

      timer = setInterval(() => void reconcile(), intervalMs);
      console.log(`Matrix router started (interval: ${intervalMs / 1000}s)`);
    },

    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log('Matrix router stopped');
    },

    reconcile,
  };
}
