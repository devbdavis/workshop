import { useState, useEffect } from 'react';
import type { ScheduledTask, Track, Agent, ScheduleConfig, SchedulePreset } from '@foundation/types';

interface Props {
  task: ScheduledTask | null;
  tracks: Track[];
  agents: Agent[];
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

const PRESETS: { value: SchedulePreset; label: string }[] = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'cron', label: 'Custom Cron' },
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ScheduledTaskForm({ task, tracks, agents, onSave, onClose }: Props) {
  const [name, setName] = useState(task?.name ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [taskPrompt, setTaskPrompt] = useState(task?.taskPrompt ?? '');
  const [trackId, setTrackId] = useState(task?.trackId ?? '');
  const [agentId, setAgentId] = useState(task?.agentId ?? '');
  const [provider, setProvider] = useState(task?.provider ?? 'claude');
  const [systemPromptOverride, setSystemPromptOverride] = useState(task?.systemPromptOverride ?? '');
  const [showAdvanced, setShowAdvanced] = useState(!!task?.systemPromptOverride);

  // Script state
  const [scriptContent, setScriptContent] = useState('');
  const [scriptPath, setScriptPath] = useState(task?.scriptPath ?? '');

  // Generate state (new tasks only)
  const [generateDesc, setGenerateDesc] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [suggestedScript, setSuggestedScript] = useState('');

  // Schedule state
  const [preset, setPreset] = useState<SchedulePreset>(task?.scheduleConfig?.preset ?? 'daily');
  const [intervalMinutes, setIntervalMinutes] = useState(task?.scheduleConfig?.intervalMinutes ?? 30);
  const [time, setTime] = useState(task?.scheduleConfig?.time ?? '09:00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    task?.scheduleConfig?.daysOfWeek ?? [1, 2, 3, 4, 5],
  );
  const [dayOfWeek, setDayOfWeek] = useState(task?.scheduleConfig?.dayOfWeek ?? 1);
  const [monthRule, setMonthRule] = useState<'day-of-month' | 'weekday-of-month'>(
    task?.scheduleConfig?.monthRule ?? 'day-of-month',
  );
  const [dayOfMonth, setDayOfMonth] = useState(task?.scheduleConfig?.dayOfMonth ?? 1);
  const [weekOfMonth, setWeekOfMonth] = useState(task?.scheduleConfig?.weekOfMonth ?? -1);
  const [cronExpression, setCronExpression] = useState(task?.scheduleConfig?.cronExpression ?? '0 9 * * *');

  // Fetch existing script content when editing
  useEffect(() => {
    if (!task?.id || !task.scriptPath) return;
    fetch(`/api/scheduled-tasks/${task.id}/script`)
      .then((r) => r.json())
      .then((data: { content: string | null }) => {
        if (data.content) setScriptContent(data.content);
      })
      .catch(() => { /* non-fatal */ });
  }, [task?.id, task?.scriptPath]);

  async function handleGenerate() {
    if (!generateDesc.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenerateError('');
    setSuggestedScript('');

    try {
      const res = await fetch('/api/scheduled-tasks/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: generateDesc }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        name?: string;
        description?: string;
        scheduleConfig?: ScheduleConfig;
        taskPrompt?: string;
        suggestedScriptContent?: string | null;
      };

      if (data.name) setName(data.name);
      if (data.description) setDescription(data.description);
      if (data.taskPrompt) setTaskPrompt(data.taskPrompt);
      if (data.suggestedScriptContent) {
        setSuggestedScript(data.suggestedScriptContent);
        setScriptContent(data.suggestedScriptContent);
      }
      if (data.scheduleConfig) {
        const sc = data.scheduleConfig;
        setPreset(sc.preset);
        if (sc.time) setTime(sc.time);
        if (sc.daysOfWeek) setDaysOfWeek(sc.daysOfWeek);
        if (sc.dayOfWeek !== undefined) setDayOfWeek(sc.dayOfWeek);
        if (sc.monthRule) setMonthRule(sc.monthRule);
        if (sc.dayOfMonth !== undefined) setDayOfMonth(sc.dayOfMonth);
        if (sc.weekOfMonth !== undefined) setWeekOfMonth(sc.weekOfMonth);
        if (sc.intervalMinutes !== undefined) setIntervalMinutes(sc.intervalMinutes);
        if (sc.cronExpression) setCronExpression(sc.cronExpression);
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  }

  function buildScheduleConfig(): ScheduleConfig {
    const config: ScheduleConfig = { preset };
    switch (preset) {
      case 'interval':
        config.intervalMinutes = intervalMinutes;
        break;
      case 'daily':
        config.time = time;
        config.daysOfWeek = daysOfWeek;
        break;
      case 'weekly':
        config.time = time;
        config.dayOfWeek = dayOfWeek;
        break;
      case 'monthly':
        config.time = time;
        config.monthRule = monthRule;
        if (monthRule === 'day-of-month') {
          config.dayOfMonth = dayOfMonth;
        } else {
          config.weekOfMonth = weekOfMonth;
          config.dayOfWeek = dayOfWeek;
        }
        break;
      case 'cron':
        config.cronExpression = cronExpression;
        break;
    }
    return config;
  }

  function getSchedulePreview(): string {
    switch (preset) {
      case 'interval':
        if (intervalMinutes >= 60 && intervalMinutes % 60 === 0) {
          const h = intervalMinutes / 60;
          return h === 1 ? 'Every hour' : `Every ${h} hours`;
        }
        return `Every ${intervalMinutes} minutes`;
      case 'daily': {
        const days = daysOfWeek.length === 7 || daysOfWeek.length === 0
          ? 'Daily'
          : daysOfWeek.length === 5 && [1,2,3,4,5].every((d) => daysOfWeek.includes(d))
            ? 'Weekdays'
            : daysOfWeek.map((d) => DAY_LABELS[d]).join(', ');
        return `${days} at ${time}`;
      }
      case 'weekly':
        return `Every ${DAY_LABELS[dayOfWeek]} at ${time}`;
      case 'monthly': {
        if (monthRule === 'weekday-of-month') {
          const w = weekOfMonth === -1 ? 'Last' : ordinal(weekOfMonth);
          return `${w} ${DAY_LABELS[dayOfWeek]} of month at ${time}`;
        }
        return dayOfMonth === -1
          ? `Last day of month at ${time}`
          : `${ordinal(dayOfMonth)} of month at ${time}`;
      }
      case 'cron':
        return cronExpression;
      default:
        return '';
    }
  }

  function handleSubmit() {
    if (!name.trim() || !taskPrompt.trim()) return;
    const data: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || undefined,
      taskPrompt: taskPrompt.trim(),
      scheduleConfig: buildScheduleConfig(),
      trackId: trackId || undefined,
      agentId: agentId || undefined,
      provider,
      systemPromptOverride: systemPromptOverride.trim() || undefined,
      scriptContent: scriptContent.trim() || '',
      enabled: task?.enabled ?? true,
    };
    onSave(data);
  }

  function toggleDay(d: number) {
    setDaysOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[80vw] h-[85vh] resize overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold">
            {task ? 'Edit Scheduled Task' : 'New Scheduled Task'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4 flex-1 overflow-y-auto">

          {/* Generate section (new tasks only) */}
          {!task && (
            <div className="border border-gray-700 bg-gray-800/60 rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-400">Describe what you want to schedule and Claude will draft the full definition.</p>
              <textarea
                value={generateDesc}
                onChange={(e) => setGenerateDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleGenerate(); }}
                placeholder="e.g. A daily report of pending action items from yesterday. Use Glean to search my Slack history and check for any open Linear tickets."
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
                rows={3}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating || !generateDesc.trim()}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
                >
                  {isGenerating ? 'Generating…' : 'Generate'}
                </button>
                <span className="text-[10px] text-gray-500">⌘↵ to generate</span>
                {suggestedScript && !isGenerating && (
                  <span className="text-xs text-gray-400">Script pre-filled ↓</span>
                )}
                {generateError && (
                  <span className="text-xs text-red-400">{generateError}</span>
                )}
              </div>
            </div>
          )}

          {/* Name */}
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily standup summary"
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
              autoFocus={!!task}
            />
          </Field>

          {/* Description */}
          <Field label="Description" optional>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this recurring task"
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
            />
          </Field>

          {/* Schedule */}
          <Field label="Schedule">
            <div className="space-y-3">
              {/* Preset tabs */}
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPreset(p.value)}
                    className={`px-3 py-1 text-xs rounded transition-colors ${
                      preset === p.value
                        ? 'bg-indigo-900/60 text-indigo-300'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Preset-specific fields */}
              {preset === 'interval' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10) || 30)}
                    className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-center"
                  />
                  <span className="text-xs text-gray-400">minutes</span>
                </div>
              )}

              {preset === 'daily' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">At</span>
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {DAY_LABELS.map((label, i) => (
                      <button
                        key={i}
                        onClick={() => toggleDay(i)}
                        className={`w-8 h-7 text-[10px] rounded transition-colors ${
                          daysOfWeek.includes(i)
                            ? 'bg-indigo-900/60 text-indigo-300'
                            : 'bg-gray-800 text-gray-600 hover:text-gray-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() => setDaysOfWeek([1, 2, 3, 4, 5])}
                      className="ml-2 text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      Weekdays
                    </button>
                    <button
                      onClick={() => setDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                      className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      All
                    </button>
                  </div>
                </div>
              )}

              {preset === 'weekly' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Every</span>
                  <select
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                    className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                  >
                    {DAY_LABELS.map((label, i) => (
                      <option key={i} value={i}>{label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">at</span>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                  />
                </div>
              )}

              {preset === 'monthly' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setMonthRule('day-of-month')}
                      className={`text-xs px-2 py-1 rounded ${
                        monthRule === 'day-of-month'
                          ? 'bg-indigo-900/60 text-indigo-300'
                          : 'bg-gray-800 text-gray-500'
                      }`}
                    >
                      Day of month
                    </button>
                    <button
                      onClick={() => setMonthRule('weekday-of-month')}
                      className={`text-xs px-2 py-1 rounded ${
                        monthRule === 'weekday-of-month'
                          ? 'bg-indigo-900/60 text-indigo-300'
                          : 'bg-gray-800 text-gray-500'
                      }`}
                    >
                      Weekday of month
                    </button>
                  </div>

                  {monthRule === 'day-of-month' ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">On day</span>
                      <select
                        value={dayOfMonth}
                        onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10))}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                      >
                        {Array.from({ length: 31 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>{i + 1}</option>
                        ))}
                        <option value={-1}>Last day</option>
                      </select>
                      <span className="text-xs text-gray-400">at</span>
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={weekOfMonth}
                        onChange={(e) => setWeekOfMonth(parseInt(e.target.value, 10))}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                      >
                        <option value={1}>1st</option>
                        <option value={2}>2nd</option>
                        <option value={3}>3rd</option>
                        <option value={4}>4th</option>
                        <option value={-1}>Last</option>
                      </select>
                      <select
                        value={dayOfWeek}
                        onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                      >
                        {DAY_LABELS.map((label, i) => (
                          <option key={i} value={i}>{label}</option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-400">at</span>
                      <input
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
                      />
                    </div>
                  )}
                </div>
              )}

              {preset === 'cron' && (
                <input
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="* * * * *"
                  className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono"
                />
              )}

              {/* Schedule preview */}
              <div className="text-xs text-indigo-400 font-mono">
                {getSchedulePreview()}
              </div>
            </div>
          </Field>

          {/* Task prompt */}
          <Field label="Task Prompt">
            <textarea
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="The instruction/task to send to the agent each time this runs..."
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono"
              rows={6}
            />
          </Field>

          {/* Script */}
          <Field label="Script" optional>
            <textarea
              value={scriptContent}
              onChange={(e) => setScriptContent(e.target.value)}
              placeholder={'#!/bin/bash\n# Runs before the agent. stdout is prepended to the task prompt as context.\n\n# Example: summarise recent git activity\ngit -C ~/my-repo log --oneline --since="yesterday"'}
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono"
              rows={6}
              spellCheck={false}
            />
            <p className="text-[10px] text-gray-600 mt-0.5">
              Bash script executed before the agent. stdout is prepended to the task prompt as context.
              {scriptPath
                ? <> Saved at <span className="font-mono text-gray-500">{scriptPath}</span></>
                : <> Stored in <span className="font-mono text-gray-500">~/.workshop/schedule/scripts/</span></>
              }
            </p>
          </Field>

          {/* Track binding */}
          <Field label="Track" optional>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
            >
              <option value="">None (freeform)</option>
              {tracks
                .filter((t) => t.status === 'active')
                .map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
            </select>
            <p className="text-[10px] text-gray-600 mt-0.5">
              Binding to a track pulls its context, summary, and template into the system prompt.
            </p>
          </Field>

          {/* Agent */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Agent" optional>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
              >
                <option value="">Default</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Provider">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'claude' | 'codex')}
                className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </Field>
          </div>

          {/* Advanced */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              {showAdvanced ? '- Hide advanced' : '+ Show advanced'}
            </button>
            {showAdvanced && (
              <div className="mt-2">
                <Field label="System Prompt Override" optional>
                  <textarea
                    value={systemPromptOverride}
                    onChange={(e) => setSystemPromptOverride(e.target.value)}
                    placeholder="Custom system prompt (bypasses auto-composition from track context)"
                    className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono"
                    rows={4}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !taskPrompt.trim()}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
          >
            {task ? 'Save Changes' : 'Create Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        {label}
        {optional && <span className="text-gray-600 ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
