import { useParams, useNavigate } from 'react-router-dom';
import { PromptTemplates } from './PromptTemplates';
import { McpServers } from './McpServers';
import { SoulEditor } from './SoulEditor';
import { ThemeSelector } from './ThemeSelector';
import { Repositories } from './Repositories';
import { AgentsSettings } from './AgentsSettings';
import { SkillsSettings } from './SkillsSettings';
import { IssueTracking } from './IssueTracking';
import { DefaultAiCliSettings } from './DefaultAiCliSettings';

type Tab = 'general' | 'repositories' | 'mcp' | 'templates' | 'agents' | 'skills' | 'issue-tracking';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
  { id: 'templates', label: 'Templates' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'issue-tracking', label: 'Issue Tracking' },
];

const VALID_TABS = new Set<string>(TABS.map((t) => t.id));

export function Settings() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const activeTab: Tab = VALID_TABS.has(tab ?? '') ? (tab as Tab) : 'general';

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <div className="flex items-center gap-0.5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => navigate(`/settings/${id}`)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                activeTab === id
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'general' && (
        <div className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <ThemeSelector />
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <DefaultAiCliSettings />
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <SoulEditor />
          </section>
        </div>
      )}

      {activeTab === 'repositories' && (
        <div className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <Repositories />
          </section>
        </div>
      )}

      {activeTab === 'mcp' && (
        <div className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <McpServers />
          </section>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <PromptTemplates />
          </section>
        </div>
      )}

      {activeTab === 'agents' && <AgentsSettings />}

      {activeTab === 'skills' && <SkillsSettings />}

      {activeTab === 'issue-tracking' && (
        <div className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <IssueTracking />
          </section>
        </div>
      )}
    </div>
  );
}
