import { CdpBrowserRuntimeProvider, DEFAULT_VIEWPORT, type RemoteBrowser } from "@workstate/runtime-local";
import type { RuntimeEnvironment, RuntimeProvider } from "@workstate/sdk";
import { env, jsonRequest, requireEnv } from "../setup.js";

/**
 * Hosted Chromium providers. Each one creates a cloud browser session, hands back its CDP
 * endpoint and live view, and ends the session when the Workstate session stops. Shell and
 * files stay on the Workstate host inside the environment directory.
 */

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Anchor Browser — https://docs.anchorbrowser.io
// ---------------------------------------------------------------------------

const ANCHOR_API = "https://api.anchorbrowser.io";

interface AnchorSession {
  data?: { id?: string; cdp_url?: string; live_view_url?: string };
}

export async function openAnchorBrowser(environment: RuntimeEnvironment): Promise<RemoteBrowser> {
  const { ANCHOR_API_KEY } = requireEnv("Anchor Browser", ["ANCHOR_API_KEY"], "https://docs.anchorbrowser.io/quickstart/create-session");
  const headers = { "anchor-api-key": ANCHOR_API_KEY, "content-type": "application/json" };
  const profile = configString(environment.config, "anchorProfile") ?? env("WORKSTATE_ANCHOR_PROFILE");
  const body: Record<string, unknown> = {
    session: { timeout: { max_duration: 60, idle_timeout: 10 } },
    browser: {
      headless: { active: environment.headless },
      viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
      ...(profile ? { profile: { name: profile, persist: true } } : {}),
    },
  };
  const created = await jsonRequest<AnchorSession>("Anchor Browser", `${ANCHOR_API}/v1/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const id = created.data?.id;
  const cdpUrl = created.data?.cdp_url;
  if (!id || !cdpUrl) throw new Error("Anchor Browser did not return a session id and cdp_url.");
  return {
    cdpUrl,
    liveViewUrl: created.data?.live_view_url,
    stop: async () => {
      await fetch(`${ANCHOR_API}/v1/sessions/${encodeURIComponent(id)}`, { method: "DELETE", headers }).catch(() => undefined);
    },
  };
}

export const anchorRuntime: RuntimeProvider = new CdpBrowserRuntimeProvider("anchor", openAnchorBrowser);

// ---------------------------------------------------------------------------
// Browserbase — https://docs.browserbase.com
// ---------------------------------------------------------------------------

const BROWSERBASE_API = "https://api.browserbase.com";

interface BrowserbaseSession {
  id?: string;
  connectUrl?: string;
}

export async function openBrowserbase(environment: RuntimeEnvironment): Promise<RemoteBrowser> {
  const { BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID } = requireEnv(
    "Browserbase",
    ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    "https://docs.browserbase.com/reference/api/create-a-session",
  );
  const headers = { "x-bb-api-key": BROWSERBASE_API_KEY, "content-type": "application/json" };
  const contextId = configString(environment.config, "browserbaseContextId") ?? env("WORKSTATE_BROWSERBASE_CONTEXT_ID");
  const body: Record<string, unknown> = {
    projectId: BROWSERBASE_PROJECT_ID,
    keepAlive: true,
    browserSettings: {
      viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
      ...(contextId ? { context: { id: contextId, persist: true } } : {}),
    },
  };
  const created = await jsonRequest<BrowserbaseSession>("Browserbase", `${BROWSERBASE_API}/v1/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!created.id || !created.connectUrl) throw new Error("Browserbase did not return a session id and connectUrl.");
  const id = created.id;
  return {
    cdpUrl: created.connectUrl,
    liveViewUrl: `https://www.browserbase.com/sessions/${id}`,
    stop: async () => {
      await fetch(`${BROWSERBASE_API}/v1/sessions/${encodeURIComponent(id)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status: "REQUEST_RELEASE", projectId: BROWSERBASE_PROJECT_ID }),
      }).catch(() => undefined);
    },
  };
}

export const browserbaseRuntime: RuntimeProvider = new CdpBrowserRuntimeProvider("browserbase", openBrowserbase);

// ---------------------------------------------------------------------------
// Steel — https://docs.steel.dev
// ---------------------------------------------------------------------------

interface SteelSession {
  id?: string;
  websocketUrl?: string;
  sessionViewerUrl?: string;
}

export async function openSteel(environment: RuntimeEnvironment): Promise<RemoteBrowser> {
  const { STEEL_API_KEY } = requireEnv("Steel", ["STEEL_API_KEY"], "https://docs.steel.dev/overview/sessions-api/quickstart");
  const base = env("STEEL_API_URL") ?? "https://api.steel.dev";
  const headers = { "steel-api-key": STEEL_API_KEY, "content-type": "application/json" };
  void environment;
  const created = await jsonRequest<SteelSession>("Steel", `${base}/v1/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      timeout: 60 * 60 * 1000,
      inactivityTimeout: 10 * 60 * 1000,
      dimensions: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
    }),
  });
  if (!created.id || !created.websocketUrl) throw new Error("Steel did not return a session id and websocketUrl.");
  const id = created.id;
  const joiner = created.websocketUrl.includes("?") ? "&" : "?";
  return {
    cdpUrl: `${created.websocketUrl}${joiner}apiKey=${encodeURIComponent(STEEL_API_KEY)}`,
    liveViewUrl: created.sessionViewerUrl,
    stop: async () => {
      await fetch(`${base}/v1/sessions/${encodeURIComponent(id)}/release`, { method: "POST", headers }).catch(() => undefined);
    },
  };
}

export const steelRuntime: RuntimeProvider = new CdpBrowserRuntimeProvider("steel", openSteel);

// ---------------------------------------------------------------------------
// Kernel — https://www.kernel.sh/docs
// ---------------------------------------------------------------------------

const KERNEL_API = "https://api.onkernel.com";

interface KernelBrowser {
  session_id?: string;
  cdp_ws_url?: string;
  browser_live_view_url?: string;
}

export async function openKernel(environment: RuntimeEnvironment): Promise<RemoteBrowser> {
  const { KERNEL_API_KEY } = requireEnv("Kernel", ["KERNEL_API_KEY"], "https://www.kernel.sh/docs/api-reference/browsers/create-a-browser-session");
  const headers = { authorization: `Bearer ${KERNEL_API_KEY}`, "content-type": "application/json" };
  // Kernel profiles must exist before they can be loaded; pass one to keep logins between sessions.
  const profile = configString(environment.config, "kernelProfile") ?? env("WORKSTATE_KERNEL_PROFILE");
  const created = await jsonRequest<KernelBrowser>("Kernel", `${KERNEL_API}/browsers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      headless: environment.headless,
      stealth: false,
      timeout_seconds: 60 * 60,
      viewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
      ...(profile ? { profile: { name: profile, save_changes: true } } : {}),
    }),
  });
  if (!created.session_id || !created.cdp_ws_url) throw new Error("Kernel did not return a session_id and cdp_ws_url.");
  const id = created.session_id;
  return {
    cdpUrl: created.cdp_ws_url,
    liveViewUrl: created.browser_live_view_url,
    stop: async () => {
      await fetch(`${KERNEL_API}/browsers/${encodeURIComponent(id)}`, { method: "DELETE", headers }).catch(() => undefined);
    },
  };
}

export const kernelRuntime: RuntimeProvider = new CdpBrowserRuntimeProvider("kernel", openKernel);
