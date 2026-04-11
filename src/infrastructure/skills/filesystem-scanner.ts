import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Skill, SkillId, SkillSource } from '@foundation/types';

// Re-export domain interface so existing consumers are not broken
export type { SkillScanner as FilesystemSkillScanner } from '@domain/skill/scanner.js';
import type { SkillScanner as FilesystemSkillScanner } from '@domain/skill/scanner.js';

export function createFilesystemSkillScanner(): FilesystemSkillScanner {
  return {
    scanGlobalSkills(): Skill[] {
      const globalDir = path.join(os.homedir(), '.claude', 'skills');
      return scanDirectory(globalDir, 'global');
    },

    scanProjectSkills(projectRoot: string): Skill[] {
      const projectDir = path.join(projectRoot, '.claude', 'skills');
      return scanDirectory(projectDir, 'project');
    },

    scanAll(projectRoot?: string): Skill[] {
      const global = this.scanGlobalSkills();
      const project = projectRoot ? this.scanProjectSkills(projectRoot) : [];
      return [...global, ...project];
    },

    findById(id: SkillId, projectRoot?: string): Skill | null {
      const all = this.scanAll(projectRoot);
      return all.find((s) => s.id === id) || null;
    },
  };
}

function scanDirectory(dir: string, source: SkillSource): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const skills: Skill[] = [];
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    const entryPath = path.join(dir, entry);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(entryPath);
    } catch {
      continue;
    }

    if (stat.isFile() && entry.endsWith('.md')) {
      // Flat-file format: skill-name.md with optional frontmatter
      const skill = parseSkillFile(entryPath, path.basename(entry, '.md'), source);
      if (skill) skills.push(skill);
    } else if (stat.isDirectory()) {
      // Directory format: skill-name/SKILL.md
      const skillMdPath = path.join(entryPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const skill = parseSkillFile(skillMdPath, entry, source);
        if (skill) skills.push(skill);
      }
    }
  }

  return skills;
}

function parseSkillFile(filePath: string, basename: string, source: SkillSource): Skill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);
    const mtime = stat.mtime.toISOString();
    const id = `${source}:${basename}` as SkillId;

    // Detect frontmatter format vs heading-based format
    if (raw.trimStart().startsWith('---')) {
      const parsed = parseFrontmatter(raw);
      return {
        id,
        name: parsed.frontmatter.name || basename,
        description: parsed.frontmatter.description || '',
        content: parsed.body.trim(),
        source,
        filePath,
        templateName: parsed.frontmatter.templateName || undefined,
        createdAt: mtime,
        updatedAt: mtime,
      };
    }

    // Heading-based format (e.g. SKILL.md files): no frontmatter
    const { name, description } = parseHeadingFormat(raw);
    return {
      id,
      name: name || basename,
      description,
      // Store the full raw content so the editor can round-trip it faithfully
      content: raw,
      source,
      filePath,
      createdAt: mtime,
      updatedAt: mtime,
    };
  } catch (err) {
    console.error(`Failed to parse skill file ${filePath}:`, err);
    return null;
  }
}

/**
 * Extract name and description from a markdown file that uses a `# Heading`
 * as its title and a plain paragraph immediately after as its description.
 */
function parseHeadingFormat(content: string): { name: string; description: string } {
  const lines = content.split('\n');
  let name = '';
  const descLines: string[] = [];
  let pastHeading = false;

  for (const line of lines) {
    if (!name && line.startsWith('# ')) {
      name = line.slice(2).trim();
      pastHeading = true;
      continue;
    }
    if (pastHeading) {
      if (line.startsWith('## ')) break;
      if (line.trim()) {
        descLines.push(line.trim());
      } else if (descLines.length > 0) {
        // First blank line after the opening paragraph — stop
        break;
      }
    }
  }

  return { name, description: descLines.join(' ') };
}

// --- Write operations for global skills ---

export interface SkillWriteData {
  name: string;
  description: string;
  content: string;
  templateName?: string;
}

export function writeGlobalSkill(data: SkillWriteData): Skill {
  const globalDir = path.join(os.homedir(), '.claude', 'skills');

  const slug = slugify(data.name);
  let basename = slug;
  let skillDir = path.join(globalDir, basename);
  let counter = 1;
  while (fs.existsSync(skillDir)) {
    basename = `${slug}-${counter}`;
    skillDir = path.join(globalDir, basename);
    counter++;
  }

  fs.mkdirSync(skillDir, { recursive: true });
  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(filePath, formatSkillFile(data), 'utf-8');
  const now = new Date().toISOString();

  return {
    id: `global:${basename}` as SkillId,
    name: data.name,
    description: data.description,
    content: data.content,
    source: 'global',
    filePath,
    templateName: data.templateName,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateGlobalSkill(id: SkillId, data: SkillWriteData): Skill | null {
  const basename = id.replace(/^global:/, '');
  const flatPath = path.join(os.homedir(), '.claude', 'skills', `${basename}.md`);
  const dirSkillPath = path.join(os.homedir(), '.claude', 'skills', basename, 'SKILL.md');

  if (fs.existsSync(flatPath)) {
    const existing = data.templateName === undefined ? parseSkillFile(flatPath, basename, 'global') : null;
    const merged = { ...data, templateName: data.templateName ?? existing?.templateName };
    fs.writeFileSync(flatPath, formatSkillFile(merged), 'utf-8');
    const stat = fs.statSync(flatPath);
    return {
      id,
      name: data.name,
      description: data.description,
      content: data.content,
      source: 'global',
      filePath: flatPath,
      templateName: merged.templateName,
      createdAt: stat.ctime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  if (fs.existsSync(dirSkillPath)) {
    const existing = data.templateName === undefined ? parseSkillFile(dirSkillPath, basename, 'global') : null;
    const merged = { ...data, templateName: data.templateName ?? existing?.templateName };
    fs.writeFileSync(dirSkillPath, formatSkillFile(merged), 'utf-8');
    const stat = fs.statSync(dirSkillPath);
    return {
      id,
      name: data.name,
      description: data.description,
      content: data.content,
      source: 'global',
      filePath: dirSkillPath,
      templateName: merged.templateName,
      createdAt: stat.ctime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  return null;
}

export function renameGlobalSkill(id: SkillId, newName: string): Skill | null {
  const basename = id.replace(/^global:/, '');
  const globalDir = path.join(os.homedir(), '.claude', 'skills');
  const flatPath = path.join(globalDir, `${basename}.md`);
  const dirPath = path.join(globalDir, basename);

  const newSlug = slugify(newName);
  const newFlatPath = path.join(globalDir, `${newSlug}.md`);
  const newDirPath = path.join(globalDir, newSlug);

  if (fs.existsSync(flatPath) && fs.statSync(flatPath).isFile()) {
    if (fs.existsSync(newFlatPath)) throw new Error(`A skill named '${newSlug}' already exists`);
    fs.renameSync(flatPath, newFlatPath);
    const raw = fs.readFileSync(newFlatPath, 'utf-8');
    fs.writeFileSync(newFlatPath, patchNameInFrontmatter(raw, newSlug), 'utf-8');
    return parseSkillFile(newFlatPath, newSlug, 'global');
  }

  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    if (fs.existsSync(newDirPath)) throw new Error(`A skill named '${newSlug}' already exists`);
    fs.renameSync(dirPath, newDirPath);
    const skillMdPath = path.join(newDirPath, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const raw = fs.readFileSync(skillMdPath, 'utf-8');
      fs.writeFileSync(skillMdPath, patchNameInFrontmatter(raw, newSlug), 'utf-8');
    }
    return parseSkillFile(path.join(newDirPath, 'SKILL.md'), newSlug, 'global');
  }

  return null;
}

function patchNameInFrontmatter(content: string, newName: string): string {
  if (/^name:/m.test(content)) {
    return content.replace(/^name:.*$/m, `name: ${newName}`);
  }
  // No name field — insert one after the opening fence
  return content.replace(/^---\n/, `---\nname: ${newName}\n`);
}

export function deleteGlobalSkill(id: SkillId): boolean {
  const basename = id.replace(/^global:/, '');
  const flatPath = path.join(os.homedir(), '.claude', 'skills', `${basename}.md`);
  const dirPath = path.join(os.homedir(), '.claude', 'skills', basename);

  if (fs.existsSync(flatPath) && fs.statSync(flatPath).isFile()) {
    fs.unlinkSync(flatPath);
    return true;
  }

  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    fs.rmSync(dirPath, { recursive: true });
    return true;
  }

  return false;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
}

function formatSkillFile(data: SkillWriteData): string {
  const lines = ['---'];
  lines.push(`name: ${slugify(data.name)}`);
  lines.push(`description: ${data.description}`);
  if (data.templateName) lines.push(`templateName: ${data.templateName}`);
  lines.push('---');
  lines.push('');
  lines.push(data.content);
  return lines.join('\n');
}

interface ParsedFile {
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * Simple YAML frontmatter parser.
 * Expects:
 * ---
 * key: value
 * ---
 * body content
 */
function parseFrontmatter(content: string): ParsedFile {
  const lines = content.split('\n');
  const frontmatter: Record<string, string> = {};
  let body = content;
  let inFrontmatter = false;
  let frontmatterEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter) {
      if (line.trim() === '---') {
        frontmatterEnd = i;
        break;
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const rawValue = line.slice(colonIdx + 1).trim();

        // Handle YAML block scalars: > (folded) and | (literal), with optional chomping modifiers
        if (/^[>|][+-]?$/.test(rawValue)) {
          const isFolded = rawValue.startsWith('>');
          const blockLines: string[] = [];
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (nextLine.trim() === '---' || (nextLine.length > 0 && !/^\s/.test(nextLine))) {
              break;
            }
            i++;
            blockLines.push(lines[i].trim());
          }
          frontmatter[key] = isFolded ? blockLines.join(' ').trim() : blockLines.join('\n').trim();
        } else {
          frontmatter[key] = rawValue;
        }
      }
    }
  }

  if (frontmatterEnd > 0) {
    body = lines.slice(frontmatterEnd + 1).join('\n');
  }

  return { frontmatter, body };
}
