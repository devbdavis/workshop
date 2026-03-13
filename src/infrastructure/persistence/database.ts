import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  return process.env.WORKSHOP_DB_PATH || path.resolve(__dirname, '../../../workshop.db');
}

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = resolveDbPath();
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

    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      tool_input TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'pending',
      decision_reason TEXT,
      user_comment TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
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

  // Migration: add execution tracking columns to workflow_tickets
  try {
    db.exec(`ALTER TABLE workflow_tickets ADD COLUMN execution_session_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE workflow_tickets ADD COLUMN execution_data TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Seed default prompt templates if the table is empty
  seedDefaultTemplates(db);
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
