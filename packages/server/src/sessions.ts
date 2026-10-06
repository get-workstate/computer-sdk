import { createId, nowIso, type RuntimeProvider, type RuntimeSession } from "@workstate/sdk";
import type { Db } from "./db.js";
import type { EnvironmentRecord } from "@workstate/sdk";

export interface SessionRecord {
  id: string;
  environmentId: string;
  status: "starting" | "running" | "stopped" | "failed";
  runtime: string;
  createdAt: string;
  updatedAt: string;
}

interface ActiveSession {
  record: SessionRecord;
  runtime: RuntimeSession;
}

export interface SessionSnapshot {
  id: string;
  status: string;
  runtime: string;
  liveViewUrl?: string;
  cdpUrl?: string;
}

export type ProviderResolver = (env: EnvironmentRecord) => RuntimeProvider;

export class SessionManager {
  private readonly active = new Map<string, ActiveSession>();
  private readonly starting = new Map<string, Promise<SessionRecord>>();
  private readonly startingInfo = new Map<string, SessionRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly resolveProvider: ProviderResolver;

  constructor(
    private readonly db: Db,
    provider: RuntimeProvider | ProviderResolver,
    private readonly headless: boolean,
  ) {
    this.resolveProvider = typeof provider === "function" ? provider : () => provider;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(environmentId: string): SessionSnapshot | null {
    const active = this.active.get(environmentId);
    if (active) {
      return {
        id: active.record.id,
        status: active.record.status,
        runtime: active.record.runtime,
        liveViewUrl: active.runtime.liveViewUrl,
        cdpUrl: active.runtime.cdpUrl,
      };
    }
    const starting = this.startingInfo.get(environmentId);
    if (starting) return { id: starting.id, status: "starting", runtime: starting.runtime };
    return null;
  }

  getRuntime(environmentId: string): RuntimeSession | null {
    return this.active.get(environmentId)?.runtime ?? null;
  }

  async ensure(env: EnvironmentRecord): Promise<ActiveSession> {
    const existing = this.active.get(env.id);
    if (existing) return existing;
    const pending = this.starting.get(env.id);
    if (pending) {
      await pending;
      const ready = this.active.get(env.id);
      if (!ready) throw new Error(`Session for ${env.name} failed to start.`);
      return ready;
    }

    const provider = this.resolveProvider(env);
    const record: SessionRecord = {
      id: createId("ses"),
      environmentId: env.id,
      status: "starting",
      runtime: provider.name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.startingInfo.set(env.id, record);
    this.db.insertSession(record);
    this.emit();

    const promise = (async () => {
      try {
        const runtime = await provider.start({
          id: env.id,
          name: env.name,
          paths: env.paths,
          headless: this.headless,
          config: env.config,
        });
        const running: SessionRecord = { ...record, status: "running", updatedAt: nowIso() };
        this.db.updateSessionStatus(running.id, "running");
        this.active.set(env.id, { record: running, runtime });
        this.startingInfo.delete(env.id);
        this.emit();
        return running;
      } catch (error) {
        this.startingInfo.delete(env.id);
        this.db.updateSessionStatus(record.id, "failed");
        this.emit();
        throw error;
      }
    })();

    this.starting.set(env.id, promise);
    try {
      await promise;
    } finally {
      this.starting.delete(env.id);
    }
    const ready = this.active.get(env.id);
    if (!ready) throw new Error(`Session for ${env.name} failed to start.`);
    return ready;
  }

  async stop(environmentId: string): Promise<void> {
    const active = this.active.get(environmentId);
    this.active.delete(environmentId);
    if (!active) return;
    await active.runtime.stop().catch(() => undefined);
    this.db.updateSessionStatus(active.record.id, "stopped");
    this.emit();
  }

  async stopAll(): Promise<void> {
    const ids = [...this.active.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
