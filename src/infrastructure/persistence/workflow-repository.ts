import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type {
  WorkflowTicket, WorkflowTicketId, WorkflowTransition, WorkflowTransitionId,
  WorkflowState, WorkflowTicketType, TrackId, TicketId, SessionId,
  AgentId, SessionProvider, TransitionActor,
} from '@foundation/types';
import type {
  WorkflowTicketRepository, WorkflowTicketCreate, WorkflowTicketUpdate,
  WorkflowTransitionRepository, WorkflowTransitionCreate,
} from '@domain/workflow/ticket-repository.js';

// ---------------------------------------------------------------------------
// WorkflowTicketRepository
// ---------------------------------------------------------------------------

export function createWorkflowTicketRepository(): WorkflowTicketRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIdStmt = db.prepare('SELECT * FROM workflow_tickets WHERE id = ?');
  const findChildrenStmt = db.prepare('SELECT * FROM workflow_tickets WHERE parent_id = ? ORDER BY sort_order ASC');
  const findByStateStmt = db.prepare('SELECT * FROM workflow_tickets WHERE state = ? ORDER BY sort_order ASC, created_at DESC');
  const findByExecSessionStmt = db.prepare('SELECT * FROM workflow_tickets WHERE execution_session_id = ? LIMIT 1');
  const findHumanGatePendingStmt = db.prepare("SELECT * FROM workflow_tickets WHERE state IN ('spec-review', 'plan-review', 'final-review') ORDER BY sort_order ASC, created_at DESC");
  const insertStmt = db.prepare(
    `INSERT INTO workflow_tickets
     (id, type, title, description, state, state_data, parent_id, track_id,
      external_ticket_id, assigned_agent_role, assigned_agent_ids, provider,
      priority, labels, sort_order, workflow_template_row_id,
      state_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE workflow_tickets SET
       title = ?, description = ?, state = ?, state_data = ?, track_id = ?,
       external_ticket_id = ?, execution_session_id = ?,
       assigned_agent_role = ?, assigned_agent_ids = ?,
       provider = ?, priority = ?, labels = ?, sort_order = ?,
       workflow_template_row_id = ?,
       state_changed_at = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM workflow_tickets WHERE id = ?');

  return {
    findById(id: WorkflowTicketId): WorkflowTicket | null {
      const row = findByIdStmt.get(id) as TicketRow | undefined;
      return row ? rowToTicket(row) : null;
    },

    findAll(filters?): WorkflowTicket[] {
      // Dynamic query - cannot be pre-prepared due to variable WHERE clauses
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters?.type) { clauses.push('type = ?'); params.push(filters.type); }
      if (filters?.state) { clauses.push('state = ?'); params.push(filters.state); }
      if (filters?.trackId) { clauses.push('track_id = ?'); params.push(filters.trackId); }
      if (filters?.parentId) { clauses.push('parent_id = ?'); params.push(filters.parentId); }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`SELECT * FROM workflow_tickets${where} ORDER BY sort_order ASC, created_at DESC`).all(...params) as TicketRow[];
      return rows.map(rowToTicket);
    },

    findChildren(parentId: WorkflowTicketId): WorkflowTicket[] {
      const rows = findChildrenStmt.all(parentId) as TicketRow[];
      return rows.map(rowToTicket);
    },

    findByState(state: WorkflowState): WorkflowTicket[] {
      const rows = findByStateStmt.all(state) as TicketRow[];
      return rows.map(rowToTicket);
    },

    findByExecutionSessionId(sessionId: string): WorkflowTicket | null {
      const row = findByExecSessionStmt.get(sessionId) as TicketRow | undefined;
      return row ? rowToTicket(row) : null;
    },

    findHumanGatePending(): WorkflowTicket[] {
      const rows = findHumanGatePendingStmt.all() as TicketRow[];
      return rows.map(rowToTicket);
    },

    create(ticket: WorkflowTicketCreate): WorkflowTicket {
      const id = uuid() as WorkflowTicketId;
      const now = new Date().toISOString();
      insertStmt.run(
        id, ticket.type, ticket.title, ticket.description, ticket.state,
        ticket.stateData ? JSON.stringify(ticket.stateData) : null,
        ticket.parentId || null, ticket.trackId || null,
        ticket.externalTicketId || null, ticket.assignedAgentRole || null,
        ticket.assignedAgentIds ? JSON.stringify(ticket.assignedAgentIds) : null,
        ticket.provider || 'claude', ticket.priority || 'medium',
        ticket.labels ? JSON.stringify(ticket.labels) : null,
        ticket.sortOrder ?? 0, ticket.workflowTemplateRowId || null,
        now, now, now,
      );
      return {
        id, ...ticket,
        sortOrder: ticket.sortOrder ?? 0,
        provider: ticket.provider || 'claude',
        priority: ticket.priority || 'medium',
        stateChangedAt: now, createdAt: now, updatedAt: now,
      };
    },

    update(id: WorkflowTicketId, data: WorkflowTicketUpdate): WorkflowTicket | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const stateChanged = data.state !== undefined && data.state !== existing.state;

      const merged: WorkflowTicket = {
        ...existing,
        title: data.title ?? existing.title,
        description: data.description ?? existing.description,
        state: data.state ?? existing.state,
        stateData: data.stateData !== undefined ? data.stateData : existing.stateData,
        trackId: data.trackId !== undefined ? data.trackId : existing.trackId,
        externalTicketId: data.externalTicketId !== undefined ? data.externalTicketId : existing.externalTicketId,
        executionSessionId: data.executionSessionId !== undefined ? data.executionSessionId : existing.executionSessionId,
        assignedAgentRole: data.assignedAgentRole !== undefined ? data.assignedAgentRole : existing.assignedAgentRole,
        assignedAgentIds: data.assignedAgentIds !== undefined ? data.assignedAgentIds : existing.assignedAgentIds,
        provider: data.provider ?? existing.provider,
        priority: data.priority ?? existing.priority,
        labels: data.labels !== undefined ? data.labels : existing.labels,
        sortOrder: data.sortOrder ?? existing.sortOrder,
        workflowTemplateRowId: data.workflowTemplateRowId !== undefined ? data.workflowTemplateRowId : existing.workflowTemplateRowId,
        stateChangedAt: data.stateChangedAt ?? (stateChanged ? now : existing.stateChangedAt),
        updatedAt: now,
      };

      updateStmt.run(
        merged.title, merged.description, merged.state,
        merged.stateData ? JSON.stringify(merged.stateData) : null,
        merged.trackId || null, merged.externalTicketId || null,
        merged.executionSessionId || null,
        merged.assignedAgentRole || null,
        merged.assignedAgentIds ? JSON.stringify(merged.assignedAgentIds) : null,
        merged.provider, merged.priority,
        merged.labels ? JSON.stringify(merged.labels) : null,
        merged.sortOrder,
        merged.workflowTemplateRowId || null,
        merged.stateChangedAt, merged.updatedAt, id,
      );
      return merged;
    },

    delete(id: WorkflowTicketId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// WorkflowTransitionRepository
// ---------------------------------------------------------------------------

export function createWorkflowTransitionRepository(): WorkflowTransitionRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByTicketStmt = db.prepare('SELECT * FROM workflow_transitions WHERE ticket_id = ? ORDER BY created_at DESC');
  const findByTicketWithLimitStmt = db.prepare('SELECT * FROM workflow_transitions WHERE ticket_id = ? ORDER BY created_at DESC LIMIT ?');
  const findByIdStmt = db.prepare('SELECT * FROM workflow_transitions WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO workflow_transitions
     (id, ticket_id, from_state, to_state, actor_type, actor_id, session_id, comment, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    findByTicket(ticketId: WorkflowTicketId, limit?: number): WorkflowTransition[] {
      const rows = (limit
        ? findByTicketWithLimitStmt.all(ticketId, limit)
        : findByTicketStmt.all(ticketId)) as TransitionRow[];
      return rows.map(rowToTransition);
    },

    findById(id: WorkflowTransitionId): WorkflowTransition | null {
      const row = findByIdStmt.get(id) as TransitionRow | undefined;
      return row ? rowToTransition(row) : null;
    },

    create(transition: WorkflowTransitionCreate): WorkflowTransition {
      const id = uuid() as WorkflowTransitionId;
      const now = new Date().toISOString();
      const actor = transition.actor;
      insertStmt.run(
        id, transition.ticketId, transition.fromState, transition.toState,
        actor.type,
        actor.type === 'agent' ? actor.agentId || null : actor.type === 'human' ? actor.userId || null : null,
        actor.type === 'agent' ? actor.sessionId || null : null,
        transition.comment || null,
        transition.data ? JSON.stringify(transition.data) : null,
        now,
      );
      return { id, ...transition, createdAt: now };
    },
  };
}

// ---------------------------------------------------------------------------
// Row types and mappers
// ---------------------------------------------------------------------------

interface TicketRow {
  id: string; type: string; title: string; description: string;
  state: string; state_data: string | null; parent_id: string | null;
  track_id: string | null; external_ticket_id: string | null;
  execution_session_id: string | null;
  assigned_agent_role: string | null; assigned_agent_ids: string | null;
  provider: string; priority: string; labels: string | null;
  sort_order: number; workflow_template_row_id: string | null;
  state_changed_at: string; created_at: string; updated_at: string;
}

interface TransitionRow {
  id: string; ticket_id: string; from_state: string; to_state: string;
  actor_type: string; actor_id: string | null; session_id: string | null;
  comment: string | null; data: string | null; created_at: string;
}

function safeJsonParse<T>(val: string | null): T | undefined {
  if (!val) return undefined;
  try { return JSON.parse(val) as T; } catch { return undefined; }
}

function rowToTicket(row: TicketRow): WorkflowTicket {
  return {
    id: row.id as WorkflowTicketId,
    type: row.type as WorkflowTicketType,
    title: row.title,
    description: row.description,
    state: row.state as WorkflowState,
    stateData: safeJsonParse<Record<string, unknown>>(row.state_data),
    parentId: (row.parent_id as WorkflowTicketId) || undefined,
    trackId: (row.track_id as TrackId) || undefined,
    externalTicketId: (row.external_ticket_id as TicketId) || undefined,
    executionSessionId: (row.execution_session_id as SessionId) || undefined,
    assignedAgentRole: row.assigned_agent_role || undefined,
    assignedAgentIds: safeJsonParse<AgentId[]>(row.assigned_agent_ids),
    provider: (row.provider as SessionProvider) || 'claude',
    priority: row.priority as WorkflowTicket['priority'],
    labels: safeJsonParse<string[]>(row.labels),
    sortOrder: row.sort_order,
    workflowTemplateRowId: row.workflow_template_row_id || undefined,
    stateChangedAt: row.state_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTransition(row: TransitionRow): WorkflowTransition {
  let actor: TransitionActor;
  if (row.actor_type === 'agent') {
    actor = { type: 'agent', agentId: row.actor_id || undefined, sessionId: row.session_id || undefined };
  } else if (row.actor_type === 'human') {
    actor = { type: 'human', userId: row.actor_id || undefined };
  } else {
    actor = { type: 'system', reason: row.actor_id || 'unknown' };
  }
  return {
    id: row.id as WorkflowTransitionId,
    ticketId: row.ticket_id as WorkflowTicketId,
    fromState: row.from_state as WorkflowState,
    toState: row.to_state as WorkflowState,
    actor,
    comment: row.comment || undefined,
    data: safeJsonParse<Record<string, unknown>>(row.data),
    createdAt: row.created_at,
  };
}
