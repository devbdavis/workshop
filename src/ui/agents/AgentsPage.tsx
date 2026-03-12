import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, AgentSource } from '@foundation/types';
import { AgentCard } from './AgentCard';
import { AgentForm } from './AgentForm';

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadAgents();
  }, []);

  async function handleCreate(data: AgentFormData) {
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setCreating(false);
        loadAgents();
      }
    } catch (err) {
      console.error('Failed to create agent:', err);
    }
  }

  async function handleUpdate(id: string, data: AgentFormData) {
    try {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditingId(null);
        loadAgents();
      }
    } catch (err) {
      console.error('Failed to update agent:', err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return;
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (editingId === id) setEditingId(null);
        loadAgents();
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  }

  // Group agents by source
  const bySource = agents.reduce(
    (acc, agent) => {
      acc[agent.source].push(agent);
      return acc;
    },
    { global: [], project: [], workshop: [] } as Record<AgentSource, Agent[]>,
  );

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
          <Link to="/" className="text-gray-400 hover:text-gray-200 text-sm">
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Agents</h1>
        </div>
        {!creating && (
          <button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Agent
          </button>
        )}
      </header>

      <div className="space-y-8">
        {creating && (
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Create Agent</h2>
            <AgentForm onSave={handleCreate} onCancel={() => setCreating(false)} />
          </section>
        )}

        <AgentSection
          title="Global Agents"
          subtitle="From ~/.claude/agents/"
          agents={bySource.global}
          editingId={editingId}
          onEdit={setEditingId}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />

        <AgentSection
          title="Project Agents"
          subtitle="From .claude/agents/"
          agents={bySource.project}
          editingId={editingId}
          onEdit={setEditingId}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />

        <AgentSection
          title="Workshop Agents"
          subtitle="Created in Workshop"
          agents={bySource.workshop}
          editingId={editingId}
          onEdit={setEditingId}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      </div>
      </div>
    </div>
  );
}

interface AgentFormData {
  name: string;
  description: string;
  model?: string;
  color?: string;
  systemPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
}

interface AgentSectionProps {
  title: string;
  subtitle: string;
  agents: Agent[];
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onUpdate: (id: string, data: AgentFormData) => void;
  onDelete: (id: string) => void;
}

function AgentSection({ title, subtitle, agents, editingId, onEdit, onUpdate, onDelete }: AgentSectionProps) {
  if (agents.length === 0) return null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-gray-400">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {agents.map((agent) =>
          editingId === agent.id ? (
            <AgentForm
              key={agent.id}
              initial={agent}
              onSave={(data) => onUpdate(agent.id, data)}
              onCancel={() => onEdit(null)}
            />
          ) : (
            <AgentCard
              key={agent.id}
              agent={agent}
              onEdit={() => onEdit(agent.id)}
              onDelete={() => onDelete(agent.id)}
            />
          ),
        )}
      </div>
    </section>
  );
}
