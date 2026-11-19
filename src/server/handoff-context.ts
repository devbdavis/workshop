import type { Session, Todo } from '@foundation/types';
import { composeHandoffBrief } from '@application/handoff/compose-handoff-brief.js';
import { snapshotGitState } from '@infrastructure/git/handoff-snapshot.js';
import { readAgentTranscript } from '@infrastructure/usage/agent-transcripts.js';
import type { SessionHistoryScanner } from '@infrastructure/usage/session-history.js';
import type { TranscriptMessage } from '@infrastructure/usage/transcript.js';

async function readMessages(prev: Session, cwd: string, scanner: SessionHistoryScanner): Promise<TranscriptMessage[] | null> {
  try {
    if (prev.claudeResumeId) return await scanner.readTranscript(prev.claudeResumeId);
    return readAgentTranscript(prev.provider, cwd, Date.parse(prev.createdAt))?.read() ?? null;
  } catch (err) {
    console.error('Handoff: failed to read previous transcript:', err);
    return null; // the brief still carries git state and the card
  }
}

export async function buildHandoff(prev: Session, cwd: string, todo: Todo, scanner: SessionHistoryScanner): Promise<string> {
  const [messages, git] = await Promise.all([readMessages(prev, cwd, scanner), snapshotGitState(cwd)]);
  return composeHandoffBrief({ todo, fromProvider: prev.provider, fromSessionId: prev.id, messages, git });
}
