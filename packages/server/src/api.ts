import { ENVIRONMENT_CONFIG_KEYS, describeIntegrations } from "@workstate/integrations";
import { LocalFiles, LocalShell } from "@workstate/runtime-local";
import { defaultModel, describeAdapters, describeRecipes, listAdapters, RECIPE_IDS } from "@workstate/model-adapters";
import { VERSION } from "./config.js";
import { openApiDocument } from "./openapi.js";
import type { HumanKind } from "@workstate/sdk";
import type { Context, Hono } from "hono";
import type { AppContext } from "./app.js";
import { httpError } from "./errors.js";
import { FilesystemSkills } from "./skills.js";

const MODEL_CATALOG = [
  {
    id: "local/scripted",
    name: "local",
    label: "Local scripted",
    description: "No API key. Demo shop invoices, Hacker News, and explicit URLs.",
  },
  {
    id: "openai/computer-use-preview",
    name: "openai",
    label: "OpenAI computer use",
    description: "Responses API computer_use_preview. Needs OPENAI_API_KEY.",
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    name: "anthropic",
    label: "Anthropic computer use",
    description: "Messages API computer use. Needs ANTHROPIC_API_KEY.",
  },
  {
    id: "gemini/gemini-3.8-flash",
    name: "gemini",
    label: "Gemini computer use",
    description: "Gemini API computer_use tool. Needs GEMINI_API_KEY.",
  },
  {
    id: "stagehand/openai/computer-use-preview",
    name: "stagehand",
    label: "Stagehand agent",
    description: "Browserbase Stagehand attached to the environment browser. Needs a model key and the stagehand package.",
  },
  {
    id: "browser-use/cloud",
    name: "browser-use",
    label: "Browser Use Cloud",
    description: "Runs in Browser Use's hosted browser. Needs BROWSER_USE_API_KEY.",
  },
  {
    id: "browser-harness/anthropic/claude-sonnet-4-5",
    name: "browser-harness",
    label: "browser-harness",
    description: "browser-harness CLI on the environment browser, driven by a chat model. Needs the CLI and a model key.",
  },
];

export function registerApi(app: Hono, ctx: AppContext): void {
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
  });

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      version: VERSION,
      defaultModel: defaultModel(),
    }),
  );

  app.get("/api/recipes", (c) =>
    c.json({
      model: "local/scripted",
      precedence:
        "An explicit http(s) URL selects open-url unless the prompt also asks to download an invoice. A recipe id on the run skips keyword matching. A saved skill still wins when no recipe id is set.",
      modelPrecedence: "The model on the run overrides the environment config.model, which overrides the server default.",
      recipes: describeRecipes(),
    }),
  );

  app.get("/api/openapi.json", (c) => c.json(openApiDocument()));
  app.get("/openapi.json", (c) => c.json(openApiDocument()));

  app.get("/api/adapters", (c) => {
    const available = new Map(listAdapters().map((adapter) => [adapter.name, adapter.available()]));
    return c.json({
      defaultModel: defaultModel(),
      adapters: MODEL_CATALOG.map((model) => ({ ...model, available: available.get(model.name) ?? false })),
    });
  });

  app.get("/api/integrations", (c) =>
    c.json({
      integrations: [...describeIntegrations(), ...describeAdapters()],
      configKeys: ENVIRONMENT_CONFIG_KEYS,
    }),
  );

  app.get("/api/environments", (c) => c.json(ctx.environments.list()));

  app.post("/api/environments", async (c) => {
    const body = await readJson<{ name?: string; config?: Record<string, unknown> }>(c);
    if (!body.name?.trim()) throw httpError(400, "invalid_name", "Environment name is required.");
    return c.json(ctx.environments.getOrCreate(body.name.trim(), body.config ?? {}), 201);
  });

  app.patch("/api/environments/:ref", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const body = await readJson<{ config?: Record<string, unknown> }>(c);
    if (!body.config || typeof body.config !== "object") throw httpError(400, "invalid_config", "config object is required.");
    const updated = ctx.environments.updateConfig(env.id, body.config);
    if (body.config.runtime !== undefined && body.config.runtime !== env.config.runtime) {
      // The next run starts on the new runtime.
      await ctx.sessions.stop(env.id);
    }
    return c.json(updated);
  });

  app.get("/api/environments/:ref", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const skills = await new FilesystemSkills(env.paths.skills).list();
    return c.json({
      ...env,
      skills,
      session: ctx.sessions.snapshot(env.id),
      currentRun: ctx.runs.currentForEnvironment(env.id),
    });
  });

  app.get("/api/environments/:ref/skills", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    return c.json(await new FilesystemSkills(env.paths.skills).list());
  });

  app.get("/api/environments/:ref/files", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const virtualPath = c.req.query("path") || "/workspace";
    const entries = await new LocalFiles(roots(env)).list(virtualPath);
    return c.json({ path: virtualPath, entries });
  });

  app.get("/api/environments/:ref/files/content", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const virtualPath = c.req.query("path");
    if (!virtualPath) throw httpError(400, "invalid_path", "path is required.");
    const content = await new LocalFiles(roots(env)).read(virtualPath);
    const truncated = content.length > 200_000;
    return c.json({ path: virtualPath, content: truncated ? content.slice(0, 200_000) : content, truncated });
  });

  app.post("/api/environments/:ref/exec", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const body = await readJson<{ command?: string; timeoutMs?: number }>(c);
    if (!body.command?.trim()) throw httpError(400, "invalid_command", "command is required.");
    const timeoutMs = Math.min(Math.max(body.timeoutMs ?? 15_000, 1000), 60_000);
    const result = await new LocalShell(roots(env)).exec(body.command, { timeoutMs });
    return c.json(result);
  });

  app.post("/api/environments/:ref/sessions", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const session = await ctx.sessions.ensure(env);
    return c.json(session.record, 201);
  });

  app.delete("/api/environments/:ref/sessions", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    await ctx.sessions.stop(env.id);
    return c.json({ ok: true });
  });

  app.post("/api/environments/:ref/runs", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const body = await readJson<{ prompt?: string; model?: string; recipe?: string }>(c);
    if (!body.prompt?.trim()) throw httpError(400, "invalid_prompt", "A run needs a prompt.");
    const recipe = body.recipe?.trim();
    if (recipe && !RECIPE_IDS.includes(recipe as (typeof RECIPE_IDS)[number])) {
      throw httpError(400, "invalid_recipe", `Unknown recipe. Use one of: ${RECIPE_IDS.join(", ")}.`);
    }
    return c.json(ctx.runs.create(env, { prompt: body.prompt, model: body.model, recipe }), 201);
  });

  app.post("/api/environments/:ref/human-requests", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const body = await readJson<{ kind?: HumanKind; message?: string }>(c);
    const kind = body.kind ?? "approval";
    if (!["login", "approval", "input", "takeover"].includes(kind)) {
      throw httpError(400, "bad_action", "Unknown request kind.");
    }
    if (!body.message?.trim()) throw httpError(400, "invalid_prompt", "A request needs a message.");
    return c.json(ctx.runs.createHumanRequest(env, { kind, message: body.message }), 201);
  });

  app.post("/api/environments/:ref/human", async (c) => {
    const env = requireEnv(ctx, c.req.param("ref"));
    const body = await readJson<{
      action?: "take_control" | "return" | "approve" | "decline" | "answer" | "stop";
      requestId?: string;
      answers?: Record<string, string>;
      text?: string;
    }>(c);
    if (!body.action) throw httpError(400, "bad_action", "action is required.");
    const run = ctx.runs.resolveHuman(env, {
      action: body.action,
      requestId: body.requestId,
      answers: body.answers,
      text: body.text,
    });
    return c.json({ ok: true, run });
  });

  app.get("/api/runs", (c) => {
    const envName = c.req.query("env");
    const env = envName ? requireEnv(ctx, envName) : null;
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json(ctx.runs.list({ environmentId: env?.id, limit: Number.isFinite(limit) ? limit : 50 }));
  });

  app.get("/api/runs/:id", async (c) => {
    const id = c.req.param("id");
    const after = Number(c.req.query("after") ?? 0);
    if (c.req.query("wait") === "1") {
      return c.json(await ctx.runs.waitForChange(id, Number.isFinite(after) ? after : 0));
    }
    return c.json({ run: ctx.runs.get(id), events: ctx.runs.events(id) });
  });

  app.post("/api/runs/:id/cancel", (c) => c.json(ctx.runs.cancel(c.req.param("id"))));
}

function requireEnv(ctx: AppContext, ref: string) {
  const env = ctx.environments.resolve(ref);
  if (!env) throw httpError(404, "not_found", `No environment named ${ref}.`);
  return env;
}

function roots(env: { paths: { files: string; skills: string } }) {
  return { files: env.paths.files, skills: env.paths.skills };
}

async function readJson<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw httpError(400, "invalid_json", "Expected a JSON body.");
  }
}
