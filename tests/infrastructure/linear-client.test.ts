import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LinearApiError,
  getIssueByIdentifier,
  listAssignedOpenIssues,
  type LinearIssue,
} from '@infrastructure/linear/client';

function mkIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: overrides.id ?? 'id-' + Math.random(),
    identifier: overrides.identifier ?? 'ASY-1',
    title: overrides.title ?? 'Title',
    description: overrides.description ?? null,
    url: overrides.url ?? 'https://linear.app/x/issue/ASY-1',
    priority: overrides.priority ?? 0,
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    state: overrides.state ?? { name: 'Todo', type: 'unstarted' },
    project: overrides.project ?? null,
  };
}

describe('Linear client', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listAssignedOpenIssues filters out completed and canceled issues', async () => {
    const issues = [
      mkIssue({ identifier: 'A-1', state: { name: 'Todo', type: 'unstarted' } }),
      mkIssue({ identifier: 'A-2', state: { name: 'In Progress', type: 'started' } }),
      mkIssue({ identifier: 'A-3', state: { name: 'Done', type: 'completed' } }),
      mkIssue({ identifier: 'A-4', state: { name: 'Canceled', type: 'canceled' } }),
      mkIssue({ identifier: 'A-5', state: { name: 'Backlog', type: 'backlog' } }),
    ];

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: { nodes: issues, pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      }),
    });

    const result = await listAssignedOpenIssues('lin_test_key');
    expect(result.map((r) => r.identifier).sort()).toEqual(['A-1', 'A-2', 'A-5']);

    // Verify Authorization header was passed without a "Bearer " prefix (Linear personal keys)
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe('https://api.linear.app/graphql');
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'lin_test_key' }),
    });
  });

  it('listAssignedOpenIssues paginates until hasNextPage is false', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            viewer: {
              assignedIssues: {
                nodes: [mkIssue({ identifier: 'P-1' })],
                pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            viewer: {
              assignedIssues: {
                nodes: [mkIssue({ identifier: 'P-2' })],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      });

    const result = await listAssignedOpenIssues('key');
    expect(result.map((r) => r.identifier)).toEqual(['P-1', 'P-2']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second call must pass the cursor in the variables.
    const secondCallBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(secondCallBody.variables).toEqual({ after: 'cursor-1' });
  });

  it('throws LinearApiError with 401 on an unauthorized response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid key',
    });

    const err = await listAssignedOpenIssues('bad').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinearApiError);
    expect((err as LinearApiError).status).toBe(401);
  });

  it('getIssueByIdentifier returns null when the issue is not found', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { issues: { nodes: [] } } }),
    });

    const result = await getIssueByIdentifier('key', 'ASY-999');
    expect(result).toBeNull();
  });

  it('getIssueByIdentifier returns the first matching node', async () => {
    const issue = mkIssue({ identifier: 'ASY-42', title: 'Hello' });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { issues: { nodes: [issue] } } }),
    });

    const result = await getIssueByIdentifier('key', 'ASY-42');
    expect(result?.title).toBe('Hello');
  });

  it('surfaces GraphQL errors as LinearApiError', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'bad field' }] }),
    });

    await expect(listAssignedOpenIssues('key')).rejects.toBeInstanceOf(LinearApiError);
  });
});
