import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-issue-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createIssueRepository } from '@infrastructure/persistence/issue-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { IssueId } from '@foundation/types';

describe('Issue Repository', () => {
  const issueRepo = createIssueRepository();
  const trackRepo = createTrackRepository();

  // Helper to create a parent track for issues
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
    it('should create an issue with required fields', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'PROJ-123',
        relationship: 'primary',
      });

      expect(issue).toBeDefined();
      expect(issue.id).toBeDefined();
      expect(issue.trackId).toBe(track.id);
      expect(issue.source).toBe('jira');
      expect(issue.externalId).toBe('PROJ-123');
      expect(issue.relationship).toBe('primary');
      expect(issue.createdAt).toBeDefined();
    });

    it('should create an issue with cached data', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: 'LIN-456',
        relationship: 'related',
        cachedTitle: 'Fix the bug',
        cachedStatus: 'In Progress',
        cachedData: '{"priority": "high"}',
        lastSyncedAt: '2026-01-01T00:00:00Z',
      });

      expect(issue.cachedTitle).toBe('Fix the bug');
      expect(issue.cachedStatus).toBe('In Progress');
      expect(issue.cachedData).toBe('{"priority": "high"}');
      expect(issue.lastSyncedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('should generate unique IDs', () => {
      const track = createParentTrack();
      const t1 = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'A-1',
        relationship: 'primary',
      });
      const t2 = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'A-2',
        relationship: 'related',
      });

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('findById', () => {
    it('should find an issue by its ID', () => {
      const track = createParentTrack();
      const created = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'FIND-1',
        relationship: 'primary',
      });

      const found = issueRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.externalId).toBe('FIND-1');
    });

    it('should return null for non-existent issue', () => {
      const found = issueRepo.findById('non-existent' as IssueId);

      expect(found).toBeNull();
    });
  });

  describe('findByTrack', () => {
    it('should find all issues for a track', () => {
      const track = createParentTrack();
      issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'TRACK-1',
        relationship: 'primary',
      });
      issueRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: 'TRACK-2',
        relationship: 'related',
      });

      const issues = issueRepo.findByTrack(track.id);

      expect(issues).toHaveLength(2);
      expect(issues.every((t) => t.trackId === track.id)).toBe(true);
    });

    it('should return empty array for track with no issues', () => {
      const track = createParentTrack();
      const issues = issueRepo.findByTrack(track.id);

      expect(issues).toHaveLength(0);
    });

    it('should not include issues from other tracks', () => {
      const track1 = createParentTrack('Issue Track 1');
      const track2 = createParentTrack('Issue Track 2');
      issueRepo.create({
        trackId: track1.id,
        source: 'jira',
        externalId: 'T1-1',
        relationship: 'primary',
      });
      issueRepo.create({
        trackId: track2.id,
        source: 'jira',
        externalId: 'T2-1',
        relationship: 'primary',
      });

      const issues = issueRepo.findByTrack(track1.id);

      expect(issues).toHaveLength(1);
      expect(issues[0].trackId).toBe(track1.id);
    });
  });

  describe('findByExternalId', () => {
    it('should find issues by source and external ID', () => {
      const track = createParentTrack();
      const extId = `EXT-UNIQUE-${randomUUID()}`;
      issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: extId,
        relationship: 'primary',
      });

      const issues = issueRepo.findByExternalId('jira', extId);

      expect(issues).toHaveLength(1);
      expect(issues[0].externalId).toBe(extId);
      expect(issues[0].source).toBe('jira');
    });

    it('should return empty array when no match found', () => {
      const issues = issueRepo.findByExternalId('jira', 'NONEXISTENT-999');

      expect(issues).toHaveLength(0);
    });

    it('should distinguish between sources for the same external ID', () => {
      const track = createParentTrack();
      const sharedId = `SHARED-${randomUUID()}`;
      issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: sharedId,
        relationship: 'primary',
      });
      issueRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: sharedId,
        relationship: 'related',
      });

      const jiraIssues = issueRepo.findByExternalId('jira', sharedId);
      const linearIssues = issueRepo.findByExternalId('linear', sharedId);

      expect(jiraIssues).toHaveLength(1);
      expect(jiraIssues[0].source).toBe('jira');
      expect(linearIssues).toHaveLength(1);
      expect(linearIssues[0].source).toBe('linear');
    });

    it('should return multiple issues if the same external ID is linked to different tracks', () => {
      const track1 = createParentTrack();
      const track2 = createParentTrack();
      const extId = `MULTI-${randomUUID()}`;
      issueRepo.create({
        trackId: track1.id,
        source: 'jira',
        externalId: extId,
        relationship: 'primary',
      });
      issueRepo.create({
        trackId: track2.id,
        source: 'jira',
        externalId: extId,
        relationship: 'related',
      });

      const issues = issueRepo.findByExternalId('jira', extId);

      expect(issues).toHaveLength(2);
    });
  });

  describe('updateCachedData', () => {
    it('should update cached title and status', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-1',
        relationship: 'primary',
      });

      const updated = issueRepo.updateCachedData(issue.id, {
        cachedTitle: 'Updated Title',
        cachedStatus: 'Done',
      });

      expect(updated).not.toBeNull();
      expect(updated!.cachedTitle).toBe('Updated Title');
      expect(updated!.cachedStatus).toBe('Done');
      expect(updated!.lastSyncedAt).toBeDefined();
    });

    it('should update cached data JSON', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-2',
        relationship: 'primary',
      });

      const updated = issueRepo.updateCachedData(issue.id, {
        cachedData: '{"description": "Updated"}',
      });

      expect(updated).not.toBeNull();
      expect(updated!.cachedData).toBe('{"description": "Updated"}');
    });

    it('should preserve existing cached fields when updating only some', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-3',
        relationship: 'primary',
        cachedTitle: 'Original Title',
        cachedStatus: 'Open',
      });

      const updated = issueRepo.updateCachedData(issue.id, {
        cachedStatus: 'Closed',
      });

      expect(updated).not.toBeNull();
      expect(updated!.cachedTitle).toBe('Original Title');
      expect(updated!.cachedStatus).toBe('Closed');
    });

    it('should return null when updating non-existent issue', () => {
      const result = issueRepo.updateCachedData('non-existent' as IssueId, {
        cachedTitle: 'Nope',
      });

      expect(result).toBeNull();
    });
  });

  describe('updateRelationship', () => {
    it('should update issue relationship to blocked-by', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'REL-1',
        relationship: 'primary',
      });

      const updated = issueRepo.updateRelationship(issue.id, 'blocked-by');

      expect(updated).not.toBeNull();
      expect(updated!.relationship).toBe('blocked-by');
    });

    it('should update issue relationship to related', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'REL-2',
        relationship: 'primary',
      });

      const updated = issueRepo.updateRelationship(issue.id, 'related');

      expect(updated).not.toBeNull();
      expect(updated!.relationship).toBe('related');
    });

    it('should return null when updating relationship of non-existent issue', () => {
      const result = issueRepo.updateRelationship('non-existent' as IssueId, 'related');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an issue and return true', () => {
      const track = createParentTrack();
      const issue = issueRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'DEL-1',
        relationship: 'primary',
      });

      const result = issueRepo.delete(issue.id);

      expect(result).toBe(true);
      expect(issueRepo.findById(issue.id)).toBeNull();
    });

    it('should return false when deleting a non-existent issue', () => {
      const result = issueRepo.delete('non-existent' as IssueId);

      expect(result).toBe(false);
    });
  });
});
