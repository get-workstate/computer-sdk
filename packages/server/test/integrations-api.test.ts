import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp, createRuntime } from "../dist/app.js";

async function boot() {
  const home = await mkdtemp(path.join(tmpdir(), "ws-api-"));
  return createApp({ home, headless: true, publicUrl: "http://127.0.0.1:0", port: 0 });
}

test("/api/health, /api/recipes, and /openapi.json describe the control plane", async () => {
  const { app, dispose } = await boot();
  try {
    const health = await app.request("/api/health");
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as { ok: boolean; version: string; defaultModel: string };
    assert.equal(healthBody.ok, true);
    assert.ok(healthBody.version);
    assert.ok(healthBody.defaultModel);

    const recipes = await app.request("/api/recipes");
    const recipeBody = (await recipes.json()) as { recipes: Array<{ id: string }> };
    assert.deepEqual(
      recipeBody.recipes.map((recipe) => recipe.id),
      ["download-latest-invoice", "summarize-hacker-news", "open-url"],
    );

    const spec = await app.request("/openapi.json");
    assert.equal(spec.status, 200);
    const document = (await spec.json()) as { paths: Record<string, unknown> };
    assert.ok(document.paths["/api/environments/{ref}/runs"]);

    const bad = await app.request("/api/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "probe" }),
    });
    assert.equal(bad.status, 201);
    const rejected = await app.request("/api/environments/probe/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Open it", recipe: "not-a-recipe" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(((await rejected.json()) as { code: string }).code, "invalid_recipe");
  } finally {
    await dispose();
  }
});

test("/api/integrations lists runtimes, services, and model adapters with configured status", async () => {
  const { app, dispose } = await boot();
  try {
    const response = await app.request("/api/integrations");
    assert.equal(response.status, 200);
    const body = (await response.json()) as { integrations: Array<{ id: string; kind: string; configured: boolean; select: string }>; configKeys: Record<string, string> };
    const ids = body.integrations.map((item) => item.id);
    for (const id of ["local", "docker", "anchor", "browserbase", "steel", "kernel", "e2b", "daytona", "1password", "agentmail", "agentcard", "openai", "anthropic", "gemini", "stagehand", "browser-use", "browser-harness"]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    assert.ok(body.configKeys.runtime);
    assert.equal(body.integrations.find((item) => item.id === "local")?.configured, true);
  } finally {
    await dispose();
  }
});

test("environment config selects the runtime and rejects unknown values", async () => {
  const { app, ctx, dispose } = await boot();
  try {
    const bad = await app.request("/api/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "shop", config: { runtime: "cloudflare" } }),
    });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /Unknown runtime/);

    const created = await app.request("/api/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "shop", config: { runtime: "anchor", credentials: "op://Private/Shop", model: "gemini/gemini-3.8-flash" } }),
    });
    assert.equal(created.status, 201);
    const env = ctx.environments.getByName("shop")!;
    assert.equal(env.config.runtime, "anchor");
    assert.equal(createRuntime(ctx.config, env).name, "anchor");
    assert.equal(createRuntime(ctx.config, { config: {} }).name, "local");

    const run = ctx.runs.create(env, { prompt: "noop" });
    assert.equal(run.model, "gemini/gemini-3.8-flash", "runs default to the environment's model");
    ctx.runs.cancel(run.id);

    const patched = await app.request(`/api/environments/shop`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { runtime: "local", credentials: null, mailbox: "inbox_1" } }),
    });
    assert.equal(patched.status, 200);
    const updated = ctx.environments.getByName("shop")!;
    assert.deepEqual(updated.config, { runtime: "local", model: "gemini/gemini-3.8-flash", mailbox: "inbox_1" });

    const badRef = await app.request(`/api/environments/shop`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { credentials: "Private/Shop" } }),
    });
    assert.equal(badRef.status, 400);
  } finally {
    await dispose();
  }
});

test("a run on an unconfigured hosted runtime fails with the setup error, not a fake success", async () => {
  const saved = process.env.STEEL_API_KEY;
  delete process.env.STEEL_API_KEY;
  const { ctx, dispose } = await boot();
  try {
    const env = ctx.environments.getOrCreate("remote", { runtime: "steel" });
    const run = ctx.runs.create(env, { prompt: "open https://example.com", model: "local/scripted" });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && ctx.runs.get(run.id).status !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const final = ctx.runs.get(run.id);
    assert.equal(final.status, "failed");
    assert.match(final.error ?? "", /STEEL_API_KEY/);
    assert.equal(ctx.sessions.snapshot(env.id), null);
  } finally {
    if (saved !== undefined) process.env.STEEL_API_KEY = saved;
    await dispose();
  }
});
