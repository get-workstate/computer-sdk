export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "human_controlling"
  | "resumed"
  | "success"
  | "failed"
  | "cancelled";

export interface EnvironmentPaths {
  root: string;
  files: string;
  skills: string;
  browserProfile: string;
  runs: string;
}

export interface EnvironmentRecord {
  id: string;
  name: string;
  createdAt: string;
  config: Record<string, unknown>;
  paths: EnvironmentPaths;
}

export interface Skill {
  name: string;
  description: string;
  tags: string[];
  procedure: string;
  createdAt: string;
  updatedAt: string;
}

export interface HumanRequest {
  id: string;
  kind: "login" | "approval" | "input" | "takeover";
  message: string;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  environmentId: string;
  environmentName: string;
  sessionId: string | null;
  prompt: string;
  model: string;
  status: RunStatus;
  error: string | null;
  result: { text: string; artifacts?: string[] } | null;
  humanRequest: HumanRequest | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  kind: string;
  message: string;
  createdAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
}

export interface EnvironmentDetail extends EnvironmentRecord {
  skills: Skill[];
  session: { id: string; status: string } | null;
  currentRun: RunRecord | null;
}

export interface AdapterInfo {
  id: string;
  name: string;
  label: string;
  description: string;
  available: boolean;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const SUGGESTED_TASKS = [
  {
    label: "Download latest invoice",
    env: "acme",
    prompt: "Download the latest invoice from the demo shop",
  },
  {
    label: "Summarize Hacker News",
    env: "research-bot",
    prompt: "Summarize the front page of Hacker News",
  },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("The control plane didn't answer.", 0, "server_unreachable");
  }
  const text = await response.text();
  let data: { error?: string; code?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string; code?: string };
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) {
    throw new ApiError(data?.error || response.statusText || "Request failed", response.status, data?.code ?? "http_error");
  }
  return data as T;
}

export function wsUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export const api = {
  adapters: () => request<{ defaultModel: string; adapters: AdapterInfo[] }>("/api/adapters"),
  environments: () => request<EnvironmentRecord[]>("/api/environments"),
  environment: (name: string) => request<EnvironmentDetail>(`/api/environments/${encodeURIComponent(name)}`),
  createEnvironment: (name: string) => request<EnvironmentRecord>("/api/environments", { method: "POST", body: JSON.stringify({ name }) }),
  createRun: (name: string, prompt: string, model: string) =>
    request<RunRecord>(`/api/environments/${encodeURIComponent(name)}/runs`, {
      method: "POST",
      body: JSON.stringify({ prompt, model }),
    }),
  runs: (env?: string) => request<RunRecord[]>(`/api/runs${env ? `?env=${encodeURIComponent(env)}` : ""}`),
  run: (id: string) => request<{ run: RunRecord; events: RunEvent[] }>(`/api/runs/${encodeURIComponent(id)}`),
  cancel: (id: string) => request<RunRecord>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  files: (name: string, path: string) =>
    request<{ path: string; entries: FileEntry[] }>(
      `/api/environments/${encodeURIComponent(name)}/files?path=${encodeURIComponent(path)}`,
    ),
  fileContent: (name: string, filePath: string) =>
    request<{ path: string; content: string; truncated: boolean }>(
      `/api/environments/${encodeURIComponent(name)}/files/content?path=${encodeURIComponent(filePath)}`,
    ),
  respond: (
    name: string,
    body: { action: string; requestId?: string; answers?: Record<string, string>; text?: string },
  ) =>
    request<{ ok: true; run: RunRecord }>(`/api/environments/${encodeURIComponent(name)}/human`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
