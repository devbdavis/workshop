# Discussion System

## What We're Building

Today, when multiple AI agents work on related problems — or when a human wants structured input from several AI perspectives before making a decision — there's no good way to make that happen. You can run agents in parallel, but they can't talk to each other. You can copy-paste between sessions, but that's manual and lossy. The closest analog in human workflows is an RFC process or a pull request review, where someone proposes something, others weigh in, and the group converges on an outcome before anyone acts on it.

We're building that for Workshop: a structured discussion system where AI agents and humans can collaboratively reason about a topic in a threaded conversation, reach consensus, and then move on. Think of it as a lightweight deliberation layer that sits alongside Workshop's existing track/session/todo infrastructure.

This is not a chat room. It's closer to a review thread with a defined lifecycle — someone opens a discussion, participants weigh in, and the discussion closes when the group agrees (or a human calls it). The key difference from existing multi-agent frameworks (AutoGen, CrewAI, etc.) is that this is model-agnostic, asynchronous, and protocol-driven rather than orchestrator-driven. Each agent is a fully independent process with its own tmux session, and the only shared state is the discussion thread in the database.

## Why This Design

**The problem with shared context**: If you put multiple agents in one conversation, context windows fill up fast, and you can't mix model providers. By giving each agent its own session scoped to a single discussion, we get natural context isolation, provider independence, and clean lifecycle management.

**The problem with orchestration**: Most multi-agent systems have a central coordinator that decides who speaks when. That's brittle and limits agent autonomy. Instead, we use a poll-and-poke model — a background process periodically checks if there's something new for an agent to see, and nudges it. The agent decides what to say (or whether to say anything at all).

**The problem with open-ended conversation**: Without structure, agents will happily talk forever. The RFC lifecycle (propose → discuss → vote → close) gives conversations a natural arc. The governance prompt teaches agents to be concise, to converge, and to signal when they're satisfied rather than restating what's already been said.

## Design Principles

- **Agents are participants, not subordinates.** They get the same tools humans get. A human posting a comment or casting a vote uses the same API endpoint as an agent calling an MCP tool.
- **Discussions are self-contained.** Each discussion is its own world — a thread with a defined topic, a set of participants, and a clear end condition. No cross-contamination between discussions.
- **Reuse what exists.** Discussion teams reference Workshop's existing agent definitions (from `~/.claude/agents/`, project agents, or Workshop DB agents). Sessions use the existing terminal manager and tmux infrastructure. The poller follows the same internal-interval pattern as session sync.
- **Global with optional track binding.** Discussions are top-level entities, not tied to a track. But a discussion *can* reference a track, which gives participating agents extra context (track context, latest summary) in their system prompt.
- **Consensus is explicit.** Agents don't just discuss — they vote. The discussion closes when the configured consensus rule is satisfied (unanimous, majority, quorum). This prevents endless back-and-forth and gives a clear signal to act on the outcome.

## How It Looks in Practice

### Scenario: Human kicks off an architecture review

A developer is considering two approaches for a new feature. They open the Workshop Discussions page, select their "Architecture Review" team (which includes the `simplify` agent, the `go-backend-specialist` agent, and the `ux-design-expert` agent), and create an RFC:

> **Title**: API pagination strategy — cursor vs offset
>
> **Artifact**: *(pastes the two approaches with pros/cons)*

Workshop creates the discussion and spawns three agent sessions — one per team member. Each session gets the agent's personality/expertise as its base system prompt, plus the discussion governance rules, plus the discussion MCP tools.

Each agent receives an initial prompt telling it a new discussion has been opened. They each call `workshop_discussion_read`, see the proposal, and post their perspective. The `simplify` agent argues for cursor-based because it's simpler. The `go-backend-specialist` agrees but flags a concern about the existing codebase. The `ux-design-expert` asks whether infinite scroll is a requirement.

The developer sees all of this in the Discussion thread UI in real time. They post a reply clarifying the UX requirements. Within a minute, the poller nudges the agents again. They see the clarification, two vote "satisfied", the third posts one more suggestion and then also votes "satisfied". Consensus (unanimous) is reached. Workshop auto-closes the discussion and kills the three agent sessions.

The developer now has a clean thread documenting the decision, the reasoning, and the dissenting points — all in one place.

### Scenario: Agent initiates a discussion

An agent working on an implementation task hits a design question it can't resolve alone. It calls `workshop_discussion_create` via MCP, opening a question-type discussion in the "Architecture Review" team. The same lifecycle kicks in — other agents get sessions, weigh in, and the group converges. The originating agent reads the outcome and continues its work.

### Scenario: Quick sanity check

A human wants a fast gut-check on a config change from two agents. They create a discussion with a two-member team and a `majority` consensus rule (threshold: 0.5 — so one "satisfied" is enough). Both agents get their initial prompt immediately on session creation. One approves within seconds. Consensus met, discussion closes. If the first agent doesn't respond to the initial prompt, the poller nudges within 60 seconds.

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| One session per (agent x discussion) | Yes | Bounded context, clean teardown, no cross-talk |
| Agent identity | Self-declared via MCP params | Local system, no auth needed, agents pass their name when posting |
| Transport | MCP tools over HTTP | Model-agnostic, structured I/O, already have the infra |
| Poller vs push | Internal `setInterval` poller | Simpler than webhooks, agents don't need to be addressable |
| Consensus | Configurable per team | Different team compositions need different rules |
| Discussion scope | Global, optional track binding | Flexibility — some discussions are cross-cutting |
| Agent definitions | Reference existing (`global:`, `project:`, DB) | No duplication, reuse personalities already defined |
| Session cleanup | Automatic on consensus | No orphaned sessions, context doesn't rot |

---

## Implementation

### Phase 1: Foundation + Domain Layer

### 1.1 Branded IDs and Entity Types

**New file: `src/foundation/discussion-types.ts`**

Discussion types go in a separate file to keep `types.ts` (already 478 lines) from growing further past the 300-line convention. The main `types.ts` gets `SessionProvider` extended and a re-export of the discussion types.

Add new branded ID types:

```typescript
export type DiscussionTeamId = string & { readonly __brand: 'DiscussionTeamId' };
export type DiscussionId = string & { readonly __brand: 'DiscussionId' };
export type DiscussionMessageId = string & { readonly __brand: 'DiscussionMessageId' };
```

Extend `SessionProvider`:

```typescript
export type SessionProvider = 'claude' | 'codex' | 'gemini';
```

Add entity interfaces:

```typescript
// Consensus rules
export type ConsensusRule =
  | { type: 'unanimous' }
  | { type: 'majority'; threshold: number }   // uses >= comparison
  | { type: 'quorum'; minVotes: number };      // at least N votes, majority satisfied

// Discussion Team
export interface DiscussionTeam {
  id: DiscussionTeamId;
  name: string;
  description?: string;
  consensusRule: ConsensusRule;
  memberAgentIds: AgentId[];
  createdAt: string;
  updatedAt: string;
}

// Discussion
export type DiscussionType = 'rfc' | 'question' | 'review';
export type DiscussionStatus = 'open' | 'consensus' | 'closed' | 'stale' | 'failed';

export interface Discussion {
  id: DiscussionId;
  teamId: DiscussionTeamId;
  title: string;
  type: DiscussionType;
  status: DiscussionStatus;
  artifact?: string;
  trackId?: TrackId;              // optional track binding
  createdByType: 'agent' | 'human';
  createdById?: string;
  /** Participants locked at discussion creation — defines the consensus denominator */
  participantIds: string[];       // agent IDs + human IDs who are part of this discussion
  /** Minutes of inactivity before auto-closing as 'stale'. 0 = never. */
  staleAfterMinutes: number;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;         // updated on each message/vote, used for stale detection
}

// Discussion Message
export type DiscussionMessageType =
  | 'proposal'
  | 'comment'
  | 'suggestion'
  | 'objection'
  | 'revision'
  | 'satisfied'
  | 'unsatisfied';

export interface DiscussionMessage {
  id: DiscussionMessageId;
  discussionId: DiscussionId;
  authorType: 'agent' | 'human';
  authorId?: string;
  authorName?: string;            // display name at time of posting
  messageType: DiscussionMessageType;
  content: string;
  createdAt: string;
}

// Discussion Vote
export type DiscussionVoteValue = 'satisfied' | 'unsatisfied' | 'abstain';

export interface DiscussionVote {
  discussionId: DiscussionId;
  voterType: 'agent' | 'human';
  voterId: string;
  voterName?: string;
  vote: DiscussionVoteValue;
  comment?: string;
  createdAt: string;
}

// Discussion Session (join: agent x discussion → tmux session)
export interface DiscussionSession {
  discussionId: DiscussionId;
  agentId: AgentId;
  sessionId: SessionId;
  lastSeenMessageId?: DiscussionMessageId;
  createdAt: string;
}
```

### 1.2 Domain Repository Interface

**New file: `src/domain/discussion/repository.ts`**

```typescript
export interface DiscussionTeamRepository {
  findAll(): DiscussionTeam[];
  findById(id: DiscussionTeamId): DiscussionTeam | null;
  create(data: Omit<DiscussionTeam, 'id' | 'createdAt' | 'updatedAt'>): DiscussionTeam;
  update(id: DiscussionTeamId, data: Partial<Pick<DiscussionTeam, 'name' | 'description' | 'consensusRule' | 'memberAgentIds'>>): DiscussionTeam | null;
  delete(id: DiscussionTeamId): boolean;
}

export interface DiscussionRepository {
  findAll(filters?: { status?: DiscussionStatus; teamId?: DiscussionTeamId; trackId?: TrackId }): Discussion[];
  findById(id: DiscussionId): Discussion | null;
  create(data: Omit<Discussion, 'id' | 'createdAt' | 'updatedAt'>): Discussion;
  updateStatus(id: DiscussionId, status: DiscussionStatus): Discussion | null;
  update(id: DiscussionId, data: Partial<Pick<Discussion, 'title' | 'artifact' | 'trackId'>>): Discussion | null;
}

export interface DiscussionMessageRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionMessage[];
  findById(id: DiscussionMessageId): DiscussionMessage | null;
  findAfter(discussionId: DiscussionId, afterRowid: number): DiscussionMessage[];
  create(data: Omit<DiscussionMessage, 'id' | 'createdAt'>): DiscussionMessage;
  countByDiscussion(discussionId: DiscussionId): number;
  latestRowid(discussionId: DiscussionId): number | null;
}

export interface DiscussionVoteRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionVote[];
  upsert(vote: DiscussionVote): DiscussionVote;       // insert or update
  findByVoter(discussionId: DiscussionId, voterType: string, voterId: string): DiscussionVote | null;
}

export interface DiscussionSessionRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionSession[];
  findByAgent(agentId: AgentId): DiscussionSession[];
  create(data: DiscussionSession): DiscussionSession;
  updateLastSeen(discussionId: DiscussionId, agentId: AgentId, messageId: DiscussionMessageId): void;
  deleteByDiscussion(discussionId: DiscussionId): void;
  findWithUnread(): Array<DiscussionSession & { unreadCount: number; discussionTitle: string }>;
}
```

---

## Phase 2: Infrastructure — SQLite Persistence

### 2.1 Database Migration

**File: `src/infrastructure/persistence/database.ts`**

Add to `runMigrations()`:

```sql
CREATE TABLE IF NOT EXISTS discussion_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  consensus_rule TEXT NOT NULL,          -- JSON: ConsensusRule
  member_agent_ids TEXT NOT NULL,        -- JSON: AgentId[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES discussion_teams(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rfc',
  status TEXT NOT NULL DEFAULT 'open',   -- open, consensus, closed, stale, failed
  artifact TEXT,
  track_id TEXT,
  created_by_type TEXT NOT NULL,
  created_by_id TEXT,
  participant_ids TEXT NOT NULL,          -- JSON: string[] — locked at creation, defines consensus denominator
  stale_after_minutes INTEGER NOT NULL DEFAULT 0,  -- 0 = never auto-stale
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discussion_messages (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_messages_discussion
  ON discussion_messages(discussion_id, created_at);

CREATE TABLE IF NOT EXISTS discussion_votes (
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  voter_type TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  voter_name TEXT,
  vote TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (discussion_id, voter_type, voter_id)
);

CREATE TABLE IF NOT EXISTS discussion_sessions (
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  last_seen_message_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (discussion_id, agent_id)
);
```

### 2.2 Repository Implementation

**New file: `src/infrastructure/persistence/discussion-team-repository.ts`**

Standard prepared-statement repository following existing pattern (see `agent-repository.ts`). JSON encode/decode for `consensus_rule` and `member_agent_ids`.

**New file: `src/infrastructure/persistence/discussion-repository.ts`**

CRUD for discussions. The `findAll` method supports filtering by status, teamId, trackId.

**New file: `src/infrastructure/persistence/discussion-message-repository.ts`**

CRUD for messages. Key query: `findAfter(discussionId, afterMessageId)` — used by the poller to detect unseen messages.

**New file: `src/infrastructure/persistence/discussion-vote-repository.ts`**

Upsert pattern for votes (agents can change their vote).

**New file: `src/infrastructure/persistence/discussion-session-repository.ts`**

Join table management. Key query: `findWithUnread()` — joins `discussion_sessions` with `discussion_messages` to find sessions where `last_seen_message_id` is behind the latest message, and the unseen messages were not authored by this agent.

```sql
SELECT ds.*, d.title as discussion_title, unread.cnt as unread_count
FROM discussion_sessions ds
JOIN discussions d ON d.id = ds.discussion_id
JOIN (
  SELECT dm.discussion_id, ds2.agent_id, COUNT(*) as cnt
  FROM discussion_messages dm
  JOIN discussion_sessions ds2 ON ds2.discussion_id = dm.discussion_id
  WHERE dm.author_id != ds2.agent_id
    AND (ds2.last_seen_message_id IS NULL
         OR dm.rowid > (SELECT rowid FROM discussion_messages WHERE id = ds2.last_seen_message_id))
  GROUP BY dm.discussion_id, ds2.agent_id
) unread ON unread.discussion_id = ds.discussion_id AND unread.agent_id = ds.agent_id
WHERE d.status = 'open'
```

Note: Uses `rowid` for ordering instead of timestamp comparison — avoids issues with same-millisecond inserts.

---

## Phase 3: Application Layer — Discussion Service

### 3.1 Discussion Service

**New file: `src/application/discussion/discussion-service.ts`**

Orchestrates the full lifecycle. Dependencies:

```typescript
export interface DiscussionServiceDeps {
  teams: DiscussionTeamRepository;
  discussions: DiscussionRepository;
  messages: DiscussionMessageRepository;
  votes: DiscussionVoteRepository;
  discussionSessions: DiscussionSessionRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  terminal: TerminalManager;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  sessions: SessionRepository;
  projectRoot: string;
  broadcast: (type: string, id: string) => void;
}
```

Key methods:

```typescript
export interface DiscussionService {
  // Team management
  createTeam(data: CreateTeamInput): DiscussionTeam;
  updateTeam(id: DiscussionTeamId, data: UpdateTeamInput): DiscussionTeam | null;
  deleteTeam(id: DiscussionTeamId): boolean;

  // Discussion lifecycle
  createDiscussion(data: CreateDiscussionInput): Promise<Discussion>;
  // ^ Creates discussion row, spawns agent sessions, posts initial proposal message

  postMessage(discussionId: DiscussionId, data: PostMessageInput): DiscussionMessage;
  // ^ Creates message row, broadcasts update

  castVote(discussionId: DiscussionId, data: CastVoteInput): DiscussionVote;
  // ^ Upserts vote, checks consensus, auto-closes if met

  closeDiscussion(discussionId: DiscussionId): Promise<void>;
  // ^ Sets status to 'closed', destroys all agent sessions

  getDiscussionState(discussionId: DiscussionId): DiscussionState;
  // ^ Returns discussion + messages + votes + consensus check result
}
```

### 3.2 Session Spawning Logic (inside `createDiscussion`)

Discussion agent sessions are spawned as **interactive** sessions (not `background: true`). Each agent CLI (Claude, Codex, Gemini) runs in interactive mode in its tmux pane, sitting at a prompt waiting for input. The poller nudges them by typing text into the tmux session via `send-keys` — this is the standard tmux workflow and works reliably when the CLI is at its input prompt.

Why interactive, not background: Background sessions use one-shot execution modes (e.g. Codex's `exec --full-auto`) which exit after the initial prompt completes. Discussion agents need to be long-lived — they receive multiple pokes over the lifetime of a discussion. Interactive mode keeps the CLI process alive and waiting for input between rounds.

```
1. Resolve team → get memberAgentIds
2. Get or create "_Discussions" system track (like "_Scheduled Tasks" pattern)
3. Lock participant list: team.memberAgentIds → discussion.participantIds
4. For each agent in team:
   a. Resolve agent: agents.findById(id) || filesystemScanner.findById(id, projectRoot)
   b. Compose system prompt using shared prompt composition utility (see 3.5):
      - Agent's base systemPrompt
      - If discussion has trackId: full track context (context, summary, vault, template interpolation)
      - GOVERNANCE_PROMPT (see 3.4)
   c. Determine provider: resolveProvider(agent) (see Phase 7)
   d. terminal.createSession(discussionsTrackId, {
        systemPrompt,
        provider,
        background: false,            // interactive — agent sits at prompt between pokes
        initialPrompt: `A new discussion "${title}" has been opened. Use workshop_discussion_read to review the proposal and share your perspective.`,
      })
   e. Store DiscussionSession(discussionId, agentId, sessionId)
5. If any session fails to spawn:
   - Log the failure
   - Continue spawning remaining agents (partial participation is acceptable)
   - If ALL fail, set discussion status to 'failed'
   - Broadcast 'discussion:created' with participant count so UI shows which agents joined
```

### 3.3 Consensus Checking Logic (inside `castVote`)

The participant list is `discussion.participantIds`, locked at creation time. This is the denominator — it never changes during the discussion. Abstentions count as "voted" but not as "satisfied" or "unsatisfied".

```
1. Get all votes for this discussion
2. Get discussion.participantIds (fixed denominator)
3. Apply consensus rule:
   - unanimous: every participant has voted AND all votes are 'satisfied'
     (abstentions block unanimity — you must explicitly satisfy)
   - majority: count(satisfied) / count(participantIds) >= threshold
     (abstentions count against — they lower the satisfied ratio)
   - quorum: count(votes cast) >= minVotes AND count(satisfied) > count(unsatisfied)
     (abstentions count toward quorum but not toward satisfied majority)
4. If consensus met:
   - updateStatus(discussionId, 'consensus')
   - closeDiscussion(discussionId)  // kills agent sessions
   - broadcast('discussion:consensus', discussionId)
5. If NOT met but all participants have voted and none are satisfied:
   - This is a deadlock — leave open, human can manually close or adjust
```

### 3.3.1 Stale Discussion Detection (inside poller)

```
1. For each open discussion where staleAfterMinutes > 0:
   - If now - lastActivityAt > staleAfterMinutes:
     - updateStatus(discussionId, 'stale')
     - closeDiscussion(discussionId)  // kills agent sessions
     - broadcast('discussion:closed', discussionId)
```

### 3.3.2 Dead Session Handling

The existing 30-second session sync deletes dead tmux sessions and cascades to `discussion_sessions` (via `ON DELETE CASCADE`). The poller should handle this gracefully:

```
1. When poking an agent, first check if the session still exists in the sessions table
2. If not (cascade already removed it), skip this agent
3. If all agent sessions for a discussion are dead and consensus is not met:
   - The discussion remains open — a human can manually close it
   - The UI should show which participants are still active vs. disconnected
```

### 3.4 Governance Prompt

**New file: `src/application/discussion/governance-prompt.ts`**

```typescript
export function buildGovernancePrompt(discussion: Discussion, agentId: string, agentName: string): string {
  return `
## Discussion Protocol

You are "${agentName}", participating in a structured discussion via Workshop.

**Your identity for MCP tool calls:**
- Agent ID: \`${agentId}\` (use this as authorId/voterId in all tool calls)
- Display name: \`${agentName}\`

### Discussion: "${discussion.title}" (ID: ${discussion.id})
Type: ${discussion.type} | Status: ${discussion.status}

### MCP Tools Available
- \`workshop_discussion_read\` — Read the current thread (call this FIRST)
- \`workshop_discussion_post\` — Post your response (pass your authorId and authorName)
- \`workshop_discussion_vote\` — Signal satisfaction or request changes (pass your voterId and voterName)

### Rules
1. **Read first.** Always call workshop_discussion_read before responding.
2. **Be concise.** One substantive point per message. No preamble or filler.
3. **Don't restate.** If someone already made your point, just vote.
4. **Signal clearly.** Use message type "satisfied" when you agree, "objection" when you have blocking concerns, "suggestion" for non-blocking improvements.
5. **Vote when ready.** Call workshop_discussion_vote with "satisfied" when the outcome is acceptable, "unsatisfied" when you have blocking concerns remaining.
6. **Converge.** Good-enough beats perfect. If remaining concerns are minor, vote satisfied and note them as non-blocking.
7. **One response per prompt.** Read, respond, vote if ready, then stop. Do not loop or keep checking.
8. **Never reopen closed discussions.** Once consensus is reached, it's final.
9. **Stay on topic.** Only discuss the subject of this thread.
`.trim();
}
```

### 3.5 Shared Prompt Composition

**Refactor**: Extract the system prompt composition logic from `task-scheduler.ts` (`composeSystemPrompt`, lines 121-163) into a shared utility at `src/application/shared/prompt-composition.ts`. Both the task scheduler and the discussion service should use it. This ensures discussion agents get the same level of context as any other Workshop session: agent system prompt, track context, latest summary, vault memory, and interpolated prompt templates.

The discussion service appends the governance prompt (3.4) after the shared composition.

---

## Phase 4: MCP Tools

### 4.1 Discussion MCP Tools

**New file: `src/mcp/discussion-tools.ts`**

Following the pattern in `scheduled-task-tools.ts`:

```typescript
export function registerDiscussionTools(
  server: McpServer,
  api: (path: string, options?: RequestInit) => Promise<any>,
): void { ... }
```

Tools to register:

| Tool | Description | Parameters |
|------|-------------|------------|
| `workshop_discussion_list` | List discussions, optionally filtered | `status?`, `teamId?`, `trackId?` |
| `workshop_discussion_read` | Read full thread (messages + votes + status) | `discussionId` |
| `workshop_discussion_post` | Post a message to a discussion | `discussionId`, `authorId`, `authorName`, `messageType`, `content` |
| `workshop_discussion_vote` | Cast or update your vote | `discussionId`, `voterId`, `voterName`, `vote`, `comment?` |
| `workshop_discussion_create` | Start a new discussion | `teamId`, `title`, `type?`, `artifact?`, `trackId?`, `staleAfterMinutes?` |
| `workshop_discussion_status` | Check consensus state + vote tally | `discussionId` |

**Identity binding**: Agents pass their `authorId` (their `AgentId` from the governance prompt) and `authorName`. The server validates that `authorId` is a participant in the discussion (exists in `discussion.participantIds`). This prevents accidental impersonation — the agent is told its ID in the governance prompt and the server rejects posts from non-participants.

```typescript
server.tool('workshop_discussion_post', '...', {
  discussionId: z.string(),
  authorId: z.string().describe('Your agent ID (from the discussion protocol in your system prompt)'),
  authorName: z.string().describe('Your display name'),
  messageType: z.enum(['comment', 'suggestion', 'objection', 'revision', 'satisfied', 'unsatisfied']),
  content: z.string(),
}, async (params) => {
  // Server validates: authorId must be in discussion.participantIds
  ...
});
```

### 4.2 Register in MCP Server

**File: `src/mcp/server.ts`**

Add import and registration call:

```typescript
import { registerDiscussionTools } from './discussion-tools.js';
// ...
registerDiscussionTools(server, api);
```

---

## Phase 5: Server — REST Routes + WebSocket

### 5.1 Discussion Routes

**New file: `src/server/discussion-routes.ts`**

Following the pattern in `scheduled-task-routes.ts`:

```
GET    /api/discussion-teams              — List all teams
POST   /api/discussion-teams              — Create team
PUT    /api/discussion-teams/:id          — Update team
DELETE /api/discussion-teams/:id          — Delete team

GET    /api/discussions                   — List discussions (query: status, teamId, trackId)
GET    /api/discussions/:id               — Get discussion with messages + votes + sessions
POST   /api/discussions                   — Create discussion (triggers agent session spawning)
POST   /api/discussions/:id/messages      — Post a message
POST   /api/discussions/:id/votes         — Cast or update a vote
POST   /api/discussions/:id/close         — Manually close a discussion
DELETE /api/discussions/:id               — Delete a discussion (also kills sessions)
```

### 5.2 Wire into API Router

**File: `src/server/api.ts`**

1. Import and create discussion repositories
2. Create DiscussionService with deps
3. Mount: `router.use(createDiscussionRouter({ discussionService, ... }))`

### 5.3 WebSocket Events

**File: `src/server/events.ts`**

Extend the `EventType` union to include discussion events:

```typescript
type EventType = ... | 'discussion:created' | 'discussion:message' | 'discussion:vote'
  | 'discussion:consensus' | 'discussion:closed';
```

Events:
- `discussion:created` — new discussion opened, sessions spawning
- `discussion:message` — new message posted
- `discussion:vote` — vote cast or changed
- `discussion:consensus` — consensus reached
- `discussion:closed` — discussion closed (consensus, manual, or stale), sessions destroyed

---

## Phase 6: Discussion Poller

### 6.1 Internal Poller

**New file: `src/application/discussion/discussion-poller.ts`**

Not a ScheduledTask (those are user-facing). This is an internal `setInterval` loop, like the existing session sync in `api.ts`. It handles two responsibilities: nudging agents about new messages, and detecting stale discussions.

```typescript
export interface DiscussionPollerDeps {
  discussionSessions: DiscussionSessionRepository;
  discussions: DiscussionRepository;
  messages: DiscussionMessageRepository;
  sessions: SessionRepository;
  discussionService: DiscussionService;  // for closing stale discussions
  broadcast: (type: string, id: string) => void;
}

export interface DiscussionPoller {
  start(intervalMs?: number): void;   // default: 60_000 (60 seconds)
  stop(): void;
  pollNow(): void;                    // manual trigger for testing
}
```

Poll logic:

```
1. Query discussionSessions.findWithUnread()
   → Returns sessions where there are messages newer than lastSeenMessageId
     that were NOT authored by this agent
2. For each result:
   a. Look up the Workshop session from sessions table
   b. If session no longer exists (cascade deleted by session sync), skip
   c. Check if tmux session is alive via terminal manager
   d. If alive, send-keys into the tmux pane:
      tmux send-keys -t {tmuxSession} "There are {unreadCount} new messages in discussion '{title}'. Use workshop_discussion_read to review and respond." Enter
   e. Update lastSeenMessageId to the latest message rowid
      (so we don't poke again for the same messages)
3. Check for stale discussions:
   a. Query open discussions where staleAfterMinutes > 0
      AND now - lastActivityAt > staleAfterMinutes
   b. Close each as 'stale' via discussionService.closeDiscussion()
4. Log poke count + stale count
```

The 60-second default is a reasonable balance — fast enough for interactive discussions, light enough to not burden the system. The query is indexed and only hits open discussions.

### 6.2 Wire into Server Startup

**File: `src/server/api.ts`**

```typescript
const discussionPoller = createDiscussionPoller({
  discussionSessions,
  discussions,
  messages,
  sessions,
  discussionService,
  broadcast,
});
discussionPoller.start(60_000); // 60 seconds

// Clean up on shutdown
process.on('SIGINT', () => { discussionPoller.stop(); });
```

---

## Phase 7: Gemini CLI Support

### 7.1 Terminal Manager Extension

**File: `src/infrastructure/terminal/manager.ts`**

Add `buildGeminiLauncher()` function following the pattern of `buildClaudeLauncher` and `buildCodexLauncher`:

```typescript
function buildGeminiLauncher(
  lines: string[],
  sessionDir: string,
  cwd: string,
  options?: CreateSessionOptions,
): void {
  // Gemini CLI: `gemini` command
  // System prompt: write to file, pass via --system-instruction flag (or equivalent)
  // Initial prompt: pass as positional argument
  const geminiArgs = ['gemini'];
  // ... adapt based on actual Gemini CLI interface
}
```

Update the provider switch in `createSession`:

```typescript
if (provider === 'codex') {
  buildCodexLauncher(launcherLines, sessionDir, cwd, options);
} else if (provider === 'gemini') {
  buildGeminiLauncher(launcherLines, sessionDir, cwd, options);
} else {
  buildClaudeLauncher(launcherLines, session.id, sessionDir, options);
}
```

### 7.2 Agent Model → Provider Mapping

**New file: `src/application/discussion/provider-mapping.ts`**

```typescript
export function resolveProvider(agent: Agent): SessionProvider {
  // Explicit provider field takes precedence (from agent frontmatter or DB)
  if (agent.provider) return agent.provider;

  const model = (agent.model || '').toLowerCase();
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('codex') || model === 'o1' || model === 'o3' || model === 'o4-mini') return 'codex';
  return 'claude';  // default: opus, sonnet, haiku, or unspecified
}
```

**Important**: The terminal manager's provider switch must throw for unknown providers rather than falling through to Claude silently. Add a guard:

```typescript
// In terminal manager createSession:
if (provider === 'codex') {
  buildCodexLauncher(...);
} else if (provider === 'gemini') {
  buildGeminiLauncher(...);
} else if (provider === 'claude') {
  buildClaudeLauncher(...);
} else {
  throw new Error(`Unknown session provider: ${provider}`);
}
```

This prevents silently launching Claude when Gemini was intended (e.g. if Phase 7 is deferred but an agent has `provider: gemini`).

Alternatively, add a `provider` field to the agent frontmatter schema that explicitly declares which CLI to use:

```yaml
---
name: my-agent
model: gemini-2.5-pro
provider: gemini
---
```

This requires a small extension to `filesystem-scanner.ts` to parse the `provider` field.

---

## Phase 8: UI — Discussions Page

### 8.1 New Route

**File: `src/ui/App.tsx`**

Add route: `/discussions` → `DiscussionsPage`

### 8.2 Navigation

**File: `src/ui/TopNav.tsx`**

Add "Discussions" link to the nav bar.

### 8.3 Pages and Components

**New file: `src/ui/discussions/DiscussionsPage.tsx`**

Main page layout:
- Left sidebar: list of discussions (filterable by status, team)
- Right panel: selected discussion thread view
- Top bar: "New Discussion" button, team management dropdown

**New file: `src/ui/discussions/DiscussionThread.tsx`**

Thread viewer:
- Header: title, type, status, team name, vote tally
- Message list: chronological, author avatars/names, message type badges
- Vote status bar: shows each participant's current vote (satisfied/unsatisfied/pending)
- Input area: text input + message type selector + post button (for human participation)
- Vote buttons: "Satisfied" / "Unsatisfied" / "Abstain" (for human voting)

**New file: `src/ui/discussions/DiscussionList.tsx`**

Discussion list with:
- Status badges (draft, open, consensus, closed)
- Message count, participant count
- Time since last activity
- Filter tabs: All / Open / Closed

**New file: `src/ui/discussions/TeamManager.tsx`**

Modal/panel for managing teams:
- Create team: name, description, consensus rule picker, agent multi-select
- Agent selector: dropdown populated from `/api/agents` (shows global + project + workshop agents)
- Consensus rule: radio buttons (unanimous, majority, quorum) with threshold input

**New file: `src/ui/discussions/NewDiscussionModal.tsx`**

Create discussion form:
- Team selector (dropdown)
- Title (text input)
- Type (rfc / question / review radio)
- Artifact (large textarea for the document/diff/plan being discussed)
- Optional track binding (track selector dropdown)

### 8.4 API Client Hooks

**New file: `src/ui/discussions/use-discussions.ts`**

React hooks for fetching/mutating discussion data. Follow existing patterns in the codebase (likely `fetch` + `useEffect` + `useState`, or whatever pattern the other pages use).

### 8.5 WebSocket Integration

Listen for `discussion:message`, `discussion:vote`, `discussion:consensus` events to auto-refresh the thread view in real time.

---

## Phase 9: Testing

### 9.1 Unit Tests

**New file: `tests/application/discussion-consensus.test.ts`**

Test consensus rule evaluation:
- Unanimous: all satisfied → consensus, one unsatisfied → no consensus, abstention blocks unanimity
- Majority: `>=` threshold math, abstentions lower ratio
- Quorum: min votes + satisfied > unsatisfied
- Edge cases: no votes, single participant, vote changes, all abstain

**New file: `tests/application/discussion-service.test.ts`**

Test discussion lifecycle:
- Create discussion → sessions spawned, participants locked
- Post message → message stored, broadcast sent, `lastActivityAt` updated
- Post from non-participant → rejected
- Cast vote → vote stored, consensus checked
- Consensus reached → status updated, sessions destroyed
- Partial spawn failure → discussion still created with reduced participants
- Close discussion → sessions cleaned up

### 9.2 Integration Tests

**New file: `tests/domain/discussion-repository.test.ts`**

Test SQLite repository CRUD operations, filtering, the `findWithUnread` query, cascade deletes.

---

## File Summary

### New Files (19 files)

| Layer | File | Purpose |
|-------|------|---------|
| Foundation | `src/foundation/discussion-types.ts` | Discussion branded IDs and entity types (keeps types.ts under 300 lines) |
| Domain | `src/domain/discussion/repository.ts` | Repository interfaces |
| Infra | `src/infrastructure/persistence/discussion-team-repository.ts` | Team CRUD |
| Infra | `src/infrastructure/persistence/discussion-repository.ts` | Discussion CRUD |
| Infra | `src/infrastructure/persistence/discussion-message-repository.ts` | Message CRUD |
| Infra | `src/infrastructure/persistence/discussion-vote-repository.ts` | Vote upsert |
| Infra | `src/infrastructure/persistence/discussion-session-repository.ts` | Session join table + unread query |
| App | `src/application/shared/prompt-composition.ts` | Shared system prompt composition (extracted from task-scheduler) |
| App | `src/application/discussion/discussion-service.ts` | Orchestration + lifecycle |
| App | `src/application/discussion/discussion-poller.ts` | Poll-and-poke loop + stale detection |
| App | `src/application/discussion/governance-prompt.ts` | System prompt template |
| App | `src/application/discussion/provider-mapping.ts` | Agent model → CLI provider |
| MCP | `src/mcp/discussion-tools.ts` | MCP tool registration |
| Server | `src/server/discussion-routes.ts` | REST endpoints |
| UI | `src/ui/discussions/DiscussionsPage.tsx` | Main discussions page |
| UI | `src/ui/discussions/DiscussionThread.tsx` | Thread viewer |
| UI | `src/ui/discussions/DiscussionList.tsx` | Discussion list |
| UI | `src/ui/discussions/TeamManager.tsx` | Team management |
| UI | `src/ui/discussions/NewDiscussionModal.tsx` | Create discussion form |
| UI | `src/ui/discussions/use-discussions.ts` | API client hooks |

### Modified Files (9 files)

| File | Change |
|------|--------|
| `src/foundation/types.ts` | Add `SessionProvider: 'gemini'`, import/re-export discussion types |
| `src/infrastructure/persistence/database.ts` | Add 5 new tables + index in migrations |
| `src/infrastructure/terminal/manager.ts` | Add `buildGeminiLauncher`, guard unknown providers with throw |
| `src/infrastructure/agents/filesystem-scanner.ts` | Parse optional `provider` frontmatter field |
| `src/mcp/server.ts` | Import + call `registerDiscussionTools` |
| `src/server/events.ts` | Extend `EventType` union with discussion events |
| `src/server/api.ts` | Wire discussion repos, service, router, poller |
| `src/ui/App.tsx` | Add `/discussions` route |
| `src/ui/TopNav.tsx` | Add Discussions nav link |

### Build Order (sequential phases, parallelism within)

```
Phase 1: Foundation types (discussion-types.ts) + Domain interfaces
    ↓
Phase 2: SQLite tables + repository implementations
    ↓
Phase 3: Shared prompt composition refactor + DiscussionService + governance prompt + provider mapping
    ↓  (phases 4+5 can run in parallel)
Phase 4: MCP tools          Phase 5: REST routes + events.ts + WebSocket
    ↓                             ↓
Phase 6: Discussion poller (needs routes working for poke testing)
    ↓
Phase 7: Gemini CLI support (can be deferred — unknown providers throw, so it's safe)
    ↓
Phase 8: UI (can start as early as Phase 5 is done)
    ↓
Phase 9: Tests (continuous, but formal pass at the end)
```

Phases 1-6 are a single PR. Phase 7 (Gemini) and Phase 8 (full UI) should be separate PRs.

---

## Deferred / Future Work

- **`no_objections` consensus rule**: A rule where consensus is met if no one objects within a timeout. Requires tracking when the objection-free period started — adds schema complexity. Defer until the simpler rules prove insufficient.
- **Discussion templates**: Pre-defined discussion formats (architecture review, code review, design critique) with baked-in prompts.
- **Discussion outcomes**: Structured output from a completed discussion (approved diff, decision record, action items).
- **Cross-discussion references**: Ability to reference other discussions ("as decided in Discussion #42").
- **Agent reputation/weighting**: Track which agents contribute most usefully, adjust consensus weights.
- **Rate limiting**: Prevent agents from flooding discussions with rapid back-and-forth.
- **Event-driven nudge**: Post a message → immediately poke relevant agents instead of waiting for the next poll cycle. Would reduce latency from ~60s to near-instant but adds coupling between the message-post path and the terminal manager.
