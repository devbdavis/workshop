import { Router } from 'express';
import type { WorkflowTicketId, WorkflowState, WorkflowTicketType, TrackId } from '@foundation/types';
import type {
  WorkflowTicketRepository,
  WorkflowTransitionRepository,
  TicketDependencyRepository,
} from '@domain/workflow/repository';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { ExecutionDispatcher } from '@application/workflow/execution-dispatcher.js';
import { broadcast } from './events.js';

export interface WorkflowRouterDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: TicketDependencyRepository;
  /** If provided, plan-review approval auto-dispatches execution */
  executionDispatcher?: ExecutionDispatcher;
}

export function createWorkflowRouter(deps: WorkflowRouterDeps): Router {
  const router = Router();
  const { engine, tickets, transitions, dependencies, executionDispatcher } = deps;

  // --- List all workflow tickets ---

  router.get('/workflow/tickets', (req, res) => {
    const { type, state, trackId, parentId } = req.query;
    const filters: {
      type?: WorkflowTicketType;
      state?: WorkflowState;
      trackId?: TrackId;
      parentId?: WorkflowTicketId;
    } = {};

    if (type) filters.type = type as WorkflowTicketType;
    if (state) filters.state = state as WorkflowState;
    if (trackId) filters.trackId = trackId as TrackId;
    if (parentId) filters.parentId = parentId as WorkflowTicketId;

    res.json(tickets.findAll(filters));
  });

  // --- Get single workflow ticket ---

  router.get('/workflow/tickets/:id', (req, res) => {
    const ticket = tickets.findById(req.params.id as WorkflowTicketId);
    if (!ticket) {
      res.status(404).json({ error: 'Workflow ticket not found' });
      return;
    }

    // Populate childIds
    const children = tickets.findChildren(ticket.id);
    ticket.childIds = children.map((c) => c.id);

    res.json(ticket);
  });

  // --- Create workflow ticket (epic or task) ---

  router.post('/workflow/tickets', (req, res) => {
    const { type, title, description, trackId, parentId, provider, priority, dependsOn } = req.body;

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!type || (type !== 'epic' && type !== 'task')) {
      res.status(400).json({ error: "type must be 'epic' or 'task'" });
      return;
    }

    try {
      let ticket;
      if (type === 'epic') {
        ticket = engine.createEpic({
          title,
          description: description || '',
          trackId: trackId as TrackId | undefined,
          provider,
          priority,
        });
      } else {
        if (!parentId) {
          res.status(400).json({ error: 'parentId is required for tasks' });
          return;
        }
        ticket = engine.createTask({
          title,
          description: description || '',
          parentId: parentId as WorkflowTicketId,
          provider,
          priority,
          dependsOn: dependsOn as WorkflowTicketId[] | undefined,
        });
      }

      broadcast('workflow:created', ticket.id);
      res.status(201).json(ticket);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ticket';
      res.status(400).json({ error: message });
    }
  });

  // --- Update workflow ticket ---

  router.put('/workflow/tickets/:id', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const existing = tickets.findById(ticketId);
    if (!existing) {
      res.status(404).json({ error: 'Workflow ticket not found' });
      return;
    }

    const { title, description, trackId, priority, labels, sortOrder, stateData,
      assignedAgentRole, assignedAgentIds, provider } = req.body;

    const updated = tickets.update(ticketId, {
      title,
      description,
      trackId: trackId !== undefined ? (trackId || undefined) as TrackId : undefined,
      priority,
      labels,
      sortOrder,
      stateData,
      assignedAgentRole,
      assignedAgentIds,
      provider,
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to update ticket' });
      return;
    }

    broadcast('workflow:updated', ticketId);
    res.json(updated);
  });

  // --- Delete workflow ticket ---

  router.delete('/workflow/tickets/:id', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const deleted = tickets.delete(ticketId);
    if (!deleted) {
      res.status(404).json({ error: 'Workflow ticket not found' });
      return;
    }
    broadcast('workflow:deleted', ticketId);
    res.status(204).send();
  });

  // --- Transition ticket to new state ---

  router.post('/workflow/tickets/:id/transition', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const { toState, comment, actor, data } = req.body;

    if (!toState || typeof toState !== 'string') {
      res.status(400).json({ error: 'toState is required' });
      return;
    }

    try {
      const transitionActor = actor || { type: 'human' as const };
      const updated = engine.transition(
        ticketId,
        toState as WorkflowState,
        transitionActor,
        comment,
        data,
      );

      // If a task just reached 'done', trigger dependency resolution
      if (toState === 'done') {
        engine.onTaskCompleted(ticketId);
      }

      broadcast('workflow:transitioned', ticketId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transition failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Approve at human gate ---

  router.post('/workflow/tickets/:id/approve', async (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const { comment } = req.body || {};

    try {
      let updated;
      if (executionDispatcher) {
        updated = await executionDispatcher.approveWithExecution(ticketId, comment);
      } else {
        updated = engine.approve(ticketId, comment);
      }
      broadcast('workflow:approved', ticketId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approval failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Reject at human gate ---

  router.post('/workflow/tickets/:id/reject', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const { comment } = req.body || {};

    try {
      const updated = engine.reject(ticketId, comment);
      broadcast('workflow:rejected', ticketId);
      res.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rejection failed';
      res.status(400).json({ error: message });
    }
  });

  // --- Get transition history ---

  router.get('/workflow/tickets/:id/transitions', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const history = transitions.findByTicket(ticketId, limit);
    res.json(history);
  });

  // --- Get dependencies ---

  router.get('/workflow/tickets/:id/dependencies', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const deps = dependencies.findByTicket(ticketId);
    res.json(deps);
  });

  // --- Add dependency ---

  router.post('/workflow/tickets/:id/dependencies', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const { dependsOnId } = req.body;

    if (!dependsOnId || typeof dependsOnId !== 'string') {
      res.status(400).json({ error: 'dependsOnId is required' });
      return;
    }

    // Verify both tickets exist
    const ticket = tickets.findById(ticketId);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    const depTicket = tickets.findById(dependsOnId as WorkflowTicketId);
    if (!depTicket) {
      res.status(404).json({ error: 'Dependency ticket not found' });
      return;
    }

    const dep = dependencies.create(ticketId, dependsOnId as WorkflowTicketId);
    broadcast('workflow:updated', ticketId);
    res.status(201).json(dep);
  });

  // --- Remove dependency ---

  router.delete('/workflow/tickets/:id/dependencies/:depId', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const dependsOnId = req.params.depId as WorkflowTicketId;

    const deleted = dependencies.delete(ticketId, dependsOnId);
    if (!deleted) {
      res.status(404).json({ error: 'Dependency not found' });
      return;
    }
    broadcast('workflow:updated', ticketId);
    res.status(204).send();
  });

  return router;
}
