import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { DiscussionTeamRepository } from '@domain/discussion/repository';
import type { DiscussionTeam, DiscussionTeamId, ConsensusRule } from '@foundation/discussion-types';
import type { AgentId } from '@foundation/types';

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  consensus_rule: string;
  member_agent_ids: string;
  created_at: string;
  updated_at: string;
}

function rowToTeam(row: TeamRow): DiscussionTeam {
  return {
    id: row.id as DiscussionTeamId,
    name: row.name,
    description: row.description || undefined,
    consensusRule: JSON.parse(row.consensus_rule) as ConsensusRule,
    memberAgentIds: JSON.parse(row.member_agent_ids) as AgentId[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDiscussionTeamRepository(): DiscussionTeamRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM discussion_teams ORDER BY created_at ASC');
  const findByIdStmt = db.prepare('SELECT * FROM discussion_teams WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO discussion_teams (id, name, description, consensus_rule, member_agent_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE discussion_teams SET name = ?, description = ?, consensus_rule = ?, member_agent_ids = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM discussion_teams WHERE id = ?');

  return {
    findAll(): DiscussionTeam[] {
      return (findAllStmt.all() as TeamRow[]).map(rowToTeam);
    },

    findById(id: DiscussionTeamId): DiscussionTeam | null {
      const row = findByIdStmt.get(id) as TeamRow | undefined;
      return row ? rowToTeam(row) : null;
    },

    create(data): DiscussionTeam {
      const id = uuid() as DiscussionTeamId;
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        data.name,
        data.description || null,
        JSON.stringify(data.consensusRule),
        JSON.stringify(data.memberAgentIds),
        now,
        now,
      );
      return { id, ...data, createdAt: now, updatedAt: now };
    },

    update(id, data): DiscussionTeam | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const description = data.description !== undefined ? data.description : existing.description;
      const consensusRule = data.consensusRule ?? existing.consensusRule;
      const memberAgentIds = data.memberAgentIds ?? existing.memberAgentIds;
      updateStmt.run(
        name,
        description || null,
        JSON.stringify(consensusRule),
        JSON.stringify(memberAgentIds),
        now,
        id,
      );
      return { ...existing, name, description, consensusRule, memberAgentIds, updatedAt: now };
    },

    delete(id): boolean {
      return deleteStmt.run(id).changes > 0;
    },
  };
}
