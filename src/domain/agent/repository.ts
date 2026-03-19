import type { Agent, AgentId, SessionProvider } from '@foundation/types';

export interface AgentRepository {
  findAll(): Agent[];
  findById(id: AgentId): Agent | null;
  create(data: {
    name: string;
    description: string;
    model?: string;
    provider?: SessionProvider;
    color?: string;
    systemPrompt: string;
    allowedTools?: string[];
    maxTurns?: number;
  }): Agent;
  update(
    id: AgentId,
    data: Partial<Pick<Agent, 'name' | 'description' | 'model' | 'provider' | 'color' | 'systemPrompt' | 'allowedTools' | 'maxTurns'>>,
  ): Agent | null;
  delete(id: AgentId): boolean;
}
