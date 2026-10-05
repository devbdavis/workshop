/**
 * Design Mode API — screenshot a picked element (via the Playwright sidecar)
 * and send picks (HTML, computed styles, screenshots) into a session's terminal.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, realpathSync } from 'fs';
import path from 'path';
import type { SessionRepository } from '@domain/session/repository';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import type { SessionId } from '@foundation/types';
import { ensureAuthToken } from '@foundation/auth.js';
import { getPreviewPort } from './preview-proxy.js';

export interface PreviewRouterDeps {
  sessions: Pick<SessionRepository, 'findById'>;
  terminal: Pick<TerminalManager, 'sendInput'>;
}

export interface PickInput {
  selector: string;
  url: string;
  tag: string;
  text?: string;
  outerHTML?: string;
  parentHTML?: string;
  styles?: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  source?: string | null;
  viewport: { width: number; height: number };
  screenshot?: string;
}

/** `<sessionDataDir>/design-picks` — mirrors SESSION_DATA_DIR in terminal/manager.ts. */
function designPicksDir(sessionId: string): string {
  return path.join(process.env.HOME || '/tmp', '.workshop', 'sessions', sessionId, 'design-picks');
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeFence(html: string): string {
  return html.replace(/```/g, '` ` `');
}

/** Replaces a value that exceeds `max` with a truncated, suffixed copy — defense in depth, the picker already truncates client-side. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

/** Pure markdown builder for a Design Mode send — exported for testing. */
export function buildPicksMarkdown(target: string, picks: PickInput[], note?: string): string {
  const first = picks[0];
  const lines: string[] = [
    '# Design Mode picks',
    `Preview: ${target}${first.url} (viewport ${first.viewport.width}x${first.viewport.height})`,
    '',
  ];
  if (note?.trim()) {
    lines.push(note.trim(), '');
  }

  picks.forEach((pick, i) => {
    lines.push(`## ${i + 1}. \`${pick.selector}\``);
    lines.push(`- Page: ${pick.url}`);
    if (pick.source) lines.push(`- Source: ${pick.source}`);
    if (pick.screenshot) lines.push(`- Screenshot: ${pick.screenshot}`);
    if (pick.text) lines.push(`- Text: "${pick.text}"`);
    lines.push(`- Box: ${pick.rect.width}×${pick.rect.height} at (${pick.rect.x}, ${pick.rect.y})`);
    lines.push('', 'Computed styles:', '```css');
    for (const [key, value] of Object.entries(pick.styles ?? {})) {
      lines.push(`${key}: ${value};`);
    }
    lines.push('```', '', 'Element:', '```html', sanitizeFence(truncate(pick.outerHTML ?? '', 4000)), '```');
    lines.push('', 'Parent:', '```html', sanitizeFence(truncate(pick.parentHTML ?? '', 1500)), '```', '');
  });

  return lines.join('\n');
}

interface ShotInput {
  target: string;
  url: string;
  selector: string;
  width: number;
  height: number;
}

function validateShotBody(body: unknown): ShotInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.target !== 'string' || !b.target) return null;
  if (typeof b.url !== 'string' || !b.url) return null;
  if (typeof b.selector !== 'string' || !b.selector) return null;
  if (typeof b.width !== 'number' || !Number.isFinite(b.width)) return null;
  if (typeof b.height !== 'number' || !Number.isFinite(b.height)) return null;
  return { target: b.target, url: b.url, selector: b.selector, width: clamp(b.width, 100, 4000), height: clamp(b.height, 100, 4000) };
}

function validatePick(value: unknown): PickInput | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (typeof p.selector !== 'string' || !p.selector) return null;
  if (typeof p.url !== 'string') return null;
  if (typeof p.tag !== 'string') return null;

  const rect = p.rect as Record<string, unknown> | undefined;
  if (!rect || !['x', 'y', 'width', 'height'].every((k) => typeof rect[k] === 'number')) return null;
  const viewport = p.viewport as Record<string, unknown> | undefined;
  if (!viewport || typeof viewport.width !== 'number' || typeof viewport.height !== 'number') return null;

  return {
    selector: p.selector,
    url: p.url,
    tag: p.tag,
    text: typeof p.text === 'string' ? truncate(p.text, 200) : undefined,
    outerHTML: typeof p.outerHTML === 'string' ? truncate(p.outerHTML, 4000) : undefined,
    parentHTML: typeof p.parentHTML === 'string' ? truncate(p.parentHTML, 1500) : undefined,
    styles: p.styles && typeof p.styles === 'object' ? (p.styles as Record<string, string>) : undefined,
    source: typeof p.source === 'string' ? p.source : null,
    rect: { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number },
    viewport: { width: viewport.width as number, height: viewport.height as number },
    screenshot: typeof p.screenshot === 'string' ? p.screenshot : undefined,
  };
}

/** True if `filePath` resolves inside `dir` (both must already exist on disk). */
function isInsideDir(filePath: string, dir: string): boolean {
  try {
    const realDir = realpathSync(dir);
    const realFile = realpathSync(filePath);
    return realFile === realDir || realFile.startsWith(realDir + path.sep);
  } catch {
    return false;
  }
}

export function createPreviewRouter(deps: PreviewRouterDeps): Router {
  const router = Router();

  router.get('/preview/status', (_req, res) => {
    res.json({ port: getPreviewPort(), screenshots: !!process.env.WORKSHOP_SCREENSHOT_URL });
  });

  router.post('/sessions/:id/preview/shot', async (req, res) => {
    const sessionId = req.params.id as SessionId;
    if (!deps.sessions.findById(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const screenshotUrl = process.env.WORKSHOP_SCREENSHOT_URL;
    if (!screenshotUrl) {
      res.status(503).json({ error: 'Screenshot sidecar is not configured' });
      return;
    }

    const input = validateShotBody(req.body);
    if (!input) {
      res.status(400).json({ error: 'target, url, selector, width, and height are required' });
      return;
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${screenshotUrl}/shot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: input.target,
          path: input.url,
          selector: input.selector,
          width: input.width,
          height: input.height,
          token: ensureAuthToken(),
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      res.status(502).json({ error: `Screenshot sidecar unreachable: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    if (!upstream.ok) {
      res.status(502).json({ error: (await upstream.text()) || 'Screenshot sidecar returned an error' });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const dir = designPicksDir(sessionId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.png`);
    writeFileSync(file, buf);

    res.json({ file, dataUrl: `data:image/png;base64,${buf.toString('base64')}` });
  });

  router.post('/sessions/:id/preview/send', async (req, res) => {
    const sessionId = req.params.id as SessionId;
    if (!deps.sessions.findById(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const target = typeof req.body?.target === 'string' ? req.body.target : '';
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const rawPicks: unknown[] | null = Array.isArray(req.body?.picks) ? req.body.picks : null;
    if (!target || !rawPicks || rawPicks.length < 1 || rawPicks.length > 10) {
      res.status(400).json({ error: 'target and 1-10 picks are required' });
      return;
    }

    const picks: PickInput[] = [];
    for (const raw of rawPicks) {
      const pick = validatePick(raw);
      if (!pick) {
        res.status(400).json({ error: 'Each pick requires selector, url, tag, rect, and viewport' });
        return;
      }
      picks.push(pick);
    }

    const dir = designPicksDir(sessionId);
    for (const pick of picks) {
      if (pick.screenshot !== undefined && !isInsideDir(pick.screenshot, dir)) {
        res.status(400).json({ error: `Screenshot path outside session directory: ${pick.screenshot}` });
        return;
      }
    }

    const markdown = buildPicksMarkdown(target, picks, note);
    mkdirSync(dir, { recursive: true });
    const mdPath = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    writeFileSync(mdPath, markdown, 'utf-8');

    const message = `${note.trim() || 'Fix the UI elements I picked.'}\n\nDesign Mode picks (HTML, computed styles, screenshots): ${mdPath}`;
    const sent = await deps.terminal.sendInput(sessionId, message);
    if (!sent) {
      res.status(409).json({ error: 'Session is not running' });
      return;
    }

    res.json({ ok: true, file: mdPath });
  });

  return router;
}
