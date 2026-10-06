import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DockerRuntimeProvider } from "@workstate/runtime-docker";
import { LocalRuntimeProvider } from "@workstate/runtime-local";
import type { RuntimeProvider } from "@workstate/sdk";
import { Hono } from "hono";
import { registerApi } from "./api.js";
import { loadConfig, VERSION, type Config } from "./config.js";
import { Db } from "./db.js";
import { demoShopApp } from "./demo-shop.js";
import { EnvironmentStore } from "./environments.js";
import { RunManager } from "./runs.js";
import { SessionManager } from "./sessions.js";

export interface AppContext {
  config: Config;
  db: Db;
  environments: EnvironmentStore;
  sessions: SessionManager;
  runs: RunManager;
  webUiDir: string | null;
}

export function findWebUiDir(explicit?: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    process.env.WORKSTATE_WEB_UI_DIR,
    path.resolve("packages/web-ui/dist"),
    path.resolve(here, "../../web-ui/dist"),
    path.resolve(here, "../../../web-ui/dist"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

export function createRuntime(config: Config): RuntimeProvider {
  if ((process.env.WORKSTATE_RUNTIME ?? "local") === "docker") return new DockerRuntimeProvider();
  return new LocalRuntimeProvider(config.headless);
}

export function createApp(configInput?: Partial<Config>): { app: Hono; ctx: AppContext; dispose: () => Promise<void> } {
  const config = loadConfig(configInput);
  mkdirSync(config.home, { recursive: true });
  const db = new Db(path.join(config.home, "workstate.sqlite"));
  db.failInterruptedRuns("Interrupted because the Workstate server restarted.");
  db.stopAllRunningSessions();
  const environments = new EnvironmentStore(db, config);
  const sessions = new SessionManager(db, createRuntime(config), config.headless);
  const runs = new RunManager(db, environments, sessions, { publicUrl: config.publicUrl });
  const ctx: AppContext = {
    config,
    db,
    environments,
    sessions,
    runs,
    webUiDir: findWebUiDir(config.webUiDir),
  };

  const app = new Hono();
  app.onError((error, c) => {
    const extra = error as unknown as { status?: number; code?: string };
    const status = typeof extra.status === "number" ? extra.status : 500;
    const code = typeof extra.code === "string" ? extra.code : "internal";
    if (status >= 500) console.error(error);
    return c.json({ error: error.message || "Request failed", code }, status as 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, version: VERSION }));
  registerApi(app, ctx);
  app.route("/demo", demoShopApp());
  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api")) return c.json({ error: "Not found", code: "not_found" }, 404);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("Not found", 404);
    return serveUi(c, ctx.webUiDir);
  });

  return {
    app,
    ctx,
    dispose: async () => {
      await sessions.stopAll();
      db.close();
    },
  };
}

async function serveUi(c: { req: { path: string }; body: (data: Uint8Array, status: 200, headers: Record<string, string>) => Response; text: (body: string, status?: number) => Response }, webUiDir: string | null): Promise<Response> {
  if (!webUiDir) {
    return c.text("Workstate API is running. Build the web UI with pnpm build to use the console.\n", 503);
  }
  const requested = decodeURIComponent((c.req.path.split("?")[0] ?? "/"));
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const root = path.resolve(webUiDir);
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return c.text("Bad path", 400);
  try {
    const info = await stat(file);
    if (info.isFile()) {
      const body = await readFile(file);
      return c.body(body, 200, {
        "content-type": mime(file),
        "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
      });
    }
  } catch {
    // Missing files fall through to the SPA shell.
  }
  try {
    const html = await readFile(path.join(root, "index.html"));
    return c.body(html, 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  } catch {
    return c.text("Web UI build is missing index.html.\n", 503);
  }
}

function mime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
