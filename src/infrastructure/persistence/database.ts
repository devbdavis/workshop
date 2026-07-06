import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import path from 'path';
import fs from 'fs';

function resolveDbPath(): string {
  return process.env.WORKSHOP_DB_PATH || path.join(process.env.HOME || '/tmp', '.workshop', 'workshop.db');
}

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = resolveDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Reset the database singleton so a new connection can be established.
 * Useful for tests that need isolated databases via WORKSHOP_DB_PATH.
 */
export function resetDatabase(): void {
  closeDatabase();
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_repos (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      remote_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_paths (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      tmux_session TEXT NOT NULL UNIQUE,
      claude_resume_id TEXT,
      system_prompt TEXT,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'related',
      cached_title TEXT,
      cached_status TEXT,
      cached_data TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT,
      action_type TEXT NOT NULL,
      action_config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      result TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      refined INTEGER NOT NULL DEFAULT 0,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      model TEXT,
      color TEXT,
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT,
      max_turns INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: add default_prompt_template_id column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN default_prompt_template_id TEXT REFERENCES prompt_templates(id);`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add context column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN context TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add background column to sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN background INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add terminal_layout column to tracks (JSON string)
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN terminal_layout TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add agent_id column to todos
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN agent_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add resolution column to todos
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN resolution TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add issue_key column to todos
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN issue_key TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: rename ticket_key to issue_key (if old column exists)
  try {
    db.exec(`ALTER TABLE todos RENAME COLUMN ticket_key TO issue_key;`);
  } catch {
    // Column doesn't exist or already renamed — safe to ignore
  }

  // Migration: add name column to sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add provider column to sessions (claude or codex)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create scheduled_tasks table
  try {
    db.exec(`
      CREATE TABLE scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        schedule_config TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        schedule_description TEXT NOT NULL DEFAULT '',
        track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
        agent_id TEXT,
        provider TEXT NOT NULL DEFAULT 'claude',
        task_prompt TEXT NOT NULL,
        system_prompt_override TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_run_status TEXT,
        last_session_id TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE scheduled_task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
  } catch {
    // Tables already exist — safe to ignore
  }

  // Migration: create workflow_tickets, workflow_transitions, and ticket_dependencies tables
  try {
    db.exec(`
      CREATE TABLE workflow_tickets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('epic', 'task')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL,
        state_data TEXT,
        parent_id TEXT REFERENCES workflow_tickets(id) ON DELETE CASCADE,
        track_id TEXT REFERENCES tracks(id) ON DELETE SET NULL,
        external_ticket_id TEXT REFERENCES tickets(id) ON DELETE SET NULL,
        assigned_agent_role TEXT,
        assigned_agent_ids TEXT,
        provider TEXT NOT NULL DEFAULT 'claude',
        priority TEXT NOT NULL DEFAULT 'medium',
        labels TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        state_changed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_wf_tickets_parent ON workflow_tickets(parent_id);
      CREATE INDEX idx_wf_tickets_state ON workflow_tickets(state);
      CREATE INDEX idx_wf_tickets_track ON workflow_tickets(track_id);
      CREATE INDEX idx_wf_tickets_type_state ON workflow_tickets(type, state);

      CREATE TABLE workflow_transitions (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES workflow_tickets(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        session_id TEXT,
        comment TEXT,
        data TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_wf_transitions_ticket ON workflow_transitions(ticket_id);

      CREATE TABLE ticket_dependencies (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES workflow_tickets(id) ON DELETE CASCADE,
        depends_on_id TEXT NOT NULL REFERENCES workflow_tickets(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE INDEX idx_ticket_deps_ticket ON ticket_dependencies(ticket_id);
      CREATE INDEX idx_ticket_deps_depends ON ticket_dependencies(depends_on_id);
    `);
  } catch {
    // Tables already exist — safe to ignore
  }

  // Migration: add execution_session_id column to workflow_tickets
  try {
    db.exec(`ALTER TABLE workflow_tickets ADD COLUMN execution_session_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create discussion tables
  try {
    db.exec(`
      CREATE TABLE discussion_teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        consensus_rule TEXT NOT NULL,
        member_agent_ids TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE discussions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES discussion_teams(id),
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'rfc',
        status TEXT NOT NULL DEFAULT 'open',
        artifact TEXT,
        track_id TEXT,
        created_by_type TEXT NOT NULL,
        created_by_id TEXT,
        participant_ids TEXT NOT NULL,
        stale_after_minutes INTEGER NOT NULL DEFAULT 0,
        last_activity_at TEXT NOT NULL,
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE discussion_messages (
        id TEXT PRIMARY KEY,
        discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        author_type TEXT NOT NULL,
        author_id TEXT,
        author_name TEXT,
        message_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_discussion_messages_discussion
        ON discussion_messages(discussion_id, created_at);

      CREATE TABLE discussion_votes (
        discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        voter_type TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        voter_name TEXT,
        vote TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (discussion_id, voter_type, voter_id)
      );

      CREATE TABLE discussion_sessions (
        discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        last_seen_message_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (discussion_id, agent_id)
      );
    `);
  } catch {
    // Tables already exist — safe to ignore
  }

  // Migration: add provider column to agents table
  try {
    db.exec(`ALTER TABLE agents ADD COLUMN provider TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add act_session_id column to discussions
  try {
    db.exec(`ALTER TABLE discussions ADD COLUMN act_session_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create mcp_server_configs table
  try {
    db.exec(`
      CREATE TABLE mcp_server_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport_type TEXT NOT NULL CHECK(transport_type IN ('stdio', 'http', 'sse')),
        command TEXT,
        args TEXT,
        env TEXT,
        url TEXT,
        headers TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: add label column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN label TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: backfill label='system' for existing system tracks (names starting with _)
  db.exec(`UPDATE tracks SET label = 'system' WHERE name LIKE '\\_%' ESCAPE '\\' AND label IS NULL;`);

  // Migration: create workflow_templates table
  try {
    db.exec(`
      CREATE TABLE workflow_templates (
        row_id TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        ticket_type TEXT NOT NULL CHECK(ticket_type IN ('epic', 'task')),
        stage_definitions TEXT NOT NULL,
        prompt_overrides TEXT,
        tags TEXT,
        match_criteria TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        avg_rating REAL,
        parent_template_id TEXT,
        is_latest BOOLEAN NOT NULL DEFAULT true,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        UNIQUE(id, version)
      );

      CREATE INDEX idx_wf_templates_id ON workflow_templates(id);
      CREATE INDEX idx_wf_templates_tags ON workflow_templates(tags);
      CREATE INDEX idx_wf_templates_ticket_type ON workflow_templates(ticket_type);
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: create partial index for latest templates (needs separate try-catch)
  try {
    db.exec(`CREATE INDEX idx_wf_templates_latest ON workflow_templates(id, is_latest) WHERE is_latest = true;`);
  } catch {
    // Index already exists — safe to ignore
  }

  // Migration: create workflow_agent_roles table
  try {
    db.exec(`
      CREATE TABLE workflow_agent_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt_block TEXT NOT NULL,
        tools_allowed TEXT,
        capability_tier TEXT NOT NULL DEFAULT 'advisory' CHECK(capability_tier IN ('advisory', 'code-modification', 'infrastructure')),
        created_by_template_row_id TEXT,
        reusable BOOLEAN NOT NULL DEFAULT true,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_wf_agent_roles_tier ON workflow_agent_roles(capability_tier);
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: create partial index for reusable agent roles
  try {
    db.exec(`CREATE INDEX idx_wf_agent_roles_reusable ON workflow_agent_roles(reusable) WHERE reusable = true;`);
  } catch {
    // Index already exists — safe to ignore
  }

  // Migration: create workflow_reviews table
  try {
    db.exec(`
      CREATE TABLE workflow_reviews (
        id TEXT PRIMARY KEY,
        template_row_id TEXT NOT NULL,
        epic_id TEXT NOT NULL REFERENCES workflow_tickets(id),
        structured_findings TEXT NOT NULL,
        suggested_changes TEXT,
        per_state_timing TEXT,
        human_approved BOOLEAN,
        applied_as_version INTEGER,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );

      CREATE INDEX idx_wf_reviews_template ON workflow_reviews(template_row_id);
      CREATE INDEX idx_wf_reviews_epic ON workflow_reviews(epic_id);
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: add workflow_template_row_id column to workflow_tickets
  try {
    db.exec(`ALTER TABLE workflow_tickets ADD COLUMN workflow_template_row_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add workflow_template_version column to workflow_tickets
  try {
    db.exec(`ALTER TABLE workflow_tickets ADD COLUMN workflow_template_version INTEGER;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add matrix_room_id column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN matrix_room_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add worktree_mode column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN worktree_mode INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add worktree_root column to sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN worktree_root TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add working_directory column to sessions
  // Stores the CWD used when the session was created so it can be restored on --resume.
  // Claude buckets conversation history by CWD — resuming from the wrong directory
  // causes "No conversation found" errors.
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN working_directory TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add deleted_at column for soft-delete / recycle bin (7-day retention).
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN deleted_at TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create unique index on matrix_room_id (partial — only non-null values)
  try {
    db.exec(`CREATE UNIQUE INDEX idx_tracks_matrix_room ON tracks(matrix_room_id) WHERE matrix_room_id IS NOT NULL;`);
  } catch {
    // Index already exists — safe to ignore
  }

  // Migration: add default_agent_id column to tracks
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN default_agent_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: enable worktree mode on all existing tracks
  db.exec(`UPDATE tracks SET worktree_mode = 1 WHERE worktree_mode = 0;`);

  // Migration: rename workflow_templates table to workflow_playbooks
  try {
    db.exec(`ALTER TABLE workflow_templates RENAME TO workflow_playbooks;`);
  } catch {
    // Table already renamed — safe to ignore
  }

  // Migration: recreate indexes with new names after table rename
  try {
    db.exec(`DROP INDEX IF EXISTS idx_wf_templates_id;`);
    db.exec(`CREATE INDEX idx_wf_playbooks_id ON workflow_playbooks(id);`);
  } catch {
    // Index already exists — safe to ignore
  }

  try {
    db.exec(`DROP INDEX IF EXISTS idx_wf_templates_tags;`);
    db.exec(`CREATE INDEX idx_wf_playbooks_tags ON workflow_playbooks(tags);`);
  } catch {
    // Index already exists — safe to ignore
  }

  try {
    db.exec(`DROP INDEX IF EXISTS idx_wf_templates_ticket_type;`);
    db.exec(`CREATE INDEX idx_wf_playbooks_ticket_type ON workflow_playbooks(ticket_type);`);
  } catch {
    // Index already exists — safe to ignore
  }

  try {
    db.exec(`DROP INDEX IF EXISTS idx_wf_templates_latest;`);
    db.exec(`CREATE INDEX idx_wf_playbooks_latest ON workflow_playbooks(id, is_latest) WHERE is_latest = true;`);
  } catch {
    // Index already exists — safe to ignore
  }

  // Migration: create global repos table
  try {
    db.exec(`
      CREATE TABLE repos (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        main_branch TEXT NOT NULL DEFAULT 'main',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: create settings table (key/value store)
  try {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: add repo_id column to track_repos (optional FK to global repos)
  try {
    db.exec(`ALTER TABLE track_repos ADD COLUMN repo_id TEXT REFERENCES repos(id);`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add is_default column to prompt_templates
  try {
    db.exec(`ALTER TABLE prompt_templates ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: drop permission_requests table (permission system removed)
  db.exec(`DROP TABLE IF EXISTS permission_requests;`);

  // Migration: add script_path column to scheduled_tasks
  try {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN script_path TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add template_name column to scheduled_tasks
  try {
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN template_name TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add pull_requests column to todos (JSON array of {url, title?})
  try {
    db.exec(`ALTER TABLE todos ADD COLUMN pull_requests TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: add output column to scheduled_task_runs (captured terminal output)
  try {
    db.exec(`ALTER TABLE scheduled_task_runs ADD COLUMN output TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create ticket_import_ignores table — tracks external tickets the
  // user has hidden from the Import modal so they don't keep reappearing. Kept
  // in a dedicated table (not the settings K/V store) so ignores carry metadata
  // (cached title/url) and can be browsed/unhidden from the UI.
  try {
    db.exec(`
      CREATE TABLE ticket_import_ignores (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        cached_title TEXT,
        cached_url TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(source, external_id)
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: fix stale last_run_status='running' on tasks whose session has ended.
  // Old server code set last_run_status='running' and never updated it after dispatch.
  // Any task that has a last_session_id is confirmed dispatched, so treat it as completed.
  db.exec(`
    UPDATE scheduled_tasks
    SET last_run_status = 'completed'
    WHERE last_run_status = 'running'
      AND last_session_id IS NOT NULL;
  `);

  // Migration: create plugins table — workshop-global registry of AI-CLI
  // marketplace plugins (e.g. Claude Code plugins) ensured-installed at server
  // startup and enabled per-session at launch time.
  try {
    db.exec(`
      CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        marketplace_repo TEXT NOT NULL,
        plugin_name TEXT NOT NULL UNIQUE,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        providers TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: add system_kind column to prompt_templates so we can recognise
  // app-managed templates (todo dispatch, PR build-fix, PR comment-response)
  // and ensure they always exist. User-created templates leave this NULL.
  try {
    db.exec(`ALTER TABLE prompt_templates ADD COLUMN system_kind TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: create pr_monitors table. The poller in src/application/pr-monitor
  // walks rows where monitoring=1 ordered by last_polled_at and refreshes a small
  // batch on each tick. PR URL is the natural key — one row per PR.
  try {
    db.exec(`
      CREATE TABLE pr_monitors (
        pr_url TEXT PRIMARY KEY,
        todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_title TEXT,
        pr_branch TEXT,
        state TEXT NOT NULL DEFAULT 'unknown',
        check_status TEXT NOT NULL DEFAULT 'none',
        failing_checks TEXT,
        unresolved_comments TEXT,
        needs_attention_since TEXT,
        last_polled_at TEXT,
        last_event_at TEXT,
        monitoring INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`CREATE INDEX idx_pr_monitors_todo ON pr_monitors(todo_id);`);
    db.exec(`CREATE INDEX idx_pr_monitors_polling ON pr_monitors(monitoring, last_polled_at);`);
  } catch {
    // Table already exists — safe to ignore
  }

  // Migration: back-fill pr_branch on pr_monitors for installs that ran the
  // earlier schema (no-op when the table is fresh).
  try {
    db.exec(`ALTER TABLE pr_monitors ADD COLUMN pr_branch TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: track head_ref_oid so we can detect pushes, remember the
  // timestamp of the last push, and record why the monitor was paused
  // (merged/closed vs. stale-since-last-push).
  try {
    db.exec(`ALTER TABLE pr_monitors ADD COLUMN head_ref_oid TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE pr_monitors ADD COLUMN last_push_at TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE pr_monitors ADD COLUMN pause_reason TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Migration: PR Review Dashboard. pr_reviews holds incoming review requests
  // (discovered by the review-request poller or added by URL); pr_review_findings
  // holds the structured feedback the pr-review agent reports back. Distinct from
  // pr_monitors, which tracks the user's own outgoing PRs per todo.
  try {
    db.exec(`
      CREATE TABLE pr_reviews (
        id TEXT PRIMARY KEY,
        pr_url TEXT NOT NULL UNIQUE,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        pr_number INTEGER NOT NULL,
        pr_title TEXT,
        pr_author TEXT,
        pr_branch TEXT,
        head_sha TEXT,
        state TEXT NOT NULL DEFAULT 'incoming',
        discovered_via TEXT NOT NULL DEFAULT 'poll',
        session_id TEXT,
        draft_summary TEXT,
        suggested_verdict TEXT,
        submitted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE pr_review_findings (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
        file TEXT NOT NULL,
        line INTEGER,
        side TEXT NOT NULL DEFAULT 'RIGHT',
        category TEXT,
        summary TEXT NOT NULL,
        failure_scenario TEXT,
        suggested_comment TEXT NOT NULL,
        code_context TEXT,
        anchored INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`CREATE INDEX idx_pr_review_findings_review ON pr_review_findings(review_id);`);
  } catch {
    // Tables already exist — safe to ignore
  }

  // Migration: PR description on pr_reviews (no-op when the table is fresh).
  try {
    db.exec(`ALTER TABLE pr_reviews ADD COLUMN pr_body TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Seed default repo_root setting
  db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('repo_root', '~/Klaviyo/Repos');`);

  // Seed default prompt templates if the table is empty
  seedDefaultTemplates(db);

  // Seed default plugins (ponytail) if not present
  seedDefaultPlugins(db);
}

function seedDefaultPlugins(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO plugins (id, marketplace_repo, plugin_name, description, enabled, created_at, updated_at)
     VALUES (?, 'DietrichGebert/ponytail', 'ponytail@ponytail', 'Lazy senior dev discipline — YAGNI ladder + /ponytail-review over-engineering review', 1, ?, ?)`,
  ).run(uuid(), now, now);
}

function seedDefaultTemplates(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM prompt_templates').get() as { cnt: number };
  if (count.cnt > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO prompt_templates (id, name, description, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  insert.run(
    uuid(),
    'General Development',
    'A general-purpose system prompt for software development work',
    `You are an expert software developer helping with the "{{track.name}}" project.

{{track.description}}

Repositories: {{track.repos}}
Track Paths: {{track.paths}}
Linked tickets: {{track.tickets}}

Follow best practices for code quality, testing, and documentation. Be concise and actionable in your responses.`,
    now,
    now,
  );

  insert.run(
    uuid(),
    'Code Review',
    'Focused on reviewing and improving code quality',
    `You are a senior code reviewer analyzing code in the "{{track.name}}" project.

{{track.description}}

Repositories: {{track.repos}}
Track Paths: {{track.paths}}

Focus on:
- Correctness and potential bugs
- Performance implications
- Security concerns
- Code readability and maintainability
- Adherence to project conventions

Provide specific, actionable feedback with code examples where helpful.`,
    now,
    now,
  );

  insert.run(
    uuid(),
    'Research & Planning',
    'Focused on investigation and planning tasks',
    `You are a technical advisor helping plan and research for the "{{track.name}}" project.

{{track.description}}

Linked tickets: {{track.tickets}}

Focus on:
- Breaking down requirements into concrete tasks
- Identifying risks and unknowns
- Evaluating technical approaches with trade-offs
- Providing well-structured recommendations

Be thorough in your analysis but keep recommendations practical and prioritized.`,
    now,
    now,
  );
}

const DEFAULT_TODO_TEMPLATE_CONTENT = `## Repositories

{{track.repos}}

## Track Paths

{{track.paths}}

---

## Task

**{{todo.title}}**

{{todo.description}}

---

## Background Agent Instructions

You are running as a background agent dispatched from Workshop.

When you have completed the task (or determined you cannot proceed):
1. Use the workshop_update_todo MCP tool to update todo "{{todo.id}}" status to "review"
2. Add a brief summary of what you accomplished or why you stopped to the description
`;

/**
 * Ensure the "Todo Prompt Template" (the system default) exists and is assigned
 * to every track that has no template configured. Idempotent — safe to call on
 * every startup.
 *
 * If the existing default template still contains the old soul-based content
 * (identified by the Jeeves heading), it is replaced with the correct template.
 */
export function ensureDefaultTodoTemplate(): void {
  const db = getDatabase();

  let templateId: string;
  const existing = db.prepare(`SELECT id, content FROM prompt_templates WHERE is_default = 1 LIMIT 1`).get() as { id: string; content: string } | undefined;

  if (existing) {
    templateId = existing.id;
    // Replace old soul-based content or templates that still include the /exit instruction
    if (existing.content.includes('Workshop Agent Soul') || existing.content.includes('You are Jeeves') || existing.content.includes('Use /exit to close your session')) {
      db.prepare(`UPDATE prompt_templates SET content = ?, updated_at = ? WHERE id = ?`).run(
        DEFAULT_TODO_TEMPLATE_CONTENT, new Date().toISOString(), templateId,
      );
    }
  } else {
    templateId = uuid();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO prompt_templates (id, name, description, content, is_default, system_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'todo', ?, ?)`,
    ).run(templateId, 'Todo Prompt Template', 'Default system prompt for dispatched todos', DEFAULT_TODO_TEMPLATE_CONTENT, now, now);
  }

  // Stamp system_kind='todo' on the legacy default row if it predates the column.
  db.prepare(`UPDATE prompt_templates SET system_kind = 'todo' WHERE id = ? AND (system_kind IS NULL OR system_kind = '')`).run(templateId);

  // Back-fill all tracks that have no default template assigned
  db.prepare(
    `UPDATE tracks SET default_prompt_template_id = ?, updated_at = ? WHERE default_prompt_template_id IS NULL`,
  ).run(templateId, new Date().toISOString());
}

const DEFAULT_PR_BUILD_FIX_TEMPLATE_CONTENT = `## PR Build Fix

You are running as a background sub-agent dispatched to investigate and fix a failing CI build on a pull request.

**PR:** [{{pr.title}}]({{pr.url}})
**Branch:** \`{{pr.branch}}\`
**Repository:** {{pr.repo}}

### Failing checks

{{pr.failing_checks}}

### Your task

1. Check out the PR branch locally (\`gh pr checkout {{pr.number}}\`) or work in the existing worktree.
2. Reproduce the failure locally where possible — read the linked check logs first.
3. Fix the underlying issue. Do not paper over the symptom (skipping tests, lowering thresholds, etc.) unless the user explicitly asks.
4. Commit and push the fix to the same branch. Do NOT open a new PR.
5. Briefly report what was wrong and what you changed.

If you cannot determine the cause from the logs alone, stop and report what you tried and what's needed to proceed.
`;

const DEFAULT_PR_COMMENT_RESPONSE_TEMPLATE_CONTENT = `## PR Comment Response

You are running as a background sub-agent dispatched to address review feedback on a pull request.

**PR:** [{{pr.title}}]({{pr.url}})
**Branch:** \`{{pr.branch}}\`
**Repository:** {{pr.repo}}

### Comments to address

{{pr.comments}}

### Your task

1. Read each comment carefully. If a comment is asking a question, you may answer it directly via \`gh pr comment\` rather than changing code.
2. For code-change requests, check out the PR branch (\`gh pr checkout {{pr.number}}\`), make the change, commit, and push to the same branch.
3. Reply to each comment so the reviewer knows it's been addressed — use \`gh api\` to post threaded review-comment replies or \`gh pr comment\` for issue-level comments.
4. Briefly report which comments you handled and how.

If a comment is unclear or you genuinely disagree, leave a reply explaining your reasoning rather than making the change.
`;

interface SystemTemplateSpec {
  systemKind: 'pr-build-fix' | 'pr-comment-response';
  name: string;
  description: string;
  content: string;
}

const SYSTEM_TEMPLATE_SPECS: SystemTemplateSpec[] = [
  {
    systemKind: 'pr-build-fix',
    name: 'PR Build Fix',
    description: 'Prompt sent to a sub-agent when a monitored PR has failing CI checks. Editable.',
    content: DEFAULT_PR_BUILD_FIX_TEMPLATE_CONTENT,
  },
  {
    systemKind: 'pr-comment-response',
    name: 'PR Comment Response',
    description: 'Prompt sent to a sub-agent when a monitored PR has unresolved comments. Editable.',
    content: DEFAULT_PR_COMMENT_RESPONSE_TEMPLATE_CONTENT,
  },
];

/**
 * Ensure each well-known system template row exists. Idempotent — runs on every
 * startup. If the row already exists the user's edits are preserved; only the
 * `system_kind` flag is healed when missing.
 */
export function ensureSystemPromptTemplates(): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  for (const spec of SYSTEM_TEMPLATE_SPECS) {
    const existing = db.prepare(
      `SELECT id, system_kind FROM prompt_templates WHERE system_kind = ? LIMIT 1`,
    ).get(spec.systemKind) as { id: string; system_kind: string | null } | undefined;

    if (existing) {
      // Heal any missing/empty system_kind flag (shouldn't happen, defensive).
      if (!existing.system_kind) {
        db.prepare(`UPDATE prompt_templates SET system_kind = ? WHERE id = ?`).run(spec.systemKind, existing.id);
      }
      continue;
    }

    // Also tolerate older installs that created the row by name but never set
    // system_kind. Find by exact name as a fallback.
    const byName = db.prepare(`SELECT id FROM prompt_templates WHERE name = ? LIMIT 1`).get(spec.name) as { id: string } | undefined;
    if (byName) {
      db.prepare(`UPDATE prompt_templates SET system_kind = ? WHERE id = ?`).run(spec.systemKind, byName.id);
      continue;
    }

    db.prepare(
      `INSERT INTO prompt_templates (id, name, description, content, is_default, system_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(uuid(), spec.name, spec.description, spec.content, spec.systemKind, now, now);
  }
}
