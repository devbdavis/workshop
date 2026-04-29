import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { SkillId } from '@foundation/types';
import type { FilesystemSkillScanner } from '@infrastructure/skills/filesystem-scanner.js';
import {
  writeGlobalSkill,
  updateGlobalSkill,
  deleteGlobalSkill,
  renameGlobalSkill,
} from '@infrastructure/skills/filesystem-scanner.js';
import { callClaude, extractJson, ClaudeBinaryNotFoundError } from './claude-cli.js';

export interface SkillRouterDeps {
  filesystemScanner: FilesystemSkillScanner;
  projectRoot: string;
}

/** Translate a callClaude error into an HTTP response. Surfaces the actual
 *  error message so the UI can tell "claude not installed" from
 *  "claude returned malformed JSON" — previously both showed the same
 *  generic "make sure claude is available" message. */
function respondWithClaudeError(res: import('express').Response, err: unknown, fallback: string): void {
  if (err instanceof ClaudeBinaryNotFoundError) {
    res.status(503).json({ error: err.message, code: 'claude_not_found' });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: `${fallback}: ${message}` });
}

export function createSkillRouter(deps: SkillRouterDeps): Router {
  const router = Router();
  const { filesystemScanner, projectRoot } = deps;

  // --- Skill templates (templates/skills/*/ not yet installed) ---

  router.get('/skills/templates', (_req, res) => {
    const tplDir = path.join(projectRoot, 'templates', 'skills');
    if (!fs.existsSync(tplDir)) { res.json([]); return; }
    const installed = new Set(filesystemScanner.scanAll(projectRoot).map((s) => s.name));
    const templates: unknown[] = [];
    for (const entry of fs.readdirSync(tplDir)) {
      const skillMd = path.join(tplDir, entry, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const raw = fs.readFileSync(skillMd, 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
        const content = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
        const name = nameMatch?.[1]?.trim() ?? entry;
        if (installed.has(name)) continue;
        templates.push({ name, description: descMatch?.[1]?.trim() ?? '', slug: entry, content });
      } catch { /* skip */ }
    }
    res.json(templates);
  });

  // --- Save current skill as template ---

  router.post('/skills/:id/save-as-template', (req, res) => {
    const id = req.params.id as SkillId;
    const skill = filesystemScanner.findById(id, projectRoot);
    if (!skill) { res.status(404).json({ error: 'Skill not found' }); return; }

    const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const tplDir = path.join(projectRoot, 'templates', 'skills', slug);
    fs.mkdirSync(tplDir, { recursive: true });
    const tplContent = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content}`;
    fs.writeFileSync(path.join(tplDir, 'SKILL.md'), tplContent, 'utf-8');

    const updated = updateGlobalSkill(id, { name: skill.name, description: skill.description, content: skill.content, templateName: slug });
    res.json(updated);
  });

  // --- Sync skill from its linked template ---

  router.post('/skills/:id/sync-from-template', (req, res) => {
    const id = req.params.id as SkillId;
    const skill = filesystemScanner.findById(id, projectRoot);
    if (!skill) { res.status(404).json({ error: 'Skill not found' }); return; }
    if (!skill.templateName) { res.status(400).json({ error: 'Skill has no linked template' }); return; }

    const tplPath = path.join(projectRoot, 'templates', 'skills', skill.templateName, 'SKILL.md');
    if (!fs.existsSync(tplPath)) { res.status(404).json({ error: 'Template file not found' }); return; }

    const raw = fs.readFileSync(tplPath, 'utf-8');
    const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
    const content = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
    const descMatch = raw.match(/^description:\s*(.+)$/m);
    const description = descMatch?.[1]?.trim() ?? skill.description;

    const updated = updateGlobalSkill(id, { name: skill.name, description, content, templateName: skill.templateName });
    res.json(updated);
  });

  // --- Install template skill ---

  router.post('/skills/install-template', (req, res) => {
    const { name, description, content, slug } = req.body as { name: string; description: string; content: string; slug: string };
    if (!name || !content) { res.status(400).json({ error: 'name and content are required' }); return; }
    try {
      const skill = writeGlobalSkill({ name, description: description ?? '', content, templateName: slug });
      res.status(201).json(skill);
    } catch (err) {
      res.status(500).json({ error: 'Failed to install template skill' });
    }
  });

  // --- List all skills (with isOutOfSync enrichment) ---

  router.get('/skills', (_req, res) => {
    const tplDir = path.join(projectRoot, 'templates', 'skills');
    const all = filesystemScanner.scanAll(projectRoot);
    const enriched = all.map((skill) => {
      if (!skill.templateName) return skill;
      const tplPath = path.join(tplDir, skill.templateName, 'SKILL.md');
      try {
        const raw = fs.readFileSync(tplPath, 'utf-8');
        const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
        const tplContent = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
        const isOutOfSync = skill.content !== tplContent;
        return isOutOfSync ? { ...skill, isOutOfSync: true, templateContent: tplContent } : skill;
      } catch {
        return skill;
      }
    });
    res.json(enriched);
  });

  // --- Generate skill definition via claude CLI ---

  router.post('/skills/generate', async (req, res) => {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const prompt = `Generate a Claude Code skill definition based on this description:\n\n${description}\n\nA skill is a reusable markdown document injected into Claude Code as context. Skills have YAML frontmatter and a markdown body.\n\nReturn a JSON object with these fields:\n- name: short skill identifier, kebab-case (e.g. "typescript-strict-mode")\n- description: one or two sentences covering BOTH what the skill does AND when to use it. The description is the primary triggering mechanism — make it slightly "pushy" so Claude doesn't undertrigger. E.g. instead of "Helps with TypeScript" write "Apply strict TypeScript best practices. Use this whenever writing or reviewing TypeScript code, even if the user hasn't explicitly asked for it."\n- content: the full skill body as markdown. Use imperative form. Explain the *why* behind instructions rather than just issuing MUSTs. Include sections for trigger conditions, behavior, and output format as appropriate. Aim for clarity over completeness — a focused 100-line skill beats a sprawling 400-line one.\n\nReturn ONLY the JSON object, no other text or markdown.`;

    try {
      const output = await callClaude(prompt);
      res.json(extractJson(output));
    } catch (err) {
      console.error('Skill generation failed:', err);
      respondWithClaudeError(res, err, 'Skill generation failed');
    }
  });

  // --- Create skill (writes to ~/.claude/skills/) ---

  router.post('/skills', (req, res) => {
    const { name, description, content } = req.body;

    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
    if (!description || typeof description !== 'string') { res.status(400).json({ error: 'description is required' }); return; }
    if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }

    try {
      res.status(201).json(writeGlobalSkill({ name, description, content }));
    } catch (err) {
      console.error('Failed to write skill file:', err);
      res.status(500).json({ error: 'Failed to create skill' });
    }
  });

  // --- Improve skill with Claude feedback ---

  router.post('/skills/:id/improve', async (req, res) => {
    const id = req.params.id as SkillId;
    const { feedback } = req.body;
    if (!feedback || typeof feedback !== 'string') { res.status(400).json({ error: 'feedback is required' }); return; }

    const skill = filesystemScanner.findById(id, projectRoot);
    if (!skill) { res.status(404).json({ error: 'Skill not found' }); return; }

    const prompt = `You are improving a Claude Code skill definition based on user feedback.

Current skill:
Name: ${skill.name}
Description: ${skill.description}
Content:
${skill.content}

User feedback:
${feedback}

Return a JSON object with these fields (only include fields that should change):
- name: updated name if needed
- description: updated description if needed
- content: the improved skill content (always include this)

Return ONLY the JSON object, no other text or markdown.`;

    try {
      const output = await callClaude(prompt);
      res.json(extractJson(output));
    } catch (err) {
      console.error('Skill improvement failed:', err);
      respondWithClaudeError(res, err, 'Skill improvement failed');
    }
  });

  // --- Rename skill (moves folder, updates frontmatter) ---

  router.post('/skills/:id/rename', (req, res) => {
    const id = req.params.id as SkillId;
    const { name } = req.body;

    if (id.startsWith('project:')) { res.status(403).json({ error: 'Cannot rename project skills' }); return; }
    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }

    try {
      const renamed = renameGlobalSkill(id, name);
      if (!renamed) { res.status(404).json({ error: 'Skill not found' }); return; }
      res.json(renamed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename skill';
      res.status(409).json({ error: message });
    }
  });

  // --- Update skill ---

  router.put('/skills/:id', (req, res) => {
    const id = req.params.id as SkillId;

    if (id.startsWith('project:')) { res.status(403).json({ error: 'Cannot modify project skills' }); return; }

    const updated = updateGlobalSkill(id, req.body);
    if (!updated) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.json(updated);
  });

  // --- Delete skill ---

  router.delete('/skills/:id', (req, res) => {
    const id = req.params.id as SkillId;

    if (id.startsWith('project:')) { res.status(403).json({ error: 'Cannot delete project skills' }); return; }

    if (!deleteGlobalSkill(id)) { res.status(404).json({ error: 'Skill not found' }); return; }
    res.status(204).send();
  });

  return router;
}
