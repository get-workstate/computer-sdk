import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createId, ENV_NAME_RE, nowIso, type EnvironmentPaths, type EnvironmentRecord } from "@workstate/sdk";
import type { Config } from "./config.js";
import type { Db, StoredEnvironment } from "./db.js";

export class EnvironmentStore {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  paths(id: string): EnvironmentPaths {
    const root = path.join(this.config.home, "environments", id);
    return {
      root,
      files: path.join(root, "files"),
      skills: path.join(root, "skills"),
      browserProfile: path.join(root, "browser-profile"),
      runs: path.join(root, "runs"),
    };
  }

  list(): EnvironmentRecord[] {
    return this.db.listEnvironments().map((row) => this.hydrate(row));
  }

  getByName(name: string): EnvironmentRecord | null {
    const row = this.db.getEnvironmentByName(name);
    return row ? this.hydrate(row) : null;
  }

  getById(id: string): EnvironmentRecord | null {
    const row = this.db.getEnvironmentById(id);
    return row ? this.hydrate(row) : null;
  }

  resolve(ref: string): EnvironmentRecord | null {
    return this.getByName(ref) ?? this.getById(ref);
  }

  getOrCreate(name: string, config: Record<string, unknown> = {}): EnvironmentRecord {
    if (!ENV_NAME_RE.test(name)) {
      throw Object.assign(
        new Error("Invalid environment name. Use 1–64 characters: letters, numbers, dots, underscores, or hyphens."),
        { status: 400, code: "invalid_name" },
      );
    }
    const existing = this.db.getEnvironmentByName(name);
    if (existing) return this.hydrate(existing);
    const stored: StoredEnvironment = {
      id: createId("env"),
      name,
      config,
      createdAt: nowIso(),
    };
    this.db.insertEnvironment(stored);
    const record = this.hydrate(stored);
    this.ensureDirs(record);
    const readme = path.join(record.paths.files, "README.txt");
    if (!existsSync(readme)) {
      writeFileSync(
        readme,
        "Files in this folder are the environment workspace.\nAgents see it as /workspace.\n",
      );
    }
    return record;
  }

  private hydrate(row: StoredEnvironment): EnvironmentRecord {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      config: row.config,
      paths: this.paths(row.id),
    };
  }

  private ensureDirs(record: EnvironmentRecord): void {
    for (const dir of Object.values(record.paths)) mkdirSync(dir, { recursive: true });
  }
}
