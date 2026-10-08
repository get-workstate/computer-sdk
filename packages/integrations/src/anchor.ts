import { env, jsonRequest, requireEnv } from "./setup.js";

const DEFAULT_ANCHOR_API_URL = "https://api.anchorbrowser.io";

export interface AnchorTaskMemory {
  taskId: string;
  name: string;
  description: string;
  tags: string[];
  taskVersionId?: string;
  toolId?: string;
}

export interface AnchorDemonstration {
  session_id: string;
  status?: "recording" | "processing" | "completed" | "failed" | "stopped";
  share_url?: string;
  live_view_url?: string;
  share_expires_at?: string;
  task_id?: string;
  task_version_id?: string;
  tool_id?: string;
  error?: string;
}

function anchorConfig(): { base: string; headers: Record<string, string> } {
  const { ANCHOR_API_KEY } = requireEnv(
    "Anchor Browser",
    ["ANCHOR_API_KEY"],
    "https://docs.anchorbrowser.io/quickstart/agent-access",
  );
  return {
    base: env("ANCHOR_API_URL") ?? DEFAULT_ANCHOR_API_URL,
    headers: { "anchor-api-key": ANCHOR_API_KEY, "content-type": "application/json" },
  };
}

function unwrap<T>(value: T | { data?: T }): T {
  return value && typeof value === "object" && "data" in value && value.data ? value.data : (value as T);
}

export async function createAnchorDemonstration(input: {
  taskName: string;
  taskDescription: string;
  identityId?: string;
  userName?: string;
  startUrl?: string;
}): Promise<AnchorDemonstration> {
  const { base, headers } = anchorConfig();
  const response = await jsonRequest<AnchorDemonstration | { data?: AnchorDemonstration }>(
    "Anchor Browser",
    `${base}/v1/demonstrations/`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_name: input.taskName,
        task_description: input.taskDescription,
        ...(input.identityId ? { identity_id: input.identityId } : {}),
        ...(input.userName ? { user_name: input.userName } : {}),
        ...(input.startUrl ? { session_config: { browser: { initial_url: input.startUrl } } } : {}),
      }),
    },
  );
  return unwrap(response);
}

export async function getAnchorDemonstration(sessionId: string): Promise<AnchorDemonstration> {
  const { base, headers } = anchorConfig();
  const response = await jsonRequest<AnchorDemonstration | { data?: AnchorDemonstration }>(
    "Anchor Browser",
    `${base}/v1/demonstrations/${encodeURIComponent(sessionId)}`,
    { headers },
  );
  return unwrap(response);
}

export async function reauthenticateAnchorIdentity(identityId: string): Promise<Record<string, unknown>> {
  const { base, headers } = anchorConfig();
  const response = await jsonRequest<Record<string, unknown> | { data?: Record<string, unknown> }>(
    "Anchor Browser",
    `${base}/v1/identities/${encodeURIComponent(identityId)}/reauthenticate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ sync: true }),
    },
  );
  return unwrap(response);
}

export function anchorConfigured(): boolean {
  return Boolean(env("ANCHOR_API_KEY"));
}
