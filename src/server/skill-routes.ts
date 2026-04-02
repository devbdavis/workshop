import { Router } from 'express';
import { spawn } from 'child_process';
import type { SkillId } from '@foundation/types';
import type { FilesystemSkillScanner } from '@infrastructure/skills/filesystem-scanner.js';
import {
  writeGlobalSkill,
  updateGlobalSkill,
  deleteGlobalSkill,
} from '@infrastructure/skills/filesystem-scanner.js';

export interface SkillRouterDeps {
  filesystemScanner: FilesystemSkillScanner;
  projectRoot: string;
}

function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI timed out after 120s'));
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString().trim() || `claude exited with code ${code}`));
      } else {
        resolve(Buffer.concat(out).toString());
      }
    });

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}

export function createSkillRouter(deps: SkillRouterDeps): Router {
  const router = Router();
  const { filesystemScanner, projectRoot } = deps;

  // --- List all skills ---

  router.get('/skills', (_req, res) => {
    res.json(filesystemScanner.scanAll(projectRoot));
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
      res.status(500).json({ error: 'Skill generation failed' });
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
