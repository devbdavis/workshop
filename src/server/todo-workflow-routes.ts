import { Router } from 'express';
import type { broadcast } from './events.js';
import type { TodoId } from '@foundation/types.js';
import type { TodoRepository } from '@domain/todo/repository';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { DispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import { DEFAULT_AUTONOMOUS_BUDGET } from '@application/workflow/autonomy.js';

export interface TodoWorkflowRouterDeps {
  todos: TodoRepository;
  playbooks: PlaybookRepository;
  engine: WorkflowEngine;
  issues: WorkflowIssueRepository;
  coordinator: DispatchCoordinator;
  broadcast: typeof broadcast;
}

export function createTodoWorkflowRouter(deps: TodoWorkflowRouterDeps): Router {
  const router = Router();
  const { todos, playbooks, engine, issues, coordinator, broadcast } = deps;

  router.post('/todos/:todoId/dispatch-workflow', async (req, res) => {
    const { playbookRowId, autonomous } = req.body;
    if (typeof playbookRowId !== 'string' || playbookRowId === '') {
      res.status(400).json({ error: 'playbookRowId is required' });
      return;
    }
    const todo = todos.findById(req.params.todoId as TodoId);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }
    if (!playbooks.findByRowId(playbookRowId)) {
      res.status(404).json({ error: 'Playbook not found' });
      return;
    }

    try {
      let epic = engine.createEpic({
        title: todo.title,
        description: todo.description ?? '',
        trackId: todo.trackId,
        playbookRowId,
      });
      // todoId lets the coordinator's onTerminal hook find the originating todo.
      const stateData: Record<string, unknown> = { ...(epic.stateData || {}), todoId: todo.id };
      if (autonomous === true) {
        stateData.autonomous = true;
        stateData.autonomousBudget = DEFAULT_AUTONOMOUS_BUDGET;
      }
      epic = issues.update(epic.id, { stateData }) ?? epic;
      await coordinator.dispatchForCurrentState(epic.id);
      todos.update(todo.id, { status: 'in-progress' });

      broadcast('workflow:created', epic.id);
      broadcast('todo:updated', todo.trackId);
      res.status(201).json(issues.findById(epic.id) ?? epic);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to dispatch workflow' });
    }
  });

  return router;
}
