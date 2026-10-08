import assert from "node:assert/strict";
import test from "node:test";
import type { AdapterRunInput, Computer, Files, Human, Skill, Skills } from "@workstate/sdk";
import { interpolate, isLoginPage, parseProcedure } from "../dist/skill-steps.js";
import { matchSkill, planRun, resolveRecipe, scriptedAdapter } from "../dist/scripted.js";

test("interpolates variables, indexes, title, url, and date", () => {
  assert.equal(interpolate("{{orderId[0]}}", { orderId: ["INV-1042", "INV-1"] }), "INV-1042");
  assert.equal(interpolate("{{titles}}", { titles: ["One", "Two"] }), "One\nTwo");
  assert.equal(interpolate("{{title}} {{url}} {{date}}", { title: "Orders", url: "http://shop", date: "2026-10-06" }), "Orders http://shop 2026-10-06");
});

test("detects login pages without flagging ordinary pages", () => {
  assert.equal(isLoginPage({ passwordFields: 1 }), true);
  assert.equal(isLoginPage({ url: "https://example.com/login" }), true);
  assert.equal(isLoginPage({ title: "Sign in · Northwind Supply" }), true);
  assert.equal(isLoginPage({ url: "https://example.com/orders", title: "Orders" }), false);
});

test("matches a skill only when at least two tags overlap", () => {
  const skill: Skill = {
    name: "download-latest-invoice",
    description: "invoice",
    tags: ["invoice", "download", "shop"],
    procedure: "[]",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.equal(matchSkill([skill], "please download the invoice")?.name, skill.name);
  assert.equal(matchSkill([{ ...skill, tags: ["invoice"] }], "please download the invoice"), null);
});

test("resolveRecipe knows the demo shop, Hacker News, explicit URLs, and nothing else", () => {
  const ctx = { serverUrl: "http://127.0.0.1:4780" };
  const invoice = resolveRecipe("Download the latest invoice from the demo shop", ctx);
  assert.equal(invoice?.name, "download-latest-invoice");
  assert.equal(invoice?.persist, true);
  assert.equal(invoice?.steps[0] && invoice.steps[0].op === "open" ? invoice.steps[0].url : "", "{{serverUrl}}/demo/shop/orders");
  assert.equal(resolveRecipe("Summarize the front page of Hacker News", ctx)?.name, "summarize-hacker-news");
  const explicit = resolveRecipe("Open https://example.com/report and save it", ctx);
  assert.equal(explicit?.name, "open-url");
  assert.equal(explicit?.persist, false);
  assert.equal(resolveRecipe("Open http://127.0.0.1:4780/demo/shop and inspect the demo shop", ctx)?.name, "open-url");
  assert.equal(resolveRecipe("Download the invoice at https://example.com/invoice.txt", ctx)?.name, "download-latest-invoice");
  assert.equal(resolveRecipe("Compose a symphony", ctx), null);
  assert.equal(resolveRecipe("Open the status page", { ...ctx, recipe: "open-url" }), null);
  assert.equal(resolveRecipe("Anything", { ...ctx, recipe: "summarize-hacker-news" })?.name, "summarize-hacker-news");
  assert.ok(invoice);
  const parsed = parseProcedure(JSON.stringify(invoice.steps));
  assert.equal(parsed.length, invoice.steps.length);
});

test("invoice recipe asks a person on the login wall, then saves the invoice and the skill", async () => {
  const harness = createHarness(false);
  const skills = memorySkills();
  const first = await scriptedAdapter.run(input("Download the latest invoice from the demo shop", harness, skills.skills));
  assert.match(first.text, /INV-1042/);
  assert.deepEqual(first.artifacts, ["/workspace/invoices/INV-1042.txt"]);
  assert.match(harness.written.get("/workspace/invoices/INV-1042.txt") ?? "", /INV-1042/);
  assert.equal(harness.humanCalls, 1);
  assert.equal(skills.store.length, 1);
  assert.equal(skills.store[0]?.name, "download-latest-invoice");

  const again = createHarness(true);
  const second = await scriptedAdapter.run(input("Download the latest invoice from the demo shop", again, skills.skills));
  assert.equal(again.humanCalls, 0);
  assert.match(second.text, /INV-1042/);
  assert.equal(skills.store.length, 1);
  assert.equal(planRun("Download the latest invoice from the demo shop", skills.store, { serverUrl: "http://127.0.0.1:4780" })?.source, "skill");
});

test("unknown tasks fail with a pointer toward a real model", async () => {
  const harness = createHarness(true);
  await assert.rejects(
    () => scriptedAdapter.run(input("Compose a symphony for brass", harness, memorySkills().skills)),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "no_recipe");
      return true;
    },
  );
});

function input(prompt: string, harness: ReturnType<typeof createHarness>, skills: Skills): AdapterRunInput {
  return {
    prompt,
    model: "local/scripted",
    computer: harness.computer,
    shell: { async exec() { return { stdout: "", stderr: "", exitCode: 0 }; } },
    files: harness.files,
    human: harness.human,
    skills,
    skillsPath: "/workstate/skills",
    environment: { id: "env_test", name: "acme" },
    run: { id: "run_test", sessionId: "ses_test", liveUrl: "http://127.0.0.1:4780/live/acme" },
    systemPrompt: "test",
    serverUrl: "http://127.0.0.1:4780",
    log: () => undefined,
    abortSignal: new AbortController().signal,
  };
}

function memorySkills(): { store: Skill[]; skills: Skills } {
  const store: Skill[] = [];
  const skills: Skills = {
    async list() {
      return store;
    },
    async read(name) {
      return store.find((skill) => skill.name === name) ?? null;
    },
    async write(draft) {
      const saved: Skill = {
        ...draft,
        createdAt: "2026-10-06T00:00:00.000Z",
        updatedAt: "2026-10-06T00:00:00.000Z",
      };
      const index = store.findIndex((skill) => skill.name === saved.name);
      if (index >= 0) store[index] = saved;
      else store.push(saved);
      return saved;
    },
  };
  return { store, skills };
}

function createHarness(startLoggedIn: boolean): {
  computer: Computer;
  human: Human;
  files: Files;
  written: Map<string, string>;
  humanCalls: number;
} {
  let loggedIn = startLoggedIn;
  let url = "about:blank";
  let humanCalls = 0;
  const written = new Map<string, string>();
  const computer: Computer = {
    async open(next) {
      url = !loggedIn && next.includes("/orders") ? "http://127.0.0.1:4780/demo/shop/" : next;
      return computer.page();
    },
    async page() {
      if (url.includes("/invoices/")) return { url, title: "Invoice INV-1042" };
      if (!loggedIn) return { url: "http://127.0.0.1:4780/demo/shop/", title: "Sign in · Northwind Supply" };
      return { url, title: "Orders · Northwind Supply" };
    },
    async extract(selector) {
      if (selector.includes("password")) return loggedIn ? [] : ["[password]"];
      if (!loggedIn || url.includes("/invoices/")) return [];
      if (selector.includes("order-id")) return ["INV-1042"];
      if (selector.includes("order-total")) return ["$128.00"];
      if (selector.includes("invoice")) return ["http://127.0.0.1:4780/demo/shop/invoices/INV-1042"];
      return [];
    },
    async text() {
      return url.includes("/invoices/") ? "INVOICE INV-1042\nAmount: $128.00\n" : "orders";
    },
    async screenshot() {
      return { mimeType: "image/jpeg", data: "", width: 1280, height: 800 };
    },
    async click() {},
    async doubleClick() {},
    async move() {},
    async type() {},
    async key() {},
    async scroll() {},
    async wait() {},
    async back() {},
  };
  const human: Human = {
    async request() {
      humanCalls += 1;
      loggedIn = true;
      return { id: "hum_test", action: "returned" };
    },
  };
  const files: Files = {
    async read(filePath) {
      return written.get(filePath) ?? "";
    },
    async write(filePath, content) {
      written.set(filePath, content);
    },
    async list() {
      return [];
    },
  };
  return {
    computer,
    human,
    files,
    written,
    get humanCalls() {
      return humanCalls;
    },
  };
}
