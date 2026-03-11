import type { TrackSummary, SummaryId, TrackId } from '@foundation/types';

export interface SummaryRepository {
  findLatest(trackId: TrackId): TrackSummary | null;
  findById(id: SummaryId): TrackSummary | null;
  findAllByTrack(trackId: TrackId): TrackSummary[];
  create(trackId: TrackId, content: string): TrackSummary;
}
