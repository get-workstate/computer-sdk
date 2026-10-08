import "./quiet.js";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { nowIso, type RunEvent, type RunRecord, type RunStatus } from "@workstate/sdk";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

function openDatabase(file: string): DatabaseSync {
  const sqlite = require("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(file);
}

interface EnvRow {
  id: string;
  name: string;
  config: string;
  created_at: string;
}

interface RunRow {
  id: string;
  environment_id: string;
  environment_name: string;
  session_id: string | null;
  prompt: string;
  model: string;
  status: RunStatus;
  error: string | null;
  error_code: string | null;
  result: string | null;
  human_request: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EventRow {
  id: number | bigint;
  run_id: string;
  kind: string;
  message: string;
  data: string | null;
  created_at: string;
}

export interface StoredEnvironment {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  return JSON.parse(value) as T;
}

export class Db {
  readonly sqlite: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.sqlite = openDatabase(file);
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        config TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        environment_id TEXT NOT NULL,
        environment_name TEXT NOT NULL,
        session_id TEXT,
        prompt TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        error_code TEXT,
        result TEXT,
        human_request TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_env_created ON runs(environment_id, created_at);
      CREATE INDEX IF NOT EXISTS run_events_run ON run_events(run_id, id);
    `);
    const columns = this.sqlite.prepare("PRAGMA table_info(runs)").all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "error_code")) {
      this.sqlite.exec("ALTER TABLE runs ADD COLUMN error_code TEXT");
    }
  }

  close(): void {
    this.sqlite.close();
  }

  insertEnvironment(row: StoredEnvironment): void {
    this.sqlite
      .prepare("INSERT INTO environments (id, name, config, created_at) VALUES (?, ?, ?, ?)")
      .run(row.id, row.name, JSON.stringify(row.config), row.createdAt);
  }

  updateEnvironmentConfig(id: string, config: Record<string, unknown>): void {
    this.sqlite.prepare("UPDATE environments SET config = ? WHERE id = ?").run(JSON.stringify(config), id);
  }

  getEnvironmentByName(name: string): StoredEnvironment | null {
    const row = this.sqlite.prepare("SELECT * FROM environments WHERE name = ?").get(name) as EnvRow | undefined;
    return row ? this.mapEnv(row) : null;
  }

  getEnvironmentById(id: string): StoredEnvironment | null {
    const row = this.sqlite.prepare("SELECT * FROM environments WHERE id = ?").get(id) as EnvRow | undefined;
    return row ? this.mapEnv(row) : null;
  }

  listEnvironments(): StoredEnvironment[] {
    const rows = this.sqlite.prepare("SELECT * FROM environments ORDER BY created_at ASC").all() as unknown as EnvRow[];
    return rows.map((row) => this.mapEnv(row));
  }

  private mapEnv(row: EnvRow): StoredEnvironment {
    return {
      id: row.id,
      name: row.name,
      config: parseJson<Record<string, unknown>>(row.config) ?? {},
      createdAt: row.created_at,
    };
  }

  insertSession(row: { id: string; environmentId: string; status: string; runtime: string; createdAt: string; updatedAt: string }): void {
    this.sqlite
      .prepare("INSERT INTO sessions (id, environment_id, status, runtime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.environmentId, row.status, row.runtime, row.createdAt, row.updatedAt);
  }

  updateSessionStatus(id: string, status: string): void {
    this.sqlite.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  }

  stopAllRunningSessions(): void {
    this.sqlite
      .prepare("UPDATE sessions SET status = 'stopped', updated_at = ? WHERE status IN ('starting', 'running')")
      .run(nowIso());
  }

  failInterruptedRuns(message: string): void {
    const stamp = nowIso();
    this.sqlite
      .prepare(
        `UPDATE runs
         SET status = 'failed', error = ?, error_code = 'interrupted', updated_at = ?, finished_at = COALESCE(finished_at, ?)
         WHERE status IN ('queued', 'running', 'waiting_for_human', 'human_controlling', 'resumed')`,
      )
      .run(message, stamp, stamp);
  }

  insertRun(run: RunRecord): void {
    this.sqlite
      .prepare(
        `INSERT INTO runs (
          id, environment_id, environment_name, session_id, prompt, model, status, error, error_code, result, human_request,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.environmentId,
        run.environmentName,
        run.sessionId,
        run.prompt,
        run.model,
        run.status,
        run.error,
        run.errorCode,
        run.result ? JSON.stringify(run.result) : null,
        run.humanRequest ? JSON.stringify(run.humanRequest) : null,
        run.createdAt,
        run.updatedAt,
        run.startedAt,
        run.finishedAt,
      );
  }

  updateRun(run: RunRecord): void {
    this.sqlite
      .prepare(
        `UPDATE runs SET
          session_id = ?, status = ?, error = ?, error_code = ?, result = ?, human_request = ?,
          updated_at = ?, started_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        run.sessionId,
        run.status,
        run.error,
        run.errorCode,
        run.result ? JSON.stringify(run.result) : null,
        run.humanRequest ? JSON.stringify(run.humanRequest) : null,
        run.updatedAt,
        run.startedAt,
        run.finishedAt,
        run.id,
      );
  }

  getRun(id: string): RunRecord | null {
    const row = this.sqlite.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(options: { environmentId?: string; limit: number }): RunRecord[] {
    const limit = Math.max(1, Math.min(options.limit, 200));
    const rows = (
      options.environmentId
        ? this.sqlite
            .prepare("SELECT * FROM runs WHERE environment_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(options.environmentId, limit)
        : this.sqlite.prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit)
    ) as unknown as RunRow[];
    return rows.map(mapRun);
  }

  nextQueued(environmentId: string): RunRecord | null {
    const row = this.sqlite
      .prepare(
        "SELECT * FROM runs WHERE environment_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1",
      )
      .get(environmentId) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  findActiveRun(environmentId: string): RunRecord | null {
    const row = this.sqlite
      .prepare(
        `SELECT * FROM runs
         WHERE environment_id = ?
           AND status IN ('queued', 'running', 'waiting_for_human', 'human_controlling', 'resumed')
         ORDER BY CASE status
           WHEN 'waiting_for_human' THEN 0
           WHEN 'human_controlling' THEN 1
           WHEN 'running' THEN 2
           WHEN 'resumed' THEN 3
           ELSE 4
         END, created_at DESC
         LIMIT 1`,
      )
      .get(environmentId) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  insertEvent(event: Omit<RunEvent, "id">): RunEvent {
    const result = this.sqlite
      .prepare("INSERT INTO run_events (run_id, kind, message, data, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(event.runId, event.kind, event.message, event.data === undefined ? null : JSON.stringify(event.data), event.createdAt);
    return {
      ...event,
      id: Number(result.lastInsertRowid),
    };
  }

  listEvents(runId: string): RunEvent[] {
    const rows = this.sqlite.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC").all(runId) as unknown as EventRow[];
    return rows.map(mapEvent);
  }

  eventsAfter(runId: string, after: number): RunEvent[] {
    const rows = this.sqlite
      .prepare("SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC")
      .all(runId, after) as unknown as EventRow[];
    return rows.map(mapEvent);
  }
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    environmentId: row.environment_id,
    environmentName: row.environment_name,
    sessionId: row.session_id,
    prompt: row.prompt,
    model: row.model,
    status: row.status,
    error: row.error,
    errorCode: row.error_code,
    result: parseJson(row.result),
    humanRequest: parseJson(row.human_request),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function mapEvent(row: EventRow): RunEvent {
  return {
    id: Number(row.id),
    runId: row.run_id,
    kind: row.kind,
    message: row.message,
    data: parseJson(row.data) ?? undefined,
    createdAt: row.created_at,
  };
}
