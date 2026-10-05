export type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; hint: string | null; input: string; result: string | null; isError: boolean };

export interface TranscriptMessage {
  /** JSONL line uuid — a stable React key as the live tail window slides. */
  id: string | null;
  role: 'user' | 'assistant';
  blocks: TranscriptBlock[];
  timestamp: string | null;
}

type ToolBlock = Extract<TranscriptBlock, { type: 'tool' }>;

// Tool inputs/results can be whole files; the view only needs enough to recognise what happened.
const MAX_DETAIL_CHARS = 4000;
const HINT_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clip(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}\n… (${text.length - MAX_DETAIL_CHARS} more chars)` : text;
}

function toolHint(input: Record<string, unknown> | null): string | null {
  for (const key of HINT_KEYS) {
    const value = input?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().split('\n')[0].slice(0, 160);
  }
  return null;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((raw) => {
      const block = asRecord(raw);
      if (block?.type === 'text' && typeof block.text === 'string') return block.text;
      return block?.type === 'image' ? '[image]' : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Turns raw JSONL entries into renderable messages. tool_result blocks are folded into their
 *  tool_use; thinking, meta and tool-result-only user turns produce nothing of their own. */
export function toTranscript(lines: unknown[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const toolsById = new Map<string, ToolBlock>();

  for (const raw of lines) {
    const entry = asRecord(raw);
    if (!entry || (entry.type !== 'user' && entry.type !== 'assistant') || entry.isMeta === true) continue;
    const content = asRecord(entry.message)?.content;
    const blocks: TranscriptBlock[] = [];

    if (typeof content === 'string') {
      if (content.trim()) blocks.push({ type: 'text', text: content.trim() });
    } else if (Array.isArray(content)) {
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (!block) continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          blocks.push({ type: 'text', text: block.text.trim() });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const input = asRecord(block.input);
          const tool: ToolBlock = {
            type: 'tool',
            name: block.name,
            hint: toolHint(input),
            input: clip(JSON.stringify(block.input ?? {}, null, 2)),
            result: null,
            isError: false,
          };
          if (typeof block.id === 'string') toolsById.set(block.id, tool);
          blocks.push(tool);
        } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const tool = toolsById.get(block.tool_use_id);
          if (tool) {
            tool.result = clip(resultText(block.content));
            tool.isError = block.is_error === true;
          }
        }
      }
    }

    if (blocks.length === 0) continue;
    messages.push({
      id: typeof entry.uuid === 'string' ? entry.uuid : null,
      role: entry.type,
      blocks,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    });
  }
  return messages;
}
