import type {
  ExternalTicket,
  TicketId,
  TrackId,
  TicketSource,
  TicketRelationship,
} from '@foundation/types';

export interface TicketRepository {
  findById(id: TicketId): ExternalTicket | null;
  findByTrack(trackId: TrackId): ExternalTicket[];
  findByExternalId(source: TicketSource, externalId: string): ExternalTicket[];
  create(ticket: Omit<ExternalTicket, 'id' | 'createdAt'>): ExternalTicket;
  updateCachedData(
    id: TicketId,
    data: { cachedTitle?: string; cachedStatus?: string; cachedData?: string },
  ): ExternalTicket | null;
  updateRelationship(id: TicketId, relationship: TicketRelationship): ExternalTicket | null;
  delete(id: TicketId): boolean;
}
