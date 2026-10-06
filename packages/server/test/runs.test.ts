import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AdapterRunInput, Computer, CuaAdapter, Files, RuntimeProvider, Shell } from "@workstate/sdk";
import { Db } from "../dist/db.js";
import { EnvironmentStore } from "../dist/environments.js";
import { RunManager } from "../dist/runs.js";
import { SessionManager } from "../dist/sessions.js";

test("a run moves from queued to success", async () => {
  const rig = await boot({
    name: "fake",
    available: () => true,
    async run() {
      return { text: "done", artifacts: ["/workspace/hello.txt"] };
    },
  });
  try {
    const run = rig.runs.create(rig.env, { prompt: "Say done", model: "fake" });
    await waitFor(() => rig.runs.get(run.id).status === "success", "success");
    assert.equal(rig.runs.get(run.id).result?.text, "done");
    assert.ok(rig.runs.events(run.id).some((event) => event.message === "Run finished"));
  } finally {
    await rig.close();
  }
});

test("human handoff resumes the agent on the next computer call", async () => {
  const rig = await boot({
    name: "fake",
    available: () => true,
    async run(input: AdapterRunInput) {
      await input.human.request({ kind: "login", message: "Sign in on the live view" });
      await input.computer.page();
      return { text: "back" };
    },
  });
  try {
    const run = rig.runs.create(rig.env, { prompt: "Sign in and continue", model: "fake" });
    await waitFor(() => rig.runs.get(run.id).status === "waiting_for_human", "waiting");
    assert.equal(rig.runs.get(run.id).humanRequest?.kind, "login");
    const waiting = rig.runs.get(run.id);
    rig.runs.resolveHuman(rig.env, { action: "return", requestId: waiting.humanRequest?.id });
    await waitFor(() => rig.runs.get(run.id).status === "success", "success");
    const messages = rig.runs.events(run.id).map((event) => event.message);
    assert.ok(messages.includes("Control returned to the agent"));
    assert.ok(messages.includes("Agent resumed"));
    assert.equal(rig.runs.get(run.id).result?.text, "back");
  } finally {
    await rig.close();
  }
});

test("runs on one environment execute one at a time", async () => {
  let releaseFirst: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondStarted = false;
  const rig = await boot({
    name: "fake",
    available: () => true,
    async run(input: AdapterRunInput) {
      if (input.prompt === "first") {
        await gate;
        return { text: "first" };
      }
      secondStarted = true;
      return { text: "second" };
    },
  });
  try {
    const first = rig.runs.create(rig.env, { prompt: "first", model: "fake" });
    await waitFor(() => rig.runs.get(first.id).status === "running", "first running");
    const second = rig.runs.create(rig.env, { prompt: "second", model: "fake" });
    assert.equal(rig.runs.get(second.id).status, "queued");
    assert.equal(secondStarted, false);
    releaseFirst();
    await waitFor(() => rig.runs.get(second.id).status === "success", "second success");
    assert.equal(rig.runs.get(first.id).result?.text, "first");
    assert.equal(rig.runs.get(second.id).result?.text, "second");
    assert.equal(secondStarted, true);
  } finally {
    await rig.close();
  }
});

test("cancel aborts the active run and a thrown adapter marks failure", async () => {
  const rig = await boot({
    name: "fake",
    available: () => true,
    async run(input: AdapterRunInput) {
      if (input.prompt === "slow") {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          input.abortSignal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("Run cancelled"), { code: "cancelled" }));
          });
        });
        return { text: "too late" };
      }
      throw new Error("No scripted recipe matches this task.");
    },
  });
  try {
    const slow = rig.runs.create(rig.env, { prompt: "slow", model: "fake" });
    await waitFor(() => rig.runs.get(slow.id).status === "running", "slow running");
    rig.runs.cancel(slow.id);
    await waitFor(() => rig.runs.get(slow.id).status === "cancelled", "cancelled");

    const failed = rig.runs.create(rig.env, { prompt: "unknown", model: "fake" });
    await waitFor(() => rig.runs.get(failed.id).status === "failed", "failed");
    assert.match(rig.runs.get(failed.id).error ?? "", /No scripted recipe/);
  } finally {
    await rig.close();
  }
});

test("a standalone approval can be declined without an agent", async () => {
  const rig = await boot({ name: "fake", available: () => true, async run() { return { text: "unused" }; } });
  try {
    const run = rig.runs.createHumanRequest(rig.env, { kind: "approval", message: "Ship it?" });
    assert.equal(run.status, "waiting_for_human");
    const declined = rig.runs.resolveHuman(rig.env, { action: "decline", requestId: run.humanRequest?.id });
    assert.equal(declined.status, "failed");
    assert.equal(declined.error, "Declined by a person");
  } finally {
    await rig.close();
  }
});

async function boot(adapter: CuaAdapter) {
  const home = await mkdtemp(path.join(tmpdir(), "ws-runs-"));
  const db = new Db(path.join(home, "workstate.sqlite"));
  const environments = new EnvironmentStore(db, {
    host: "127.0.0.1",
    port: 4780,
    home,
    publicUrl: "http://127.0.0.1:4780",
    headless: true,
  });
  const sessions = new SessionManager(db, fakeProvider(), true);
  const runs = new RunManager(db, environments, sessions, { publicUrl: "http://127.0.0.1:4780", adapter });
  const env = environments.getOrCreate("acme");
  return {
    db,
    runs,
    env,
    async close() {
      await sessions.stopAll();
      db.close();
    },
  };
}

function fakeProvider(): RuntimeProvider {
  const computer: Computer = {
    async open() {
      return { url: "about:blank", title: "" };
    },
    async screenshot() {
      return { mimeType: "image/jpeg", data: "", width: 10, height: 10 };
    },
    async click() {},
    async doubleClick() {},
    async move() {},
    async type() {},
    async key() {},
    async scroll() {},
    async wait() {},
    async back() {},
    async page() {
      return { url: "about:blank", title: "" };
    },
    async text() {
      return "";
    },
    async extract(selector) {
      if (selector.includes("password")) return [];
      return ["http://shop/invoices/INV-1"];
    },
  };
  const shell: Shell = {
    async exec() {
      return { stdout: "ok\n", stderr: "", exitCode: 0 };
    },
  };
  const files: Files = {
    async read() {
      return "";
    },
    async write() {},
    async list() {
      return [];
    },
  };
  return {
    name: "fake",
    async start(env) {
      return { id: "ses_fake", environmentId: env.id, computer, shell, files, async stop() {} };
    },
  };
}

function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 3_000) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 15);
  });
}
