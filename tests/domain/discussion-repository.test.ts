import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set up temp DB before importing modules that call getDatabase()
const tmpDb = path.join(os.tmpdir(), `workshop-disc-test-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = tmpDb;

import { resetDatabase } from '@infrastructure/persistence/database';
import { createDiscussionTeamRepository } from '@infrastructure/persistence/discussion-team-repository';
import { createDiscussionRepository } from '@infrastructure/persistence/discussion-repository';
import { createDiscussionMessageRepository } from '@infrastructure/persistence/discussion-message-repository';
import { createDiscussionVoteRepository } from '@infrastructure/persistence/discussion-vote-repository';
import { createDiscussionSessionRepository } from '@infrastructure/persistence/discussion-session-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { createSessionRepository } from '@infrastructure/persistence/session-repository';
import type { DiscussionTeamId, DiscussionId, DiscussionMessageId } from '@foundation/discussion-types';
import type { AgentId, SessionId, TrackId } from '@foundation/types';

afterAll(() => {
  resetDatabase();
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
});

describe('Discussion Team Repository', () => {
  const teams = createDiscussionTeamRepository();

  it('creates and retrieves a team', () => {
    const team = teams.create({
      name: 'Architecture Review',
      description: 'Reviews architecture decisions',
      consensusRule: { type: 'unanimous' },
      memberAgentIds: ['global:simplify' as AgentId, 'global:go-backend' as AgentId],
    });

    expect(team.id).toBeDefined();
    expect(team.name).toBe('Architecture Review');
    expect(team.consensusRule).toEqual({ type: 'unanimous' });
    expect(team.memberAgentIds).toHaveLength(2);

    const found = teams.findById(team.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Architecture Review');
  });

  it('updates a team', () => {
    const team = teams.create({
      name: 'To Update',
      consensusRule: { type: 'majority', threshold: 0.5 },
      memberAgentIds: ['agent-1' as AgentId],
    });
    const updated = teams.update(team.id, { name: 'Updated Name' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.consensusRule).toEqual({ type: 'majority', threshold: 0.5 }); // unchanged
  });

  it('deletes a team', () => {
    const team = teams.create({
      name: 'To Delete',
      consensusRule: { type: 'quorum', minVotes: 1 },
      memberAgentIds: ['a' as AgentId],
    });
    expect(teams.delete(team.id)).toBe(true);
    expect(teams.findById(team.id)).toBeNull();
  });

  it('findAll returns all teams', () => {
    const all = teams.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Discussion Repository', () => {
  const teams = createDiscussionTeamRepository();
  const discussions = createDiscussionRepository();
  let teamId: DiscussionTeamId;

  beforeAll(() => {
    const team = teams.create({
      name: 'Test Team',
      consensusRule: { type: 'unanimous' },
      memberAgentIds: ['a' as AgentId, 'b' as AgentId],
    });
    teamId = team.id;
  });

  it('creates and retrieves a discussion', () => {
    const disc = discussions.create({
      teamId,
      title: 'Test Discussion',
      type: 'rfc',
      status: 'open',
      participantIds: ['a', 'b'],
      staleAfterMinutes: 30,
      lastActivityAt: new Date().toISOString(),
      createdByType: 'human',
    });

    expect(disc.id).toBeDefined();
    expect(disc.title).toBe('Test Discussion');

    const found = discussions.findById(disc.id);
    expect(found).not.toBeNull();
    expect(found!.participantIds).toEqual(['a', 'b']);
  });

  it('filters by status', () => {
    const open = discussions.findAll({ status: 'open' });
    expect(open.length).toBeGreaterThanOrEqual(1);
    for (const d of open) {
      expect(d.status).toBe('open');
    }
  });

  it('updates status', () => {
    const disc = discussions.create({
      teamId,
      title: 'Status Test',
      type: 'rfc',
      status: 'open',
      participantIds: ['a'],
      staleAfterMinutes: 0,
      lastActivityAt: new Date().toISOString(),
      createdByType: 'human',
    });
    const updated = discussions.updateStatus(disc.id, 'consensus');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('consensus');
    expect(updated!.closedAt).toBeDefined();
  });

  it('updates last activity', () => {
    const disc = discussions.create({
      teamId,
      title: 'Activity Test',
      type: 'rfc',
      status: 'open',
      participantIds: ['a'],
      staleAfterMinutes: 0,
      lastActivityAt: '2020-01-01T00:00:00.000Z',
      createdByType: 'human',
    });
    const before = disc.lastActivityAt;
    // Small delay to ensure different timestamp
    const updated = discussions.updateLastActivity(disc.id);
    expect(updated).not.toBeNull();
    expect(updated!.lastActivityAt).not.toBe(before);
  });
});

describe('Discussion Message Repository', () => {
  const teams = createDiscussionTeamRepository();
  const discussions = createDiscussionRepository();
  const messages = createDiscussionMessageRepository();
  let discussionId: DiscussionId;

  beforeAll(() => {
    const team = teams.create({
      name: 'Msg Test Team',
      consensusRule: { type: 'unanimous' },
      memberAgentIds: ['a' as AgentId],
    });
    const disc = discussions.create({
      teamId: team.id,
      title: 'Msg Test',
      type: 'rfc',
      status: 'open',
      participantIds: ['a'],
      staleAfterMinutes: 0,
      lastActivityAt: new Date().toISOString(),
      createdByType: 'human',
    });
    discussionId = disc.id;
  });

  it('creates and retrieves messages', () => {
    const msg = messages.create({
      discussionId,
      authorType: 'agent',
      authorId: 'a',
      authorName: 'Agent A',
      messageType: 'comment',
      content: 'Hello world',
    });

    expect(msg.id).toBeDefined();
    expect(msg.content).toBe('Hello world');

    const all = messages.findByDiscussion(discussionId);
    expect(all.length).toBe(1);
    expect(all[0].content).toBe('Hello world');
  });

  it('counts messages', () => {
    expect(messages.countByDiscussion(discussionId)).toBe(1);
  });

  it('returns latest rowid', () => {
    const rowid = messages.latestRowid(discussionId);
    expect(rowid).not.toBeNull();
    expect(typeof rowid).toBe('number');
  });
});

describe('Discussion Vote Repository', () => {
  const teams = createDiscussionTeamRepository();
  const discussions = createDiscussionRepository();
  const votes = createDiscussionVoteRepository();
  let discussionId: DiscussionId;

  beforeAll(() => {
    const team = teams.create({
      name: 'Vote Test Team',
      consensusRule: { type: 'unanimous' },
      memberAgentIds: ['a' as AgentId],
    });
    const disc = discussions.create({
      teamId: team.id,
      title: 'Vote Test',
      type: 'rfc',
      status: 'open',
      participantIds: ['a', 'b'],
      staleAfterMinutes: 0,
      lastActivityAt: new Date().toISOString(),
      createdByType: 'human',
    });
    discussionId = disc.id;
  });

  it('upserts a vote', () => {
    const vote = votes.upsert({
      discussionId,
      voterType: 'agent',
      voterId: 'a',
      voterName: 'Agent A',
      vote: 'satisfied',
      createdAt: new Date().toISOString(),
    });
    expect(vote.vote).toBe('satisfied');
  });

  it('updates existing vote on re-upsert', () => {
    votes.upsert({
      discussionId,
      voterType: 'agent',
      voterId: 'a',
      vote: 'unsatisfied',
      createdAt: new Date().toISOString(),
    });
    const found = votes.findByVoter(discussionId, 'agent', 'a');
    expect(found).not.toBeNull();
    expect(found!.vote).toBe('unsatisfied');
  });

  it('finds all votes by discussion', () => {
    votes.upsert({
      discussionId,
      voterType: 'agent',
      voterId: 'b',
      vote: 'satisfied',
      createdAt: new Date().toISOString(),
    });
    const all = votes.findByDiscussion(discussionId);
    expect(all.length).toBe(2);
  });
});
