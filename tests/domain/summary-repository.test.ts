import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-summary-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createSummaryRepository } from '@infrastructure/persistence/summary-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { SummaryId, TrackId } from '@foundation/types';

describe('Summary Repository', () => {
  const summaryRepo = createSummaryRepository();
  const trackRepo = createTrackRepository();

  // Helper to create a parent track for summaries
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
    it('should create a summary with version 1 for a new track', () => {
      const track = createParentTrack();
      const summary = summaryRepo.create(track.id, 'Initial summary content');

      expect(summary).toBeDefined();
      expect(summary.id).toBeDefined();
      expect(summary.trackId).toBe(track.id);
      expect(summary.content).toBe('Initial summary content');
      expect(summary.version).toBe(1);
      expect(summary.createdAt).toBeDefined();
    });

    it('should auto-increment version for subsequent summaries', () => {
      const track = createParentTrack();

      const s1 = summaryRepo.create(track.id, 'Version 1 content');
      const s2 = summaryRepo.create(track.id, 'Version 2 content');
      const s3 = summaryRepo.create(track.id, 'Version 3 content');

      expect(s1.version).toBe(1);
      expect(s2.version).toBe(2);
      expect(s3.version).toBe(3);
    });

    it('should maintain separate version sequences per track', () => {
      const track1 = createParentTrack('Summary Track 1');
      const track2 = createParentTrack('Summary Track 2');

      const s1 = summaryRepo.create(track1.id, 'Track 1 summary');
      const s2 = summaryRepo.create(track2.id, 'Track 2 summary');

      expect(s1.version).toBe(1);
      expect(s2.version).toBe(1);
    });

    it('should generate unique IDs for each summary', () => {
      const track = createParentTrack();
      const s1 = summaryRepo.create(track.id, 'Summary A');
      const s2 = summaryRepo.create(track.id, 'Summary B');

      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('findById', () => {
    it('should find a summary by its ID', () => {
      const track = createParentTrack();
      const created = summaryRepo.create(track.id, 'Find me by ID');

      const found = summaryRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('Find me by ID');
    });

    it('should return null for non-existent ID', () => {
      const found = summaryRepo.findById('non-existent' as SummaryId);

      expect(found).toBeNull();
    });
  });

  describe('findLatest', () => {
    it('should return the latest (highest version) summary for a track', () => {
      const track = createParentTrack();
      summaryRepo.create(track.id, 'Old content');
      summaryRepo.create(track.id, 'Middle content');
      summaryRepo.create(track.id, 'Latest content');

      const latest = summaryRepo.findLatest(track.id);

      expect(latest).not.toBeNull();
      expect(latest!.version).toBe(3);
      expect(latest!.content).toBe('Latest content');
    });

    it('should return null for a track with no summaries', () => {
      const track = createParentTrack();
      const latest = summaryRepo.findLatest(track.id);

      expect(latest).toBeNull();
    });

    it('should return the only summary for a track with one summary', () => {
      const track = createParentTrack();
      const created = summaryRepo.create(track.id, 'Only summary');

      const latest = summaryRepo.findLatest(track.id);

      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(created.id);
      expect(latest!.version).toBe(1);
    });
  });

  describe('findAllByTrack', () => {
    it('should return all summaries ordered by version descending', () => {
      const track = createParentTrack();
      summaryRepo.create(track.id, 'First');
      summaryRepo.create(track.id, 'Second');
      summaryRepo.create(track.id, 'Third');

      const all = summaryRepo.findAllByTrack(track.id);

      expect(all).toHaveLength(3);
      // Should be ordered version DESC: 3, 2, 1
      expect(all[0].version).toBe(3);
      expect(all[1].version).toBe(2);
      expect(all[2].version).toBe(1);
    });

    it('should return empty array for a track with no summaries', () => {
      const track = createParentTrack();
      const all = summaryRepo.findAllByTrack(track.id);

      expect(all).toHaveLength(0);
    });

    it('should not include summaries from other tracks', () => {
      const track1 = createParentTrack('Track A');
      const track2 = createParentTrack('Track B');
      summaryRepo.create(track1.id, 'Track A summary');
      summaryRepo.create(track2.id, 'Track B summary');

      const all = summaryRepo.findAllByTrack(track1.id);

      expect(all).toHaveLength(1);
      expect(all[0].trackId).toBe(track1.id);
    });
  });
});
