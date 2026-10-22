/**
 * Dark Factory template loader — reads playbook templates from
 * templates/playbooks/*.json and seeds them into the playbook registry on demand.
 *
 * Templates are versioned data files (not a generic installer framework): each
 * carries a stage graph plus an `intakeQuestions` list the UI renders up front.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StageDefinition, MatchCriteria, PromptOverrides } from '@domain/workflow/types.js';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';

export interface TemplateIntakeQuestion {
  id: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  intakeQuestions: TemplateIntakeQuestion[];
}

interface TemplateFile {
  id?: string;
  name: string;
  description: string;
  issueType?: 'epic' | 'task';
  epicPlaybook: StageDefinition[];
  promptOverrides?: PromptOverrides;
  matchCriteria?: MatchCriteria;
  intakeQuestions?: TemplateIntakeQuestion[];
}

function templatesDir(projectRoot: string): string {
  return join(projectRoot, 'templates', 'playbooks');
}

function readTemplateFile(projectRoot: string, slug: string): TemplateFile {
  const raw = readFileSync(join(templatesDir(projectRoot), `${slug}.json`), 'utf8');
  return JSON.parse(raw) as TemplateFile;
}

/** List available templates (metadata + intake only — no stage graph). */
export function listTemplates(projectRoot: string): TemplateSummary[] {
  let files: string[];
  try {
    files = readdirSync(templatesDir(projectRoot)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const slug = f.replace(/\.json$/, '');
    const t = readTemplateFile(projectRoot, slug);
    return { slug, name: t.name, description: t.description, intakeQuestions: t.intakeQuestions ?? [] };
  });
}

/** Load one template's full definition (throws if the slug doesn't exist). */
export function loadTemplate(projectRoot: string, slug: string): TemplateFile {
  return readTemplateFile(projectRoot, slug);
}

/**
 * Idempotently ensure a playbook row exists for a template and return its rowId.
 * Seeds on first use; reuses the existing row thereafter.
 */
export function ensurePlaybookForTemplate(
  projectRoot: string,
  slug: string,
  playbooks: PlaybookRepository,
): string {
  const t = loadTemplate(projectRoot, slug);
  const id = t.id ?? slug;

  const existing = playbooks.findLatest(id);
  if (existing) return existing.rowId;

  const created = playbooks.create({
    id,
    version: 1,
    name: t.name,
    description: t.description,
    issueType: t.issueType ?? 'epic',
    stageDefinitions: t.epicPlaybook,
    promptOverrides: t.promptOverrides,
    matchCriteria: t.matchCriteria,
    tags: t.matchCriteria?.keywords,
    usageCount: 0,
    createdBy: 'dark-factory-template',
  });
  return created.rowId;
}
