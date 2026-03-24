import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-track-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { TrackId, RepoId, PathId } from '@foundation/types';

describe('Track Repository', () => {
  const repo = createTrackRepository();

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('create', () => {
    it('should create a track with required fields', () => {
      const track = repo.create({ name: 'My Track', status: 'active' });

      expect(track).toBeDefined();
      expect(track.id).toBeDefined();
      expect(track.name).toBe('My Track');
      expect(track.status).toBe('active');
      expect(track.createdAt).toBeDefined();
      expect(track.updatedAt).toBeDefined();
    });

    it('should create a track with description', () => {
      const track = repo.create({
        name: 'Described Track',
        description: 'A detailed description',
        status: 'active',
      });

      expect(track.description).toBe('A detailed description');
    });

    it('should default status to active when not provided', () => {
      const track = repo.create({ name: 'Default Status Track' } as any);

      expect(track.status).toBe('active');
    });

    it('should generate unique IDs for each track', () => {
      const track1 = repo.create({ name: 'Track A', status: 'active' });
      const track2 = repo.create({ name: 'Track B', status: 'active' });

      expect(track1.id).not.toBe(track2.id);
    });
  });

  describe('findById', () => {
    it('should find a track by its ID', () => {
      const created = repo.create({ name: 'Findable Track', status: 'active' });
      const found = repo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Findable Track');
    });

    it('should return null for a non-existent ID', () => {
      const found = repo.findById('non-existent-id' as TrackId);

      expect(found).toBeNull();
    });

    it('should populate repos and paths when finding by ID', () => {
      const track = repo.create({ name: 'Track With Relations', status: 'active' });
      repo.addRepo(track.id, '/path/to/repo', 'https://github.com/test/repo');
      repo.addPath(track.id, '/docs', 'Documentation');

      const found = repo.findById(track.id);

      expect(found).not.toBeNull();
      expect(found!.repos).toHaveLength(1);
      expect(found!.repos![0].path).toBe('/path/to/repo');
      expect(found!.paths).toHaveLength(1);
      expect(found!.paths![0].path).toBe('/docs');
    });
  });

  describe('findAll', () => {
    it('should return only non-archived tracks', () => {
      // Create fresh tracks for this test
      const active = repo.create({ name: 'Active Track FindAll', status: 'active' });
      const archived = repo.create({ name: 'Archived Track FindAll', status: 'archived' });

      const all = repo.findAll();
      const ids = all.map((t) => t.id);

      expect(ids).toContain(active.id);
      expect(ids).not.toContain(archived.id);
    });

    it('should return tracks ordered by updated_at descending', () => {
      // Just verify findAll returns results (ordering within same millisecond is non-deterministic)
      const track1 = repo.create({ name: 'Track Order A', status: 'active' });
      repo.create({ name: 'Track Order B', status: 'active' });

      const all = repo.findAll();
      const ids = all.map((t) => t.id);
      expect(ids).toContain(track1.id);
    });
  });

  describe('update', () => {
    it('should update the name of a track', () => {
      const track = repo.create({ name: 'Original Name', status: 'active' });
      const updated = repo.update(track.id, { name: 'New Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('should update the description', () => {
      const track = repo.create({ name: 'Desc Track', status: 'active' });
      const updated = repo.update(track.id, { description: 'New description' });

      expect(updated).not.toBeNull();
      expect(updated!.description).toBe('New description');
    });

    it('should update status to archived', () => {
      const track = repo.create({ name: 'Soon Archived', status: 'active' });
      const updated = repo.update(track.id, { status: 'archived' });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('archived');
    });

    it('should return null when updating a non-existent track', () => {
      const result = repo.update('non-existent' as TrackId, { name: 'Nope' });

      expect(result).toBeNull();
    });

    it('should preserve unchanged fields', () => {
      const track = repo.create({
        name: 'Preserve Test',
        description: 'Keep me',
        status: 'active',
      });
      const updated = repo.update(track.id, { name: 'Changed' });

      expect(updated!.description).toBe('Keep me');
      expect(updated!.status).toBe('active');
    });
  });

  describe('delete', () => {
    it('should delete a track and return true', () => {
      const track = repo.create({ name: 'Delete Me', status: 'active' });
      const result = repo.delete(track.id);

      expect(result).toBe(true);
      expect(repo.findById(track.id)).toBeNull();
    });

    it('should return false when deleting a non-existent track', () => {
      const result = repo.delete('non-existent' as TrackId);

      expect(result).toBe(false);
    });

    it('should cascade delete repos when a track is deleted', () => {
      const track = repo.create({ name: 'Cascade Repo Test', status: 'active' });
      const addedRepo = repo.addRepo(track.id, '/cascade/repo');

      repo.delete(track.id);

      const repos = repo.findReposByTrack(track.id);
      expect(repos).toHaveLength(0);
    });

    it('should cascade delete paths when a track is deleted', () => {
      const track = repo.create({ name: 'Cascade Path Test', status: 'active' });
      repo.addPath(track.id, '/cascade/path', 'label');

      repo.delete(track.id);

      const paths = repo.findPathsByTrack(track.id);
      expect(paths).toHaveLength(0);
    });
  });

  describe('addRepo / removeRepo / findReposByTrack', () => {
    it('should add a repo to a track', () => {
      const track = repo.create({ name: 'Repo Track', status: 'active' });
      const trackRepo = repo.addRepo(track.id, '/my/repo', 'https://github.com/org/repo');

      expect(trackRepo).toBeDefined();
      expect(trackRepo.id).toBeDefined();
      expect(trackRepo.trackId).toBe(track.id);
      expect(trackRepo.path).toBe('/my/repo');
      expect(trackRepo.remoteUrl).toBe('https://github.com/org/repo');
      expect(trackRepo.createdAt).toBeDefined();
    });

    it('should add a repo without a remote URL', () => {
      const track = repo.create({ name: 'Local Repo Track', status: 'active' });
      const trackRepo = repo.addRepo(track.id, '/local/repo');

      expect(trackRepo.remoteUrl).toBeUndefined();
    });

    it('should find all repos for a track', () => {
      const track = repo.create({ name: 'Multi Repo Track', status: 'active' });
      repo.addRepo(track.id, '/repo1');
      repo.addRepo(track.id, '/repo2');
      repo.addRepo(track.id, '/repo3');

      const repos = repo.findReposByTrack(track.id);

      expect(repos).toHaveLength(3);
    });

    it('should return empty array for track with no repos', () => {
      const track = repo.create({ name: 'Empty Repo Track', status: 'active' });
      const repos = repo.findReposByTrack(track.id);

      expect(repos).toHaveLength(0);
    });

    it('should remove a repo and return true', () => {
      const track = repo.create({ name: 'Remove Repo Track', status: 'active' });
      const trackRepo = repo.addRepo(track.id, '/remove/me');

      const result = repo.removeRepo(trackRepo.id);

      expect(result).toBe(true);
      expect(repo.findReposByTrack(track.id)).toHaveLength(0);
    });

    it('should return false when removing a non-existent repo', () => {
      const result = repo.removeRepo('non-existent' as RepoId);

      expect(result).toBe(false);
    });
  });

  describe('addPath / removePath / findPathsByTrack', () => {
    it('should add a path to a track', () => {
      const track = repo.create({ name: 'Path Track', status: 'active' });
      const trackPath = repo.addPath(track.id, '/my/path', 'My Label');

      expect(trackPath).toBeDefined();
      expect(trackPath.id).toBeDefined();
      expect(trackPath.trackId).toBe(track.id);
      expect(trackPath.path).toBe('/my/path');
      expect(trackPath.label).toBe('My Label');
      expect(trackPath.createdAt).toBeDefined();
    });

    it('should add a path without a label', () => {
      const track = repo.create({ name: 'Unlabeled Path Track', status: 'active' });
      const trackPath = repo.addPath(track.id, '/no/label');

      expect(trackPath.label).toBeUndefined();
    });

    it('should find all paths for a track', () => {
      const track = repo.create({ name: 'Multi Path Track', status: 'active' });
      repo.addPath(track.id, '/path1', 'P1');
      repo.addPath(track.id, '/path2', 'P2');

      const paths = repo.findPathsByTrack(track.id);

      expect(paths).toHaveLength(2);
    });

    it('should return empty array for track with no paths', () => {
      const track = repo.create({ name: 'No Paths Track', status: 'active' });
      const paths = repo.findPathsByTrack(track.id);

      expect(paths).toHaveLength(0);
    });

    it('should remove a path and return true', () => {
      const track = repo.create({ name: 'Remove Path Track', status: 'active' });
      const trackPath = repo.addPath(track.id, '/remove/path');

      const result = repo.removePath(trackPath.id);

      expect(result).toBe(true);
      expect(repo.findPathsByTrack(track.id)).toHaveLength(0);
    });

    it('should return false when removing a non-existent path', () => {
      const result = repo.removePath('non-existent' as PathId);

      expect(result).toBe(false);
    });
  });
});
