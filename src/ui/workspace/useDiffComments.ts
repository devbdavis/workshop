import { useCallback, useEffect, useState } from 'react';

export interface DiffComment {
  id: string;
  sessionId: string;
  file: string;
  line: number;
  side: 'RIGHT';
  lineText: string;
  body: string;
  codeContext?: string;
  anchored: boolean;
  status: 'open' | 'resolved';
  sentAt?: string;
  createdAt: string;
}

async function readErrorMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
}

/** Fetches and mutates diff comments for a session; every mutation refetches the list. */
export function useDiffComments(sessionId: string) {
  const [comments, setComments] = useState<DiffComment[] | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/diff-comments`);
    setComments((await res.json()) as DiffComment[]);
  }, [sessionId]);

  useEffect(() => { void refetch(); }, [refetch]);

  const create = useCallback(async (file: string, line: number, body: string): Promise<void> => {
    const res = await fetch(`/api/sessions/${sessionId}/diff-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, line, body }),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    await refetch();
  }, [sessionId, refetch]);

  const update = useCallback(async (id: string, patch: { body?: string; status?: 'open' | 'resolved' }): Promise<void> => {
    const res = await fetch(`/api/diff-comments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    await refetch();
  }, [refetch]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await fetch(`/api/diff-comments/${id}`, { method: 'DELETE' });
    await refetch();
  }, [refetch]);

  const send = useCallback(async (): Promise<number> => {
    const res = await fetch(`/api/sessions/${sessionId}/diff-comments/send`, { method: 'POST' });
    if (!res.ok) throw new Error(await readErrorMessage(res));
    const data = (await res.json()) as { sent: number };
    await refetch();
    return data.sent;
  }, [sessionId, refetch]);

  return { comments, refetch, create, update, remove, send };
}
