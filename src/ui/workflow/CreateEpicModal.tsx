import { useEffect, useState } from 'react';
import type { Track } from '@foundation/types.js';

type CreateMode = 'standard' | 'from-plan' | 'from-template';

interface IntakeQuestion {
  id: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface WorkflowTemplate {
  slug: string;
  name: string;
  description: string;
  intakeQuestions: IntakeQuestion[];
}

export interface CreateEpicData {
  title: string;
  description: string;
  trackId?: string;
  priority: string;
  provider: string;
  /** If set, creates epic at plan-review with this as the pre-written plan */
  planDraft?: string;
  /** If set, creates epic from a workflow template with intake answers */
  templateSlug?: string;
  intakeAnswers?: Record<string, string>;
  autonomous?: boolean;
  budget?: { maxSteps: number; maxWallClockMs: number };
}

interface Props {
  tracks: Track[];
  onSave: (data: CreateEpicData) => void;
  onClose: () => void;
}

export function CreateEpicModal({ tracks, onSave, onClose }: Props) {
  const [mode, setMode] = useState<CreateMode>('standard');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [trackId, setTrackId] = useState('');
  const [priority, setPriority] = useState('medium');
  const [provider, setProvider] = useState('claude');

  // From-template state
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [autonomous, setAutonomous] = useState(true);
  const [maxSteps, setMaxSteps] = useState(40);
  const [maxHours, setMaxHours] = useState(4);

  useEffect(() => {
    if (mode !== 'from-template' || templates.length > 0) return;
    setTemplatesLoading(true);
    fetch('/api/workflow/templates')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: WorkflowTemplate[]) => setTemplates(data))
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false));
  }, [mode, templates.length]);

  const selectedTemplate = templates.find((t) => t.slug === selectedSlug);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'from-template') {
      if (!selectedTemplate) return;
      const missingRequired = selectedTemplate.intakeQuestions.some(
        (q) => q.required && !(intakeAnswers[q.id] ?? '').trim(),
      );
      if (missingRequired) return;

      const derivedTitle = title.trim() || Object.values(intakeAnswers)[0]?.trim().slice(0, 80) || selectedTemplate.name;
      const derivedDescription = selectedTemplate.intakeQuestions
        .map((q) => `### ${q.label}\n${(intakeAnswers[q.id] ?? '').trim() || '_(no answer)_'}`)
        .join('\n\n');

      onSave({
        title: derivedTitle,
        description: derivedDescription,
        trackId: trackId || undefined,
        priority,
        provider,
        templateSlug: selectedTemplate.slug,
        intakeAnswers,
        autonomous,
        budget: { maxSteps, maxWallClockMs: maxHours * 60 * 60 * 1000 },
      });
      return;
    }

    if (!title.trim()) return;
    if (mode === 'standard' && !description.trim()) return;
    if (mode === 'from-plan' && !planDraft.trim()) return;

    onSave({
      title: title.trim(),
      description: description.trim(),
      trackId: trackId || undefined,
      priority,
      provider,
      planDraft: mode === 'from-plan' ? planDraft.trim() : undefined,
    });
  }

  const isFromPlan = mode === 'from-plan';
  const isFromTemplate = mode === 'from-template';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col"
      >
        <h2 className="text-sm font-semibold text-gray-200 mb-3">New Epic</h2>

        {/* Mode toggle */}
        <div className="flex gap-1 mb-4 p-0.5 bg-gray-800 rounded w-fit">
          <button
            type="button"
            onClick={() => setMode('standard')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              mode === 'standard'
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Standard
          </button>
          <button
            type="button"
            onClick={() => setMode('from-plan')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              isFromPlan
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            From Plan
          </button>
          <button
            type="button"
            onClick={() => setMode('from-template')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              isFromTemplate
                ? 'bg-gray-700 text-gray-200'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            From Template
          </button>
        </div>

        {isFromPlan && (
          <p className="text-[11px] text-amber-400/80 mb-3">
            Skips triage, spec, and planning phases. Epic starts at plan-review for your approval.
          </p>
        )}

        <div className="flex-1 overflow-y-auto space-y-3">
          {isFromTemplate ? (
            <>
              {templatesLoading && (
                <p className="text-xs text-gray-500">Loading templates…</p>
              )}
              {!templatesLoading && templates.length === 0 && (
                <p className="text-xs text-gray-500">No templates available.</p>
              )}
              {!templatesLoading && templates.length > 0 && !selectedTemplate && (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <button
                      type="button"
                      key={t.slug}
                      onClick={() => { setSelectedSlug(t.slug); setIntakeAnswers({}); }}
                      className="w-full text-left px-3 py-2 bg-gray-800 border border-gray-700 rounded hover:border-gray-600 transition-colors"
                    >
                      <p className="text-sm text-gray-200 font-medium">{t.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                    </button>
                  ))}
                </div>
              )}

              {selectedTemplate && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      Template: <span className="text-gray-200">{selectedTemplate.name}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug('')}
                      className="text-[11px] text-gray-500 hover:text-gray-300"
                    >
                      Change
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Title (optional)</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Defaults to first answer"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                    />
                  </div>

                  {selectedTemplate.intakeQuestions.map((q) => (
                    <div key={q.id}>
                      <label className="block text-xs text-gray-400 mb-1">
                        {q.label} {q.required && '*'}
                      </label>
                      <textarea
                        value={intakeAnswers[q.id] ?? ''}
                        onChange={(e) => setIntakeAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={q.placeholder}
                        required={q.required}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                        rows={2}
                      />
                    </div>
                  ))}

                  <div className="border-t border-gray-800 pt-3 space-y-2">
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={autonomous}
                        onChange={(e) => setAutonomous(e.target.checked)}
                        className="rounded border-gray-700 bg-gray-800"
                      />
                      🏭 Run dark (autonomous)
                    </label>
                    <p className="text-[11px] text-gray-500">
                      Auto-approves every gate except the final PR/merge, which always waits for you.
                    </p>
                    {autonomous && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Max steps</label>
                          <input
                            type="number"
                            min={1}
                            value={maxSteps}
                            onChange={(e) => setMaxSteps(Number(e.target.value) || 1)}
                            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Max hours</label>
                          <input
                            type="number"
                            min={1}
                            value={maxHours}
                            onChange={(e) => setMaxHours(Number(e.target.value) || 1)}
                            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Description {!isFromPlan && '*'}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                  rows={isFromPlan ? 2 : 4}
                  required={!isFromPlan}
                  placeholder={isFromPlan ? 'Optional summary of what the epic covers' : undefined}
                />
              </div>

              {isFromPlan && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Implementation Plan *</label>
                  <textarea
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 font-mono"
                    rows={8}
                    required
                    placeholder="Paste your implementation plan here..."
                  />
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Track</label>
              <select
                value={trackId}
                onChange={(e) => setTrackId(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="">None</option>
                {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isFromTemplate && !selectedTemplate}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isFromPlan ? 'Create at Plan Review' : isFromTemplate ? 'Create Epic' : 'Create Epic'}
          </button>
        </div>
      </form>
    </div>
  );
}
