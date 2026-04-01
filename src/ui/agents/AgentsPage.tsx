import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@foundation/types';
import { AgentCard } from './AgentCard';
import { AgentFormModal, type AgentFormData } from './AgentFormModal';
import { ImproveAgentModal } from './ImproveAgentModal';

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [creating, setCreating] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [improvingAgent, setImprovingAgent] = useState<Agent | null>(null);

  async function loadAgents() {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) setAgents(await res.json());
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  }

  // Auto-migrate any legacy workshop DB agents to global filesystem on first load
  useEffect(() => {
    loadAgents().then(async () => {
      try {
        const res = await fetch('/api/agents/migrate-workshop', { method: 'POST' });
        if (res.ok) {
          const { migrated } = await res.json();
          if (migrated > 0) loadAgents();
        }
      } catch { /* non-fatal */ }
    });
  }, []);

  async function handleCreate(data: AgentFormData) {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) { setCreating(false); loadAgents(); }
    } catch (err) { console.error('Failed to create agent:', err); }
  }

  async function handleUpdate(id: string, data: AgentFormData) {
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) { setEditingAgent(null); loadAgents(); }
    } catch (err) { console.error('Failed to update agent:', err); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return;
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (res.ok) loadAgents();
    } catch (err) { console.error('Failed to delete agent:', err); }
  }

  async function handleApplyImprovement(id: string, data: { name?: string; description?: string; systemPrompt: string; allowedTools?: string[] }) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    await handleUpdate(id, {
      name: data.name ?? agent.name,
      description: data.description ?? agent.description,
      model: agent.model,
      color: agent.color,
      systemPrompt: data.systemPrompt,
      allowedTools: data.allowedTools ?? agent.allowedTools,
      maxTurns: agent.maxTurns,
    });
    setImprovingAgent(null);
  }

  const myAgents = agents
    .filter((a) => a.source === 'global' || a.source === 'workshop')
    .sort((a, b) => a.name.localeCompare(b.name));

  const projectAgents = agents.filter((a) => a.source === 'project');

  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-sm text-gray-500">Loading agents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-gray-400 hover:text-gray-200 text-sm">&larr; Dashboard</Link>
            <h1 className="text-2xl font-bold">Agents</h1>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Agent
          </button>
        </header>

        <div className="space-y-8">
          {/* My Agents — global (and legacy workshop) — editable */}
          {myAgents.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">
                  My Agents
                  <span className="ml-2 text-sm font-normal text-gray-500">({myAgents.length})</span>
                </h2>
                <p className="text-sm text-gray-400">Saved to ~/.claude/agents/ — available in all Claude sessions</p>
              </div>
              <div className="space-y-3">
                {myAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onEdit={() => setEditingAgent(agent)}
                    onDelete={() => handleDelete(agent.id)}
                    onImprove={() => setImprovingAgent(agent)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Project Agents — read-only */}
          <ProjectAgentSection agents={projectAgents} />
        </div>
      </div>

      {/* Create modal */}
      {creating && (
        <AgentFormModal onSave={handleCreate} onClose={() => setCreating(false)} />
      )}

      {/* Edit modal */}
      {editingAgent && (
        <AgentFormModal
          initial={editingAgent}
          onSave={(data) => handleUpdate(editingAgent.id, data)}
          onClose={() => setEditingAgent(null)}
        />
      )}

      {/* Improve modal */}
      {improvingAgent && (
        <ImproveAgentModal
          agent={improvingAgent}
          onApply={(data) => handleApplyImprovement(improvingAgent.id, data)}
          onClose={() => setImprovingAgent(null)}
        />
      )}
    </div>
  );
}

function ProjectAgentSection({ agents }: { agents: Agent[] }) {
  const [collapsed, setCollapsed] = useState(true);
  if (agents.length === 0) return null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-left group"
      >
        <div>
          <h2 className="text-lg font-semibold group-hover:text-blue-300 transition-colors">
            Project Agents
            <span className="ml-2 text-sm font-normal text-gray-500">({agents.length})</span>
          </h2>
          <p className="text-sm text-gray-400">From .claude/agents/ — scoped to this project</p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-3 mt-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={() => {}}
              onDelete={() => {}}
              onImprove={() => {}}
            />
          ))}
        </div>
      )}
    </section>
  );
}
