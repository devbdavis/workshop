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
      createdAt: mtime,
      updatedAt: mtime,
    };
  } catch (err) {
    console.error(`Failed to parse agent file ${filePath}:`, err);
    return null;
  }
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

      // Parse key: value
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        frontmatter[key] = value;
      }
    }
  }

  if (frontmatterEnd > 0) {
    body = lines.slice(frontmatterEnd + 1).join('\n');
  }

  return { frontmatter, body };
}
