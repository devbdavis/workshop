import { useState, useEffect, useRef } from 'react';
import type { Agent } from '@foundation/types';

export interface AgentFormData {
  name: string;
  description: string;
  model?: string;
  color?: string;
  systemPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
}

interface Props {
  initial?: Agent;
  onSave: (data: AgentFormData) => void;
  onClose: () => void;
  onSaveAsTemplate?: () => void;
}

export function AgentFormModal({ initial, onSave, onClose, onSaveAsTemplate }: Props) {
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
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        const body = await res.json().catch(() => null);
        setGenerateError(body?.error || `Generation failed (HTTP ${res.status}). Check server logs.`);
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
    } catch {
      setGenerateError('Generation failed — check server logs.');
    } finally {
      setGenerating(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !systemPrompt.trim()) return;
    const toolsList = allowedTools.split(',').map((t) => t.trim()).filter(Boolean);
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
  const inputCls = 'block w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500';

  // Template button state
  const hasTemplate = !!initial?.templateName;
  const templateInSync = hasTemplate && !initial?.isOutOfSync;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[85vw] h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-lg font-semibold">{initial ? 'Edit Agent' : 'New Agent'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {/* Form body — flex column so system prompt grows to fill space */}
        <form ref={formRef} id="agent-form" onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 p-5 gap-4 overflow-y-auto">
          {/* Generate with Claude — new agents only */}
          {!initial && (
            <div className="border border-gray-700 bg-gray-800/60 rounded-lg p-3 space-y-2 shrink-0">
              <p className="text-xs font-medium text-blue-400">Generate with Claude</p>
              <p className="text-[11px] text-gray-400">Describe what you want the agent to do and Claude will draft the full definition.</p>
              <textarea
                value={generateInput}
                onChange={(e) => setGenerateInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder="e.g. A senior code reviewer focused on security vulnerabilities and performance. Strict TypeScript standards, always provides line-number references and concrete fix suggestions."
                rows={4}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">⌘↵ to generate</span>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!generateInput.trim() || generating}
                  className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded transition-colors"
                >
                  {generating ? 'Generating…' : 'Generate'}
                </button>
              </div>
              {generateError && <p className="text-xs text-red-400">{generateError}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Model</label>
              <input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} placeholder="e.g. claude-opus-4-6" />
            </div>
          </div>

          <div className="shrink-0">
            <label className="block text-xs text-gray-400 mb-1">Description *</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} required />
          </div>

          <div className="grid grid-cols-2 gap-3 shrink-0">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Color</label>
              <input value={color} onChange={(e) => setColor(e.target.value)} className={inputCls} placeholder="e.g. blue, #3b82f6" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Turns</label>
              <input type="number" value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)} className={inputCls} placeholder="Optional" min="1" />
            </div>
          </div>

          <div className="shrink-0">
            <label className="block text-xs text-gray-400 mb-1">Allowed Tools</label>
            <input value={allowedTools} onChange={(e) => setAllowedTools(e.target.value)} className={inputCls} placeholder="Comma-separated, e.g. Read, Edit, Bash" />
          </div>

          {/* System Prompt — grows to fill remaining modal height */}
          <div className="flex flex-col flex-1 min-h-0">
            <label className="block text-xs text-gray-400 mb-1 shrink-0">System Prompt *</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="flex-1 min-h-[200px] block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 resize-y"
              required
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
          {initial && onSaveAsTemplate && (
            <button
              type="button"
              onClick={templateInSync ? undefined : onSaveAsTemplate}
              disabled={templateInSync}
              title={templateInSync ? 'Already in sync with template' : undefined}
              className={`mr-auto px-3 py-2 text-sm transition-colors ${
                templateInSync ? 'text-gray-600 cursor-default' : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              {hasTemplate ? 'Update Template' : 'Save as Template'}
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            form="agent-form"
            disabled={!isValid}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            {initial ? 'Save Changes' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
