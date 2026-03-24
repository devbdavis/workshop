/**
 * Domain interface for agent scanning.
 *
 * Infrastructure provides the concrete implementation (filesystem-based).
 */
import type { Agent, AgentId } from '@foundation/types';

export interface AgentScanner {
  scanGlobalAgents(): Agent[];
  scanProjectAgents(projectRoot: string): Agent[];
  scanAll(projectRoot?: string): Agent[];
  findById(id: AgentId, projectRoot?: string): Agent | null;
}
