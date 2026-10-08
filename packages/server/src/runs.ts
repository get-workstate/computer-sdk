import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { integrationsForEnvironment } from "@workstate/integrations";
import { buildSystemPrompt, defaultModel, resolveAdapter } from "@workstate/model-adapters";
import {
  createId,
  isTerminalStatus,
  nowIso,
  type AdapterRunResult,
  type Computer,
  type CuaAdapter,
  type EnvironmentRecord,
  type Human,
  type HumanRequestRecord,
  type HumanResponse,
  type RunEvent,
  type RunRecord,
  type Skills,
} from "@workstate/sdk";
import type { Db } from "./db.js";
import type { EnvironmentStore } from "./environments.js";
import { httpError } from "./errors.js";
import { FilesystemSkills } from "./skills.js";
import type { SessionManager } from "./sessions.js";

export interface HumanAction {
  action: "take_control" | "return" | "approve" | "decline" | "answer" | "stop";
  requestId?: string;
  answers?: Record<string, string>;
  text?: string;
}

const ACTION_MESSAGE: Record<string, string> = {
  returned: "Control returned to the agent",
  approve: "Approved",
  decline: "Declined",
  answer: "Answer sent",
};

export class RunManager {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly humanWaiters = new Map<string, (response: HumanResponse) => void>();
  private readonly recipes = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly environments: EnvironmentStore,
    private readonly sessions: SessionManager,
    private readonly options: { publicUrl: string; adapter?: CuaAdapter },
  ) {}

  create(env: EnvironmentRecord, input: { prompt: string; model?: string; recipe?: string }): RunRecord {
    const prompt = input.prompt.trim();
    if (!prompt) throw httpError(400, "invalid_prompt", "A run needs a prompt.");
    if (prompt.length > 8000) throw httpError(400, "invalid_prompt", "Prompt is too long.");
    const stamp = nowIso();
    const run: RunRecord = {
      id: createId("run"),
      environmentId: env.id,
      environmentName: env.name,
      sessionId: null,
      prompt,
      model: input.model?.trim() || (typeof env.config.model === "string" && env.config.model.trim()) || defaultModel(),
      status: "queued",
      error: null,
      errorCode: null,
      result: null,
      humanRequest: null,
      createdAt: stamp,
      updatedAt: stamp,
      startedAt: null,
      finishedAt: null,
    };
    this.db.insertRun(run);
    if (input.recipe?.trim()) this.recipes.set(run.id, input.recipe.trim());
    this.emit(run.id, "status", "Run queued");
    this.kick(env.id);
    return this.db.getRun(run.id)!;
  }

  createHumanRequest(env: EnvironmentRecord, input: { kind: HumanRequestRecord["kind"]; message: string }): RunRecord {
    const message = input.message.trim();
    if (!message) throw httpError(400, "invalid_prompt", "A request needs a message.");
    const stamp = nowIso();
    const humanRequest: HumanRequestRecord = {
      id: createId("hum"),
      kind: input.kind,
      message,
      createdAt: stamp,
    };
    const run: RunRecord = {
      id: createId("run"),
      environmentId: env.id,
      environmentName: env.name,
      sessionId: null,
      prompt: message,
      model: "human",
      status: "waiting_for_human",
      error: null,
      errorCode: "needs_human",
      result: null,
      humanRequest,
      createdAt: stamp,
      updatedAt: stamp,
      startedAt: stamp,
      finishedAt: null,
    };
    this.db.insertRun(run);
    this.emit(run.id, "human", message, { ...humanRequest, code: "needs_human" });
    return run;
  }

  get(id: string): RunRecord {
    return this.must(id);
  }

  events(id: string): RunEvent[] {
    this.must(id);
    return this.db.listEvents(id);
  }

  list(options: { environmentId?: string; limit?: number }): RunRecord[] {
    return this.db.listRuns({ environmentId: options.environmentId, limit: options.limit ?? 50 });
  }

  currentForEnvironment(environmentId: string): RunRecord | null {
    return this.db.findActiveRun(environmentId);
  }

  async waitForChange(runId: string, after: number, timeoutMs = 20_000): Promise<{ run: RunRecord; events: RunEvent[] }> {
    const snapshot = () => {
      const run = this.must(runId);
      return { run, events: this.db.eventsAfter(runId, after) };
    };
    const initial = snapshot();
    if (initial.events.length > 0 || isTerminalStatus(initial.run.status)) return initial;
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(runId) ?? new Set<() => void>();
      this.waiters.set(runId, set);
      const finish = () => {
        clearTimeout(timer);
        set.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      set.add(finish);
    });
    return snapshot();
  }

  cancel(runId: string): RunRecord {
    const run = this.must(runId);
    if (isTerminalStatus(run.status)) return run;
    this.update(runId, { status: "cancelled", finishedAt: nowIso(), humanRequest: null, error: null, errorCode: null });
    this.emit(runId, "status", "Run cancelled");
    this.aborts.get(runId)?.abort();
    if (run.humanRequest) this.humanWaiters.delete(run.humanRequest.id);
    void this.persist(run.environmentId, runId).catch(() => undefined);
    return this.db.getRun(runId)!;
  }

  markHumanControlling(env: EnvironmentRecord): RunRecord {
    const run = this.db.findActiveRun(env.id);
    if (!run) throw httpError(404, "no_run", "No active run on this environment.");
    if (run.status === "waiting_for_human") {
      this.update(run.id, { status: "human_controlling" });
      this.emit(run.id, "status", "You're in control of the browser");
    }
    return this.db.getRun(run.id)!;
  }

  resolveHuman(env: EnvironmentRecord, body: HumanAction): RunRecord {
    if (body.action === "stop") {
      const run = this.db.findActiveRun(env.id);
      if (!run) throw httpError(404, "no_run", "No active run on this environment.");
      return this.cancel(run.id);
    }
    if (body.action === "take_control") return this.markHumanControlling(env);

    const run = this.db.findActiveRun(env.id);
    if (!run?.humanRequest) throw httpError(404, "no_request", "No one is waiting on this environment.");
    if (body.requestId && body.requestId !== run.humanRequest.id) {
      throw httpError(409, "stale_request", "That request is no longer active.");
    }
    const action = body.action === "return" ? "returned" : body.action;
    if (!["returned", "approve", "decline", "answer"].includes(action)) {
      throw httpError(400, "bad_action", "Unknown human action.");
    }
    const response: HumanResponse = {
      id: run.humanRequest.id,
      action: action as HumanResponse["action"],
      answers: body.answers ?? (body.text ? { text: body.text } : undefined),
    };
    const waiter = this.humanWaiters.get(run.humanRequest.id);
    this.humanWaiters.delete(run.humanRequest.id);
    if (waiter) {
      this.update(run.id, { status: "resumed", humanRequest: null, errorCode: null });
      this.emit(run.id, "status", ACTION_MESSAGE[action] ?? "Control returned to the agent");
      waiter(response);
      return this.db.getRun(run.id)!;
    }
    if (action === "decline") {
      this.update(run.id, {
        status: "failed",
        error: "Declined by a person",
        errorCode: "declined",
        humanRequest: null,
        finishedAt: nowIso(),
      });
      this.emit(run.id, "error", "Declined by a person", { code: "declined" });
    } else {
      const text =
        action === "answer"
          ? (body.text ?? JSON.stringify(body.answers ?? {}))
          : action === "approve"
            ? "Approved"
            : "Control returned";
      this.update(run.id, {
        status: "success",
        result: { text },
        errorCode: null,
        humanRequest: null,
        finishedAt: nowIso(),
      });
      this.emit(run.id, "status", text);
    }
    void this.persist(env.id, run.id).catch(() => undefined);
    return this.db.getRun(run.id)!;
  }

  private kick(environmentId: string): void {
    const previous = this.tails.get(environmentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.executeNext(environmentId));
    this.tails.set(environmentId, next);
  }

  private async executeNext(environmentId: string): Promise<void> {
    const run = this.db.nextQueued(environmentId);
    if (!run) return;
    await this.execute(run.id);
  }

  private async execute(runId: string): Promise<void> {
    const initial = this.db.getRun(runId);
    if (!initial || initial.status === "cancelled") return;
    const env = this.environments.getById(initial.environmentId);
    if (!env) {
      this.fail(runId, "Environment disappeared before the run started.");
      return;
    }
    const adapter = this.options.adapter ?? resolveAdapter(initial.model);
    if (!adapter.available()) {
      this.fail(
        runId,
        `The ${adapter.name} adapter is not configured on this server (model ${initial.model}). Set its API key, or choose local/scripted. See /api/integrations for what each adapter needs.`,
      );
      return;
    }

    const ac = new AbortController();
    this.aborts.set(runId, ac);
    this.update(runId, { status: "running", startedAt: nowIso() });
    this.emit(runId, "status", "Run started");

    try {
      const session = await this.sessions.ensure(env);
      this.update(runId, { sessionId: session.record.id });
      const skills = new FilesystemSkills(env.paths.skills);
      const listed = await skills.list();
      const integrations = integrationsForEnvironment(env.config);
      const enabled = [
        integrations.secrets ? `credentials via ${integrations.secrets.name}` : null,
        integrations.mail ? `mailbox via ${integrations.mail.name}` : null,
        integrations.payments ? `payments via ${integrations.payments.name}` : null,
      ].filter(Boolean);
      if (enabled.length > 0) this.emit(runId, "log", `Integrations: ${enabled.join(", ")}`);
      const result = await adapter.run({
        prompt: initial.prompt,
        model: initial.model,
        computer: this.instrumentComputer(runId, session.runtime.computer),
        shell: session.runtime.shell,
        files: session.runtime.files,
        human: this.createHuman(runId),
        skills: this.wrapSkills(runId, skills),
        skillsPath: "/workstate/skills",
        environment: { id: env.id, name: env.name, config: env.config },
        run: {
          id: runId,
          sessionId: session.record.id,
          liveUrl: `${this.options.publicUrl}/live/${env.name}`,
        },
        systemPrompt: buildSystemPrompt({
          environmentName: env.name,
          skillsPath: "/workstate/skills",
          skills: listed,
        }),
        serverUrl: this.options.publicUrl,
        cdpUrl: session.runtime.cdpUrl,
        runtime: session.runtime.provider ?? { name: session.record.runtime },
        integrations,
        recipe: this.recipes.get(runId),
        log: (kind, message, data) => {
          if (kind === "skill_created") return;
          this.emit(runId, kind, message, data);
        },
        abortSignal: ac.signal,
      });
      const latest = this.db.getRun(runId);
      if (!latest || latest.status === "cancelled" || ac.signal.aborted) return;
      this.update(runId, { status: "success", result: normalizeResult(result), finishedAt: nowIso(), humanRequest: null, errorCode: null });
      this.emit(runId, "status", "Run finished");
    } catch (error) {
      const latest = this.db.getRun(runId);
      if (!latest || latest.status === "cancelled" || ac.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "run_failed";
      this.fail(runId, message, code);
    } finally {
      this.aborts.delete(runId);
      await this.persist(env.id, runId).catch(() => undefined);
      this.notify(runId);
    }
  }

  private fail(runId: string, message: string, code = "run_failed"): void {
    const latest = this.db.getRun(runId);
    if (!latest || isTerminalStatus(latest.status)) return;
    this.update(runId, { status: "failed", error: message, errorCode: code, finishedAt: nowIso(), humanRequest: null });
    this.emit(runId, "error", message, { code });
  }

  private createHuman(runId: string): Human {
    return {
      request: (input) => {
        const request: HumanRequestRecord = {
          id: createId("hum"),
          kind: input.kind,
          message: input.message,
          fields: input.fields,
          createdAt: nowIso(),
        };
        this.update(runId, { status: "waiting_for_human", humanRequest: request, errorCode: "needs_human" });
        this.emit(runId, "human", input.message, { ...request, code: "needs_human" });
        return new Promise((resolve, reject) => {
          const signal = this.aborts.get(runId)?.signal;
          const fail = () => {
            this.humanWaiters.delete(request.id);
            reject(Object.assign(new Error("Run cancelled"), { code: "cancelled" }));
          };
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener("abort", fail, { once: true });
          this.humanWaiters.set(request.id, (response) => {
            signal?.removeEventListener("abort", fail);
            resolve(response);
          });
        });
      },
    };
  }

  private wrapSkills(runId: string, skills: Skills): Skills {
    return {
      list: () => skills.list(),
      read: (name) => skills.read(name),
      write: async (draft) => {
        const saved = await skills.write(draft);
        this.emit(runId, "skill_created", `Saved skill ${saved.name}`, { name: saved.name });
        return saved;
      },
    };
  }

  private instrumentComputer(runId: string, computer: Computer): Computer {
    const flip = () => {
      const run = this.db.getRun(runId);
      if (run?.status === "resumed") {
        this.update(runId, { status: "running" });
        this.emit(runId, "status", "Agent resumed");
      }
    };
    const call = <T>(fn: () => T): T => {
      flip();
      return fn();
    };
    return {
      open: (url) => call(() => computer.open(url)),
      screenshot: () => call(() => computer.screenshot()),
      click: (x, y, button) => call(() => computer.click(x, y, button)),
      doubleClick: (x, y) => call(() => computer.doubleClick(x, y)),
      move: (x, y) => call(() => computer.move(x, y)),
      type: (text) => call(() => computer.type(text)),
      key: (key) => call(() => computer.key(key)),
      scroll: (dx, dy) => call(() => computer.scroll(dx, dy)),
      wait: (ms) => call(() => computer.wait(ms)),
      back: () => call(() => computer.back()),
      page: () => call(() => computer.page()),
      text: () => call(() => computer.text()),
      extract: (selector) => call(() => computer.extract(selector)),
      fill: (selector, text) => call(() => computer.fill(selector, text)),
    };
  }

  private must(id: string): RunRecord {
    const run = this.db.getRun(id);
    if (!run) throw httpError(404, "not_found", "Run not found.");
    return run;
  }

  private update(runId: string, patch: Partial<RunRecord>): RunRecord {
    const current = this.must(runId);
    const next: RunRecord = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
    this.db.updateRun(next);
    this.notify(runId);
    return next;
  }

  private emit(runId: string, kind: string, message: string, data?: unknown): void {
    this.db.insertEvent({ runId, kind, message, data, createdAt: nowIso() });
    this.notify(runId);
  }

  private notify(runId: string): void {
    const set = this.waiters.get(runId);
    if (!set) return;
    for (const waiter of [...set]) waiter();
  }

  private async persist(environmentId: string, runId: string): Promise<void> {
    const env = this.environments.getById(environmentId);
    const run = this.db.getRun(runId);
    if (!env || !run) return;
    const dir = path.join(env.paths.runs, runId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "run.json"), JSON.stringify({ run, events: this.db.listEvents(runId) }, null, 2));
  }
}

function normalizeResult(result: AdapterRunResult): AdapterRunResult {
  return {
    text: result.text,
    artifacts: result.artifacts && result.artifacts.length > 0 ? result.artifacts : undefined,
  };
}
