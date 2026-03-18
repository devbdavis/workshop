import type { Agent, SessionProvider } from '@foundation/types';

export function resolveProvider(agent: Agent): SessionProvider {
  // Explicit provider field takes precedence (from agent frontmatter or DB)
  if ((agent as any).provider) return (agent as any).provider;

  const model = (agent.model || '').toLowerCase();
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('codex') || model === 'o1' || model === 'o3' || model === 'o4-mini') return 'codex';
  return 'claude';
}
