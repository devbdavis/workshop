import type { TicketImportIgnore, TicketSource } from '@foundation/types';

export interface TicketImportIgnoreRepository {
  findBySource(source: TicketSource): TicketImportIgnore[];
  findOne(source: TicketSource, externalId: string): TicketImportIgnore | null;
  add(data: {
    source: TicketSource;
    externalId: string;
    cachedTitle?: string;
    cachedUrl?: string;
  }): TicketImportIgnore;
  remove(source: TicketSource, externalId: string): boolean;
}
