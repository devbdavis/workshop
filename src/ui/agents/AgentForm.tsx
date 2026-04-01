import { useState } from 'react';

interface AgentFormData {
  name: string;
  description: string;
  model?: string;
  color?: string;
  systemPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
}

interface Props {
  initial?: {
    name: string;
    description: string;
    model?: string;
    color?: string;
    systemPrompt: string;
    allowedTools?: string[];
    maxTurns?: number;
  };
  onSave: (data: AgentFormData) => void;
  onCancel: () => void;
}

export function AgentForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '');
  const [allowedTools, setAllowedTools] = useState(initial?.allowedTools?.join(', ') ?? '');
  const [maxTurns, setMaxTurns] = useState(initial?.maxTurns?.toString() ?? '');

  const [generateInput, setGenerateInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  async function handleGenerate() {
    if (!generateInput.trim()) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch('/api/agents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: generateInput }),
      });
      if (!res.ok) {
        setGenerateError('Generation failed. Check that ANTHROPIC_API_KEY is set.');
        return;
      }
      const data = await res.json();
      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.systemPrompt) setSystemPrompt(data.systemPrompt);
      if (data.model) setModel(data.model);
      if (data.color) setColor(data.color);
      if (data.allowedTools) {
        setAllowedTools(Array.isArray(data.allowedTools) ? data.allowedTools.join(', ') : data.allowedTools);
      }
    } catch (err) {
      setGenerateError('Generation failed. Check server logs.');
    } finally {
      setGenerating(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !systemPrompt.trim()) return;

    const toolsList = allowedTools
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    onSave({
      name: name.trim(),
      description: description.trim(),
      model: model.trim() || undefined,
      color: color.trim() || undefined,
      systemPrompt: systemPrompt.trim(),
      allowedTools: toolsList.length > 0 ? toolsList : undefined,
      maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
    });
  }

  const isValid = name.trim() && description.trim() && systemPrompt.trim();

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
      {/* Generate with Claude — only shown for new agents */}
      {!initial && (
        <div className="border border-purple-800/50 bg-purple-950/30 rounded-lg p-3 space-y-2">
          <label className="block text-xs font-medium text-purple-300">Generate with Claude</label>
          <p className="text-[11px] text-gray-400">Describe what you want this agent to do and Claude will draft the full definition.</p>
          <div className="flex gap-2">
            <input
              value={generateInput}
              onChange={(e) => setGenerateInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleGenerate(); } }}
              placeholder="e.g. A senior code reviewer focused on security and performance"
              className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!generateInput.trim() || generating}
              className="px-3 py-1.5 text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {generateError && <p className="text-xs text-red-400">{generateError}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            autoFocus={!!initial}
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="e.g. claude-opus-4-6"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Description *</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Color</label>
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="e.g. blue, #3b82f6"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Max Turns</label>
          <input
            type="number"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            placeholder="Optional"
            min="1"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Allowed Tools</label>
        <input
          value={allowedTools}
          onChange={(e) => setAllowedTools(e.target.value)}
          className="block w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          placeholder="Comma-separated, e.g. Read, Edit, Bash"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">System Prompt *</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={12}
          className="block w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
          required
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
        >
          {initial ? 'Save Changes' : 'Create Agent'}
        </button>
      </div>
    </form>
  );
}
