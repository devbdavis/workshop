import { useEffect, useState } from 'react';
import type { Skill } from '@foundation/types';
import { SkillCard } from '../skills/SkillCard.js';
import { SkillFormModal, type SkillFormData } from '../skills/SkillFormModal.js';
import { ImproveSkillModal } from '../skills/ImproveSkillModal.js';

interface SkillTemplate {
  name: string;
  description: string;
  slug: string;
  content: string;
}

const HIDDEN_KEY = 'workshop:hidden-skill-templates';

function getHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch { return new Set(); }
}

function saveHidden(s: Set<string>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
}

export function SkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(getHidden);
  const [showTemplates, setShowTemplates] = useState(false);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [creating, setCreating] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [improvingSkill, setImprovingSkill] = useState<Skill | null>(null);

  async function loadSkills() {
    try {
      const [skillsRes, tplRes] = await Promise.all([
        fetch('/api/skills'),
        fetch('/api/skills/templates'),
      ]);
      if (skillsRes.ok) setSkills(await skillsRes.json());
      if (tplRes.ok) setTemplates(await tplRes.json());
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSkills(); }, []);

  async function handleCreate(data: SkillFormData) {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) { setCreating(false); loadSkills(); }
    } catch (err) { console.error('Failed to create skill:', err); }
  }

  async function handleUpdate(id: string, data: SkillFormData) {
    try {
      const res = await fetch(`/api/skills/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) { setEditingSkill(null); loadSkills(); }
    } catch (err) { console.error('Failed to update skill:', err); }
  }

  async function handleApplyImprovement(id: string, data: { name?: string; description?: string; content: string }) {
    const skill = skills.find((s) => s.id === id);
    if (!skill) return;
    await handleUpdate(id, {
      name: data.name ?? skill.name,
      description: data.description ?? skill.description,
      content: data.content,
    });
    setImprovingSkill(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this skill?')) return;
    try {
      const res = await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      if (res.ok) loadSkills();
    } catch (err) { console.error('Failed to delete skill:', err); }
  }

  async function handleSyncFromTemplate(skillId: string) {
    await fetch(`/api/skills/${skillId}/sync-from-template`, { method: 'POST' });
    loadSkills();
  }

  async function handleSaveAsTemplate(skillId: string) {
    const res = await fetch(`/api/skills/${skillId}/save-as-template`, { method: 'POST' });
    if (res.ok) {
      const updated: Skill = await res.json();
      setEditingSkill(updated);
    }
    loadSkills();
  }

  async function handleInstallTemplate(template: SkillTemplate) {
    try {
      await fetch('/api/skills/install-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: template.name, description: template.description, content: template.content, slug: template.slug }),
      });
      loadSkills();
    } catch (err) { console.error('Failed to install template:', err); }
  }

  function hideTemplate(slug: string) {
    const next = new Set(hidden);
    next.add(slug);
    setHidden(next);
    saveHidden(next);
  }

  const mySkills = skills
    .filter((s) => s.source === 'global')
    .sort((a, b) => a.name.localeCompare(b.name));

  const visibleTemplates = templates.filter((t) => !hidden.has(t.slug));
  const hiddenCount = templates.filter((t) => hidden.has(t.slug)).length;

  if (loading) {
    return <p className="text-sm text-gray-500">Loading skills...</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Skills</h2>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
        >
          New Skill
        </button>
      </div>

      {mySkills.length > 0 ? (
        <section className="bg-gray-900 border border-gray-800 rounded-lg p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              My Skills
              <span className="ml-2 text-sm font-normal text-gray-500">({mySkills.length})</span>
            </h2>
            <p className="text-sm text-gray-400">Saved to ~/.claude/skills/ — available as slash commands in Claude Code</p>
          </div>
          <div className="space-y-3">
            {mySkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onEdit={() => setEditingSkill(skill)}
                onDelete={() => handleDelete(skill.id)}
                onImprove={() => setImprovingSkill(skill)}
                onSyncFromTemplate={skill.isOutOfSync ? () => handleSyncFromTemplate(skill.id) : undefined}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-gray-500">No skills yet. Create one to get started.</p>
      )}

      {/* Templates section — always below real items */}
      {templates.length > 0 && (
        <section className="mt-8 bg-gray-900/50 border border-gray-800/50 rounded-lg p-6">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center justify-between text-left group"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-400 group-hover:text-gray-200 transition-colors">
                Templates
                <span className="ml-2 text-sm font-normal text-gray-600">
                  ({visibleTemplates.length} available{hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''})
                </span>
              </h2>
              <p className="text-sm text-gray-500">Skill definitions you can install across machines</p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-600 transition-transform ${showTemplates ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {showTemplates && (
            <div className="mt-4 space-y-2">
              {visibleTemplates.length === 0 && (
                <p className="text-xs text-gray-600 italic">All templates are hidden.</p>
              )}
              {visibleTemplates.map((t) => (
                <div
                  key={t.slug}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-300">{t.name}</span>
                    {t.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleInstallTemplate(t)}
                    className="shrink-0 px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                  >
                    Install
                  </button>
                  <button
                    onClick={() => hideTemplate(t.slug)}
                    className="shrink-0 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                    title="Hide this template"
                  >
                    Hide
                  </button>
                </div>
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => { setHidden(new Set()); saveHidden(new Set()); }}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors mt-1"
                >
                  Show {hiddenCount} hidden template{hiddenCount !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {creating && (
        <SkillFormModal onSave={handleCreate} onClose={() => setCreating(false)} />
      )}

      {editingSkill && (
        <SkillFormModal
          initial={editingSkill}
          onSave={(data) => handleUpdate(editingSkill.id, data)}
          onClose={() => setEditingSkill(null)}
          onSaveAsTemplate={() => handleSaveAsTemplate(editingSkill.id)}
        />
      )}

      {improvingSkill && (
        <ImproveSkillModal
          skill={improvingSkill}
          onApply={(data) => handleApplyImprovement(improvingSkill.id, data)}
          onClose={() => setImprovingSkill(null)}
        />
      )}
    </>
  );
}
