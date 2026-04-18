/**
 * Minimal Linear GraphQL client for the ticket-import feature.
 *
 * Uses a Personal API Key (header `Authorization: <key>`) rather than OAuth;
 * this keeps the single-user local tool trivial to configure from the Settings UI.
 * See https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 */

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string };
  project: { name: string } | null;
}

export class LinearApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LinearApiError';
    this.status = status;
  }
}

/**
 * Fields we pull for both listing and single-issue lookup. Kept small — the
 * import UI only needs title/description/state/project to present a row.
 */
const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priority
  updatedAt
  state { name type }
  project { name }
`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function graphql<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LinearApiError(
      `Linear API request failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      res.status,
    );
  }

  const payload = (await res.json()) as GraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new LinearApiError(
      `Linear API returned errors: ${payload.errors.map((e) => e.message).join('; ')}`,
      res.status,
    );
  }
  if (!payload.data) {
    throw new LinearApiError('Linear API returned no data', res.status);
  }
  return payload.data;
}

interface ViewerIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: LinearIssue[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

const CLOSED_STATE_TYPES = new Set(['completed', 'canceled']);

/**
 * List issues assigned to the authenticated viewer across every project,
 * excluding closed states ("completed" and "canceled" per Linear's state types).
 * Paginates until exhausted; capped defensively at 10 pages of 50 so a
 * misconfigured account can't spin forever.
 *
 * State filtering is done client-side. Linear's filter DSL would let us push it
 * server-side, but the filter syntax varies across schema versions — doing it
 * here keeps the query compatible with older Linear API shapes.
 */
export async function listAssignedOpenIssues(apiKey: string): Promise<LinearIssue[]> {
  const query = `
    query AssignedOpenIssues($after: String) {
      viewer {
        assignedIssues(first: 50, after: $after) {
          nodes { ${ISSUE_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  const all: LinearIssue[] = [];
  let after: string | null = null;
  for (let i = 0; i < 10; i++) {
    const data: ViewerIssuesResponse = await graphql<ViewerIssuesResponse>(apiKey, query, { after });
    const { nodes, pageInfo } = data.viewer.assignedIssues;
    all.push(...nodes);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return all.filter((issue) => !CLOSED_STATE_TYPES.has(issue.state.type));
}

interface IssueByIdentifierResponse {
  issues: { nodes: LinearIssue[] };
}

/**
 * Parse a Linear identifier like "ASY-1402" into its team key and issue number.
 * Returns null for strings that don't match the expected shape.
 */
function parseIdentifier(identifier: string): { teamKey: string; number: number } | null {
  const match = identifier.trim().match(/^([A-Z0-9]+)-(\d+)$/i);
  if (!match) return null;
  const number = Number.parseInt(match[2], 10);
  if (!Number.isFinite(number)) return null;
  return { teamKey: match[1].toUpperCase(), number };
}

/**
 * Look up a single issue by its identifier ("ASY-1402"). Returns null if the
 * identifier can't be parsed or the issue isn't visible to the API key
 * (private team, wrong key, etc.) — the caller falls back to cached data.
 *
 * Linear's `IssueFilter` has no top-level `identifier` field; the supported
 * path is to filter by team key + issue number, which uniquely identifies an
 * issue within the workspace.
 */
export async function getIssueByIdentifier(apiKey: string, identifier: string): Promise<LinearIssue | null> {
  const parsed = parseIdentifier(identifier);
  if (!parsed) return null;

  const query = `
    query IssueByIdentifier($teamKey: String!, $number: Float!) {
      issues(
        filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } },
        first: 1
      ) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `;
  const data = await graphql<IssueByIdentifierResponse>(apiKey, query, {
    teamKey: parsed.teamKey,
    number: parsed.number,
  });
  return data.issues.nodes[0] ?? null;
}
