import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up isolated test database before any imports that use it
const testDbPath = path.join(os.tmpdir(), `workshop-test-ticket-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createTicketRepository } from '@infrastructure/persistence/ticket-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { resetDatabase } from '@infrastructure/persistence/database';
import type { TicketId, TrackId } from '@foundation/types';

describe('Ticket Repository', () => {
  const ticketRepo = createTicketRepository();
  const trackRepo = createTrackRepository();

  // Helper to create a parent track for tickets
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
    it('should create a ticket with required fields', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'PROJ-123',
        relationship: 'primary',
      });

      expect(ticket).toBeDefined();
      expect(ticket.id).toBeDefined();
      expect(ticket.trackId).toBe(track.id);
      expect(ticket.source).toBe('jira');
      expect(ticket.externalId).toBe('PROJ-123');
      expect(ticket.relationship).toBe('primary');
      expect(ticket.createdAt).toBeDefined();
    });

    it('should create a ticket with cached data', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: 'LIN-456',
        relationship: 'related',
        cachedTitle: 'Fix the bug',
        cachedStatus: 'In Progress',
        cachedData: '{"priority": "high"}',
        lastSyncedAt: '2026-01-01T00:00:00Z',
      });

      expect(ticket.cachedTitle).toBe('Fix the bug');
      expect(ticket.cachedStatus).toBe('In Progress');
      expect(ticket.cachedData).toBe('{"priority": "high"}');
      expect(ticket.lastSyncedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('should generate unique IDs', () => {
      const track = createParentTrack();
      const t1 = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'A-1',
        relationship: 'primary',
      });
      const t2 = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'A-2',
        relationship: 'related',
      });

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('findById', () => {
    it('should find a ticket by its ID', () => {
      const track = createParentTrack();
      const created = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'FIND-1',
        relationship: 'primary',
      });

      const found = ticketRepo.findById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.externalId).toBe('FIND-1');
    });

    it('should return null for non-existent ticket', () => {
      const found = ticketRepo.findById('non-existent' as TicketId);

      expect(found).toBeNull();
    });
  });

  describe('findByTrack', () => {
    it('should find all tickets for a track', () => {
      const track = createParentTrack();
      ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'TRACK-1',
        relationship: 'primary',
      });
      ticketRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: 'TRACK-2',
        relationship: 'related',
      });

      const tickets = ticketRepo.findByTrack(track.id);

      expect(tickets).toHaveLength(2);
      expect(tickets.every((t) => t.trackId === track.id)).toBe(true);
    });

    it('should return empty array for track with no tickets', () => {
      const track = createParentTrack();
      const tickets = ticketRepo.findByTrack(track.id);

      expect(tickets).toHaveLength(0);
    });

    it('should not include tickets from other tracks', () => {
      const track1 = createParentTrack('Ticket Track 1');
      const track2 = createParentTrack('Ticket Track 2');
      ticketRepo.create({
        trackId: track1.id,
        source: 'jira',
        externalId: 'T1-1',
        relationship: 'primary',
      });
      ticketRepo.create({
        trackId: track2.id,
        source: 'jira',
        externalId: 'T2-1',
        relationship: 'primary',
      });

      const tickets = ticketRepo.findByTrack(track1.id);

      expect(tickets).toHaveLength(1);
      expect(tickets[0].trackId).toBe(track1.id);
    });
  });

  describe('findByExternalId', () => {
    it('should find tickets by source and external ID', () => {
      const track = createParentTrack();
      const extId = `EXT-UNIQUE-${randomUUID()}`;
      ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: extId,
        relationship: 'primary',
      });

      const tickets = ticketRepo.findByExternalId('jira', extId);

      expect(tickets).toHaveLength(1);
      expect(tickets[0].externalId).toBe(extId);
      expect(tickets[0].source).toBe('jira');
    });

    it('should return empty array when no match found', () => {
      const tickets = ticketRepo.findByExternalId('jira', 'NONEXISTENT-999');

      expect(tickets).toHaveLength(0);
    });

    it('should distinguish between sources for the same external ID', () => {
      const track = createParentTrack();
      const sharedId = `SHARED-${randomUUID()}`;
      ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: sharedId,
        relationship: 'primary',
      });
      ticketRepo.create({
        trackId: track.id,
        source: 'linear',
        externalId: sharedId,
        relationship: 'related',
      });

      const jiraTickets = ticketRepo.findByExternalId('jira', sharedId);
      const linearTickets = ticketRepo.findByExternalId('linear', sharedId);

      expect(jiraTickets).toHaveLength(1);
      expect(jiraTickets[0].source).toBe('jira');
      expect(linearTickets).toHaveLength(1);
      expect(linearTickets[0].source).toBe('linear');
    });

    it('should return multiple tickets if the same external ID is linked to different tracks', () => {
      const track1 = createParentTrack();
      const track2 = createParentTrack();
      const extId = `MULTI-${randomUUID()}`;
      ticketRepo.create({
        trackId: track1.id,
        source: 'jira',
        externalId: extId,
        relationship: 'primary',
      });
      ticketRepo.create({
        trackId: track2.id,
        source: 'jira',
        externalId: extId,
        relationship: 'related',
      });

      const tickets = ticketRepo.findByExternalId('jira', extId);

      expect(tickets).toHaveLength(2);
    });
  });

  describe('updateCachedData', () => {
    it('should update cached title and status', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-1',
        relationship: 'primary',
      });

      const updated = ticketRepo.updateCachedData(ticket.id, {
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
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-2',
        relationship: 'primary',
      });

      const updated = ticketRepo.updateCachedData(ticket.id, {
        cachedData: '{"description": "Updated"}',
      });

      expect(updated).not.toBeNull();
      expect(updated!.cachedData).toBe('{"description": "Updated"}');
    });

    it('should preserve existing cached fields when updating only some', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'CACHE-3',
        relationship: 'primary',
        cachedTitle: 'Original Title',
        cachedStatus: 'Open',
      });

      const updated = ticketRepo.updateCachedData(ticket.id, {
        cachedStatus: 'Closed',
      });

      expect(updated).not.toBeNull();
      expect(updated!.cachedTitle).toBe('Original Title');
      expect(updated!.cachedStatus).toBe('Closed');
    });

    it('should return null when updating non-existent ticket', () => {
      const result = ticketRepo.updateCachedData('non-existent' as TicketId, {
        cachedTitle: 'Nope',
      });

      expect(result).toBeNull();
    });
  });

  describe('updateRelationship', () => {
    it('should update ticket relationship to blocked-by', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'REL-1',
        relationship: 'primary',
      });

      const updated = ticketRepo.updateRelationship(ticket.id, 'blocked-by');

      expect(updated).not.toBeNull();
      expect(updated!.relationship).toBe('blocked-by');
    });

    it('should update ticket relationship to related', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'REL-2',
        relationship: 'primary',
      });

      const updated = ticketRepo.updateRelationship(ticket.id, 'related');

      expect(updated).not.toBeNull();
      expect(updated!.relationship).toBe('related');
    });

    it('should return null when updating relationship of non-existent ticket', () => {
      const result = ticketRepo.updateRelationship('non-existent' as TicketId, 'related');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a ticket and return true', () => {
      const track = createParentTrack();
      const ticket = ticketRepo.create({
        trackId: track.id,
        source: 'jira',
        externalId: 'DEL-1',
        relationship: 'primary',
      });

      const result = ticketRepo.delete(ticket.id);

      expect(result).toBe(true);
      expect(ticketRepo.findById(ticket.id)).toBeNull();
    });

    it('should return false when deleting a non-existent ticket', () => {
      const result = ticketRepo.delete('non-existent' as TicketId);

      expect(result).toBe(false);
    });
  });
});
