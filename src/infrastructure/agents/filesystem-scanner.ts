import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Agent, AgentId, AgentSource, SessionProvider } from '@foundation/types';

// Re-export domain interface so existing consumers are not broken
export type { AgentScanner as FilesystemAgentScanner } from '@domain/agent/scanner.js';
import type { AgentScanner as FilesystemAgentScanner } from '@domain/agent/scanner.js';

export function createFilesystemAgentScanner(): FilesystemAgentScanner {
  return {
    scanGlobalAgents(): Agent[] {
      const globalDir = path.join(os.homedir(), '.claude', 'agents');
      return scanDirectory(globalDir, 'global');
    },

    scanProjectAgents(projectRoot: string): Agent[] {
      const projectDir = path.join(projectRoot, '.claude', 'agents');
      return scanDirectory(projectDir, 'project');
    },

    scanAll(projectRoot?: string): Agent[] {
      const global = this.scanGlobalAgents();
      const project = projectRoot ? this.scanProjectAgents(projectRoot) : [];
      return [...global, ...project];
    },

    findById(id: AgentId, projectRoot?: string): Agent | null {
      const all = this.scanAll(projectRoot);
      return all.find((a) => a.id === id) || null;
    },
  };
}

function scanDirectory(dir: string, source: AgentSource): Agent[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const agents: Agent[] = [];
  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;

    const filePath = path.join(dir, entry);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const agent = parseAgentFile(filePath, source);
    if (agent) {
      agents.push(agent);
    }
  }

  return agents;
}

function parseAgentFile(filePath: string, source: AgentSource): Agent | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(content);

    const basename = path.basename(filePath, '.md');
    const id = `${source}:${basename}` as AgentId;

    const stat = fs.statSync(filePath);
    const mtime = stat.mtime.toISOString();

    // Extract frontmatter fields
    const name = parsed.frontmatter.name || basename;
    const description = parsed.frontmatter.description || '';
    const model = parsed.frontmatter.model;
    const color = parsed.frontmatter.color;
    const maxTurns = parsed.frontmatter.maxTurns
      ? parseInt(parsed.frontmatter.maxTurns, 10)
      : undefined;

    // Parse tools: comma-separated string
    let allowedTools: string[] | undefined;
    if (parsed.frontmatter.tools) {
      allowedTools = parsed.frontmatter.tools
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean);
    }

    return {
      id,
      name,
      description,
      model,
      provider: parsed.frontmatter.provider as SessionProvider | undefined,
      color,
      systemPrompt: parsed.body.trim(),
      source,
      filePath,
      allowedTools,
      maxTurns,
      templateName: parsed.frontmatter.templateName || undefined,
      createdAt: mtime,
      updatedAt: mtime,
    };
  } catch (err) {
    console.error(`Failed to parse agent file ${filePath}:`, err);
    return null;
  }
}

// --- Write operations for global agents ---

interface AgentWriteData {
  name: string;
  description: string;
  model?: string;
  color?: string;
  systemPrompt: string;
  allowedTools?: string[];
  maxTurns?: number;
  provider?: string;
  templateName?: string;
}

export function writeGlobalAgent(data: AgentWriteData): Agent {
  const globalDir = path.join(os.homedir(), '.claude', 'agents');
  fs.mkdirSync(globalDir, { recursive: true });

  const slug = slugify(data.name);
  let filename = `${slug}.md`;
  let filePath = path.join(globalDir, filename);
  let counter = 1;
  while (fs.existsSync(filePath)) {
    filename = `${slug}-${counter}.md`;
    filePath = path.join(globalDir, filename);
    counter++;
  }

  fs.writeFileSync(filePath, formatAgentFile(data), 'utf-8');
  const now = new Date().toISOString();
  const basename = path.basename(filePath, '.md');

  return {
    id: `global:${basename}` as AgentId,
    name: data.name,
    description: data.description,
    model: data.model,
    color: data.color,
    systemPrompt: data.systemPrompt,
    source: 'global',
    filePath,
    allowedTools: data.allowedTools,
    maxTurns: data.maxTurns,
    provider: data.provider as SessionProvider | undefined,
    templateName: data.templateName,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateGlobalAgent(id: AgentId, data: AgentWriteData): Agent | null {
  const basename = id.replace(/^global:/, '');
  const filePath = path.join(os.homedir(), '.claude', 'agents', `${basename}.md`);
  if (!fs.existsSync(filePath)) return null;

  // Preserve existing templateName if not explicitly provided
  if (data.templateName === undefined) {
    try {
      const existing = parseAgentFile(filePath, 'global');
      if (existing?.templateName) data = { ...data, templateName: existing.templateName };
    } catch { /* ignore */ }
  }

  fs.writeFileSync(filePath, formatAgentFile(data), 'utf-8');
  const stat = fs.statSync(filePath);

  return {
    id,
    name: data.name,
    description: data.description,
    model: data.model,
    color: data.color,
    systemPrompt: data.systemPrompt,
    source: 'global',
    filePath,
    allowedTools: data.allowedTools,
    maxTurns: data.maxTurns,
    provider: data.provider as SessionProvider | undefined,
    templateName: data.templateName,
    createdAt: stat.ctime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
  };
}

export function deleteGlobalAgent(id: AgentId): boolean {
  const basename = id.replace(/^global:/, '');
  const filePath = path.join(os.homedir(), '.claude', 'agents', `${basename}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
}

function formatAgentFile(data: AgentWriteData): string {
  const lines = ['---'];
  lines.push(`name: ${data.name}`);
  lines.push(`description: ${data.description}`);
  if (data.model) lines.push(`model: ${data.model}`);
  if (data.color) lines.push(`color: ${data.color}`);
  if (data.provider) lines.push(`provider: ${data.provider}`);
  if (data.allowedTools?.length) lines.push(`tools: ${data.allowedTools.join(', ')}`);
  if (data.maxTurns) lines.push(`maxTurns: ${data.maxTurns}`);
  if (data.templateName) lines.push(`templateName: ${data.templateName}`);
  lines.push('---');
  lines.push('');
  lines.push(data.systemPrompt);
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

      // Parse key: value (with YAML block scalar support)
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
