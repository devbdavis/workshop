import { useState } from 'react';
import { PromptTemplates } from './PromptTemplates';
import { McpServers } from './McpServers';
import { SoulEditor } from './SoulEditor';
import { ThemeSelector } from './ThemeSelector';
import { Repositories } from './Repositories';
import { AgentsSettings } from './AgentsSettings';
import { SkillsSettings } from './SkillsSettings';

type Tab = 'general' | 'agents' | 'skills';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'skills', label: 'Skills' },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <div className="flex items-center gap-0.5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
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
            <SoulEditor />
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <Repositories />
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <McpServers />
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <PromptTemplates />
          </section>
        </div>
      )}

      {activeTab === 'agents' && <AgentsSettings />}

      {activeTab === 'skills' && <SkillsSettings />}
    </div>
  );
}
