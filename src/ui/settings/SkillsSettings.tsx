import { useEffect, useState } from 'react';
import type { Skill } from '@foundation/types';
import { SkillCard } from '../skills/SkillCard.js';
import { SkillFormModal, type SkillFormData } from '../skills/SkillFormModal.js';

export function SkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [creating, setCreating] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  async function loadSkills() {
    try {
      const res = await fetch('/api/skills');
      if (res.ok) setSkills(await res.json());
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSkills();
  }, []);

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

  async function handleDelete(id: string) {
    if (!confirm('Delete this skill?')) return;
    try {
      const res = await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      if (res.ok) loadSkills();
    } catch (err) { console.error('Failed to delete skill:', err); }
  }

  const mySkills = skills
    .filter((s) => s.source === 'global')
    .sort((a, b) => a.name.localeCompare(b.name));

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
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-gray-500">No skills yet. Create one to get started.</p>
      )}

      {creating && (
        <SkillFormModal onSave={handleCreate} onClose={() => setCreating(false)} />
      )}

      {editingSkill && (
        <SkillFormModal
          initial={editingSkill}
          onSave={(data) => handleUpdate(editingSkill.id, data)}
          onClose={() => setEditingSkill(null)}
        />
      )}
    </>
  );
}
