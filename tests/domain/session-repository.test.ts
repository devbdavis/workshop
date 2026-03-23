import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-session-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createSessionRepository } from '@infrastructure/persistence/session-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { SessionId } from '@foundation/types';

describe('Session Repository', () => {
  const sessionRepo = createSessionRepository();
  const trackRepo = createTrackRepository();

  // Helper to create a parent track for sessions
  function createParentTrack(name?: string) {
    return trackRepo.create({ name: name || `Track-${randomUUID()}`, status: 'active' });
  }

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('create', () => {
    it('should create a session with required fields', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-${randomUUID()}`,
        state: 'active',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.trackId).toBe(track.id);
      expect(session.state).toBe('active');
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it('should create a session with optional fields', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-${randomUUID()}`,
        claudeResumeId: 'resume-123',
        systemPrompt: 'You are a helpful assistant',
        state: 'active',
      });

      expect(session.claudeResumeId).toBe('resume-123');
      expect(session.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should default provider to claude', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-provider-default-${randomUUID()}`,
        state: 'active',
      });

      expect(session.provider).toBe('claude');
      const found = sessionRepo.findById(session.id);
      expect(found!.provider).toBe('claude');
    });

    it('should create a codex session when provider is codex', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-codex-${randomUUID()}`,
        state: 'active',
        provider: 'codex',
      });

      expect(session.provider).toBe('codex');
      const found = sessionRepo.findById(session.id);
      expect(found!.provider).toBe('codex');
    });

    it('should create a session with a name', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-named-${randomUUID()}`,
        name: 'build-runner',
        state: 'active',
      });

      expect(session.name).toBe('build-runner');
      const found = sessionRepo.findById(session.id);
      expect(found!.name).toBe('build-runner');
    });

    it('should generate unique session IDs', () => {
      const track = createParentTrack();
      const s1 = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-a-${randomUUID()}`,
        state: 'active',
      });
      const s2 = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-b-${randomUUID()}`,
        state: 'active',
      });

      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('findById', () => {
    it('should find a session by ID', () => {
      const track = createParentTrack();
      const created = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-find-${randomUUID()}`,
        state: 'active',
      });

      const found = sessionRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('should return null for non-existent session', () => {
      const found = sessionRepo.findById('non-existent' as SessionId);

      expect(found).toBeNull();
    });
  });

  describe('findByTrack', () => {
    it('should find all sessions for a track', () => {
      const track = createParentTrack();
      sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-track1-${randomUUID()}`,
        state: 'active',
      });
      sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-track2-${randomUUID()}`,
        state: 'detached',
      });

      const sessions = sessionRepo.findByTrack(track.id);

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.trackId === track.id)).toBe(true);
    });

    it('should return empty array for track with no sessions', () => {
      const track = createParentTrack();
      const sessions = sessionRepo.findByTrack(track.id);

      expect(sessions).toHaveLength(0);
    });

    it('should not include sessions from other tracks', () => {
      const track1 = createParentTrack('Track 1');
      const track2 = createParentTrack('Track 2');
      sessionRepo.create({
        trackId: track1.id,
        tmuxSession: `tmux-t1-${randomUUID()}`,
        state: 'active',
      });
      sessionRepo.create({
        trackId: track2.id,
        tmuxSession: `tmux-t2-${randomUUID()}`,
        state: 'active',
      });

      const sessions = sessionRepo.findByTrack(track1.id);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].trackId).toBe(track1.id);
    });
  });

  describe('findByTmuxSession', () => {
    it('should find a session by tmux session name', () => {
      const track = createParentTrack();
      const tmuxName = `tmux-unique-${randomUUID()}`;
      sessionRepo.create({
        trackId: track.id,
        tmuxSession: tmuxName,
        state: 'active',
      });

      const found = sessionRepo.findByTmuxSession(tmuxName);

      expect(found).not.toBeNull();
      expect(found!.tmuxSession).toBe(tmuxName);
    });

    it('should return null for non-existent tmux session', () => {
      const found = sessionRepo.findByTmuxSession('does-not-exist');

      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all sessions', () => {
      const all = sessionRepo.findAll();

      // We have created several sessions in previous tests
      expect(all.length).toBeGreaterThan(0);
    });
  });

  describe('updateState', () => {
    it('should update session state to detached', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-state-${randomUUID()}`,
        state: 'active',
      });

      const updated = sessionRepo.updateState(session.id, 'detached');

      expect(updated).not.toBeNull();
      expect(updated!.state).toBe('detached');
    });

    it('should update session state to dead', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-dead-${randomUUID()}`,
        state: 'active',
      });

      const updated = sessionRepo.updateState(session.id, 'dead');

      expect(updated).not.toBeNull();
      expect(updated!.state).toBe('dead');
    });

    it('should return null when updating state of non-existent session', () => {
      const result = sessionRepo.updateState('non-existent' as SessionId, 'dead');

      expect(result).toBeNull();
    });
  });

  describe('updateName', () => {
    it('should update the session name', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-name-${randomUUID()}`,
        state: 'active',
      });

      const updated = sessionRepo.updateName(session.id, 'my-build-session');

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('my-build-session');
    });

    it('should persist the name so it can be retrieved later', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-name-persist-${randomUUID()}`,
        state: 'active',
      });

      sessionRepo.updateName(session.id, 'persistent-name');
      const found = sessionRepo.findById(session.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('persistent-name');
    });

    it('should allow setting name to empty string to clear it', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-name-clear-${randomUUID()}`,
        state: 'active',
      });

      sessionRepo.updateName(session.id, 'temp-name');
      const updated = sessionRepo.updateName(session.id, '');

      expect(updated).not.toBeNull();
      // Empty string is falsy, so rowToSession converts to undefined
      expect(updated!.name).toBeUndefined();
    });

    it('should return null when updating name of non-existent session', () => {
      const result = sessionRepo.updateName('non-existent' as SessionId, 'some-name');

      expect(result).toBeNull();
    });
  });

  describe('updateClaudeResumeId', () => {
    it('should update the Claude resume ID', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-resume-${randomUUID()}`,
        state: 'active',
      });

      const updated = sessionRepo.updateClaudeResumeId(session.id, 'new-resume-id');

      expect(updated).not.toBeNull();
      expect(updated!.claudeResumeId).toBe('new-resume-id');
    });

    it('should return null when updating resume ID of non-existent session', () => {
      const result = sessionRepo.updateClaudeResumeId('non-existent' as SessionId, 'resume-id');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a session and return true', () => {
      const track = createParentTrack();
      const session = sessionRepo.create({
        trackId: track.id,
        tmuxSession: `tmux-delete-${randomUUID()}`,
        state: 'active',
      });

      const result = sessionRepo.delete(session.id);

      expect(result).toBe(true);
      expect(sessionRepo.findById(session.id)).toBeNull();
    });

    it('should return false when deleting a non-existent session', () => {
      const result = sessionRepo.delete('non-existent' as SessionId);

      expect(result).toBe(false);
    });
  });
});
