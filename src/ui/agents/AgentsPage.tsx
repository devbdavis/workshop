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
          defaultCollapsed
        />

        <AgentSection
          title="Project Agents"
          subtitle="From .claude/agents/"
          agents={bySource.project}
          editingId={editingId}
          onEdit={setEditingId}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          defaultCollapsed
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
  defaultCollapsed?: boolean;
}

function AgentSection({ title, subtitle, agents, editingId, onEdit, onUpdate, onDelete, defaultCollapsed = false }: AgentSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (agents.length === 0) return null;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between text-left group"
      >
        <div>
          <h2 className="text-lg font-semibold group-hover:text-blue-300 transition-colors">
            {title}
            <span className="ml-2 text-sm font-normal text-gray-500">({agents.length})</span>
          </h2>
          <p className="text-sm text-gray-400">{subtitle}</p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-180'}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-3 mt-4">
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
      )}
    </section>
  );
}
