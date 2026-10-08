import type { AdapterRunInput, CuaAdapter } from "@workstate/sdk";

const ANCHOR_API = process.env.ANCHOR_API_URL ?? "https://api.anchorbrowser.io";

interface AnchorTaskMemory {
  taskId: string;
  name: string;
  description?: string;
  tags: string[];
  taskVersionId?: string;
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1));
}

export function matchAnchorTask(prompt: string, config?: Record<string, unknown>): AnchorTaskMemory | null {
  const tasks = Array.isArray(config?.anchorTasks) ? (config.anchorTasks as AnchorTaskMemory[]) : [];
  const tokens = words(prompt);
  let best: { task: AnchorTaskMemory; score: number } | null = null;
  for (const task of tasks) {
    if (!task?.taskId || !Array.isArray(task.tags)) continue;
    const score = task.tags.filter((tag) => tokens.has(tag.toLowerCase())).length;
    if (score < 2) continue;
    if (!best || score > best.score) best = { task, score };
  }
  return best?.task ?? null;
}

async function anchorRequest(path: string, body: unknown): Promise<Record<string, unknown>> {
  const key = process.env.ANCHOR_API_KEY;
  if (!key) {
    throw codedError(
      "integration_not_configured",
      "Anchor Browser is not configured. Set ANCHOR_API_KEY; Workstate otherwise falls back to local Chromium.",
    );
  }
  const response = await fetch(`${ANCHOR_API}${path}`, {
    method: "POST",
    headers: { "anchor-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "integration_not_configured" : "anchor_task_failed";
    throw codedError(code, `Anchor Browser returned ${response.status}. ${text.slice(0, 300)}`.trim());
  }
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function unwrap(value: Record<string, unknown>): Record<string, unknown> {
  return value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : value;
}

function resultText(result: Record<string, unknown>, fallback: string): string {
  const value = unwrap(result);
  for (const key of ["result", "output", "message"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (candidate && typeof candidate === "object") return JSON.stringify(candidate);
  }
  return fallback;
}

async function runNativeTask(input: AdapterRunInput, task: AnchorTaskMemory, sessionId: string) {
  input.log("plan", `Reusing Anchor task ${task.name}`, {
    source: "anchor_task",
    name: task.name,
    taskId: task.taskId,
  });
  const config = input.environment.config ?? {};
  const response = await anchorRequest(`/v2/tasks/${encodeURIComponent(task.taskId)}/run`, {
    input_params: { prompt: input.prompt },
    session_id: sessionId,
    cleanup_sessions: false,
    sync: true,
    ...(task.taskVersionId ? { version_id: task.taskVersionId } : {}),
    ...(typeof config.anchorIdentityId === "string" ? { identity_id: config.anchorIdentityId } : {}),
    identity_skip_validation: config.anchorIdentitySkipValidation !== false,
  });
  const value = unwrap(response);
  const status = value.status;
  if (status === "failure" || status === "timeout" || status === "cancelled") {
    throw codedError("anchor_task_failed", String(value.error ?? `Anchor task ended with ${status}.`));
  }
  return {
    text: resultText(response, `Anchor task ${task.name} completed.`),
  };
}

async function runAnchorAgent(input: AdapterRunInput, sessionId: string) {
  input.log("plan", "Using Anchor web task", { source: "anchor_agent", name: "perform-web-task" });
  const response = await anchorRequest(
    `/v1/tools/perform-web-task?sessionId=${encodeURIComponent(sessionId)}`,
    {
      prompt: input.prompt,
      human_intervention: true,
    },
  );
  return {
    text: resultText(response, "Anchor web task completed."),
  };
}

export const anchorAdapter: CuaAdapter = {
  name: "anchor",
  description: "Anchor's native web agent plus reusable Automation Tasks learned from manual demonstrations.",
  available: () => Boolean(process.env.ANCHOR_API_KEY),
  async run(input) {
    if (input.runtime?.name !== "anchor" || !input.runtime.sessionId) {
      throw codedError(
        "anchor_runtime_required",
        'The anchor model requires the Anchor runtime. Set config.runtime = "anchor" or leave runtime unset when ANCHOR_API_KEY is configured.',
      );
    }
    const memory = matchAnchorTask(input.prompt, input.environment.config);
    return memory
      ? runNativeTask(input, memory, input.runtime.sessionId)
      : runAnchorAgent(input, input.runtime.sessionId);
  },
};
