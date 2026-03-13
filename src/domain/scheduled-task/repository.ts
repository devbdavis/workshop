import type {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskRun,
  TrackId,
} from '@foundation/types';

export interface ScheduledTaskRepository {
  findById(id: ScheduledTaskId): ScheduledTask | null;
  findAll(): ScheduledTask[];
  findEnabled(): ScheduledTask[];
  findByTrack(trackId: TrackId): ScheduledTask[];
  create(
    task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'lastRunAt' | 'lastRunStatus' | 'lastSessionId'>,
  ): ScheduledTask;
  update(
    id: ScheduledTaskId,
    data: Partial<
      Pick<
        ScheduledTask,
        | 'name'
        | 'description'
        | 'scheduleConfig'
        | 'cronExpression'
        | 'scheduleDescription'
        | 'trackId'
        | 'agentId'
        | 'provider'
        | 'taskPrompt'
        | 'systemPromptOverride'
        | 'enabled'
        | 'lastRunAt'
        | 'lastRunStatus'
        | 'lastSessionId'
        | 'runCount'
      >
    >,
  ): ScheduledTask | null;
  delete(id: ScheduledTaskId): boolean;
}

export interface ScheduledTaskRunRepository {
  findByTask(taskId: ScheduledTaskId, limit?: number): ScheduledTaskRun[];
  create(run: Omit<ScheduledTaskRun, 'id'>): ScheduledTaskRun;
  complete(id: string, status: 'completed' | 'failed', error?: string): ScheduledTaskRun | null;
}
