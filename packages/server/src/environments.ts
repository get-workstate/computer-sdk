import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RUNTIME_IDS, isRuntimeId } from "@workstate/integrations";
import { createId, ENV_NAME_RE, nowIso, type EnvironmentPaths, type EnvironmentRecord } from "@workstate/sdk";
import type { Config } from "./config.js";
import type { Db, StoredEnvironment } from "./db.js";

const STRING_KEYS = [
  "model",
  "credentials",
  "mailbox",
  "payments",
  "anchorProfile",
  "anchorIdentityId",
  "browserbaseContextId",
  "kernelProfile",
  "e2bTemplate",
  "daytonaImage",
  "daytonaSnapshot",
];

function invalid(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: "invalid_config" });
}

export function validateConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (config.runtime !== undefined && !isRuntimeId(config.runtime)) {
    throw invalid(`Unknown runtime "${String(config.runtime)}". Choose one of ${RUNTIME_IDS.join(", ")}.`);
  }
  for (const key of STRING_KEYS) {
    if (config[key] !== undefined && typeof config[key] !== "string") throw invalid(`config.${key} must be a string.`);
  }
  if (typeof config.credentials === "string" && !/^op:\/\/[^/]+\/[^/]+/.test(config.credentials)) {
    throw invalid('config.credentials must be a 1Password reference like "op://Vault/Item".');
  }
  if (config.payments !== undefined && config.payments !== "agentcard") {
    throw invalid('config.payments must be "agentcard".');
  }
  if (
    config.anchorIdentitySkipValidation !== undefined &&
    typeof config.anchorIdentitySkipValidation !== "boolean"
  ) {
    throw invalid("config.anchorIdentitySkipValidation must be a boolean.");
  }
  if (config.anchorTasks !== undefined) {
    if (
      !Array.isArray(config.anchorTasks) ||
      config.anchorTasks.some(
        (task) =>
          !task ||
          typeof task !== "object" ||
          typeof (task as Record<string, unknown>).taskId !== "string" ||
          typeof (task as Record<string, unknown>).name !== "string" ||
          !Array.isArray((task as Record<string, unknown>).tags),
      )
    ) {
      throw invalid("config.anchorTasks must be an array of learned Anchor task records.");
    }
  }
  if (config.anchorDemonstrations !== undefined && !Array.isArray(config.anchorDemonstrations)) {
    throw invalid("config.anchorDemonstrations must be an array.");
  }
  return config;
}

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
    if (existing) {
      // Creating an existing environment with new settings updates it in place.
      return Object.keys(config).length > 0 ? this.updateConfig(existing.id, config) : this.hydrate(existing);
    }
    const stored: StoredEnvironment = {
      id: createId("env"),
      name,
      config: validateConfig(config),
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

  /** Merge a config patch. Null values delete keys. */
  updateConfig(id: string, patch: Record<string, unknown>): EnvironmentRecord {
    const existing = this.db.getEnvironmentById(id);
    if (!existing) throw Object.assign(new Error("Environment not found."), { status: 404, code: "not_found" });
    const next: Record<string, unknown> = { ...existing.config };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") delete next[key];
      else next[key] = value;
    }
    const validated = validateConfig(next);
    this.db.updateEnvironmentConfig(id, validated);
    return this.hydrate({ ...existing, config: validated });
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
