import { PromptTemplates } from './PromptTemplates';
import { McpServers } from './McpServers';
import { SoulEditor } from './SoulEditor';
import { ThemeSelector } from './ThemeSelector';
import { Repositories } from './Repositories';

export function Settings() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

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
    </div>
  );
}
