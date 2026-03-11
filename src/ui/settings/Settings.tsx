import { Link } from 'react-router-dom';
import { PromptTemplates } from './PromptTemplates';

export function Settings() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-center gap-4 mb-8">
        <Link to="/" className="text-gray-400 hover:text-gray-200 text-sm">
          &larr; Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </header>

      <div className="space-y-6">
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <PromptTemplates />
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Integrations</h2>
          <p className="text-sm text-gray-400">
            Configure MCP connections for Jira, Linear, and other tools.
          </p>
          <p className="text-sm text-gray-500 mt-2 italic">Coming soon.</p>
        </section>
      </div>
    </div>
  );
}
