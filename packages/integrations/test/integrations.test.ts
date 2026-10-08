import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeEnvironment } from "@workstate/sdk";
import {
  AgentMailbox,
  AgentcardPayments,
  RUNTIME_IDS,
  createRuntimeProvider,
  describeIntegrations,
  extractCode,
  integrationsForEnvironment,
  onePassword,
  openAnchorBrowser,
  parseSecretRef,
  runtimeIdFor,
} from "../dist/index.js";

const KEYS = [
  "ANCHOR_API_KEY",
  "BROWSERBASE_API_KEY",
  "BROWSERBASE_PROJECT_ID",
  "STEEL_API_KEY",
  "KERNEL_API_KEY",
  "E2B_API_KEY",
  "DAYTONA_API_KEY",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_CONNECT_HOST",
  "OP_CONNECT_TOKEN",
  "AGENTMAIL_API_KEY",
  "AGENTCARD_CLIENT_ID",
  "AGENTCARD_CLIENT_SECRET",
  "WORKSTATE_RUNTIME",
];

function withoutKeys<T>(fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const fakeEnv: RuntimeEnvironment = {
  id: "env_test",
  name: "test",
  headless: true,
  config: {},
  paths: {
    root: "/tmp/ws-test",
    files: "/tmp/ws-test/files",
    skills: "/tmp/ws-test/skills",
    browserProfile: "/tmp/ws-test/profile",
    runs: "/tmp/ws-test/runs",
  },
};

test("every hosted runtime fails fast with a setup error naming its env var when no key is set", async () => {
  await withoutKeys(async () => {
    const expectations: Record<string, string> = {
      anchor: "ANCHOR_API_KEY",
      browserbase: "BROWSERBASE_API_KEY",
      steel: "STEEL_API_KEY",
      kernel: "KERNEL_API_KEY",
      e2b: "E2B_API_KEY",
      daytona: "DAYTONA_API_KEY",
    };
    for (const [id, envVar] of Object.entries(expectations)) {
      const provider = createRuntimeProvider(id as (typeof RUNTIME_IDS)[number], { headless: true });
      assert.equal(provider.name, id);
      await assert.rejects(
        provider.start(fakeEnv),
        (error: Error & { code?: string; envVars?: string[] }) => {
          assert.equal(error.code, "integration_not_configured", `${id} should raise a setup error`);
          assert.match(error.message, new RegExp(envVar), `${id} message should mention ${envVar}`);
          assert.ok(error.envVars?.includes(envVar));
          return true;
        },
      );
    }
  });
});

test("runtime selection prefers environment config, then WORKSTATE_RUNTIME, then local", () => {
  withoutKeys(() => {
    assert.equal(runtimeIdFor(undefined), "local");
    process.env.ANCHOR_API_KEY = "test";
    assert.equal(runtimeIdFor(undefined), "anchor");
    assert.equal(runtimeIdFor({ runtime: "local" }), "local");
    delete process.env.ANCHOR_API_KEY;
    assert.equal(runtimeIdFor({ runtime: "anchor" }), "anchor");
    assert.equal(runtimeIdFor({ runtime: "nope" }), "local");
    process.env.WORKSTATE_RUNTIME = "docker";
    assert.equal(runtimeIdFor({}), "docker");
    assert.equal(runtimeIdFor({ runtime: "steel" }), "steel");
  });
});

test("Anchor sessions include managed identity settings and provider metadata", async () => {
  const savedKey = process.env.ANCHOR_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.ANCHOR_API_KEY = "test";
  let createBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "POST") {
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          data: {
            id: "anchor_session",
            cdp_url: "ws://anchor.test/cdp",
            live_view_url: "https://anchor.test/live",
          },
        }),
        { status: 201 },
      );
    }
    return new Response("", { status: 204 });
  };
  try {
    const remote = await openAnchorBrowser({
      ...fakeEnv,
      config: { anchorIdentityId: "identity_1", anchorIdentitySkipValidation: false },
    });
    assert.equal(remote.provider?.name, "anchor");
    assert.equal(remote.provider?.sessionId, "anchor_session");
    assert.deepEqual(createBody?.identities, [{ id: "identity_1" }]);
    assert.equal(createBody?.identity_skip_validation, false);
    await remote.stop();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.ANCHOR_API_KEY;
    else process.env.ANCHOR_API_KEY = savedKey;
  }
});

test("describeIntegrations covers every runtime id and reports unconfigured without keys", () => {
  withoutKeys(() => {
    const described = describeIntegrations();
    for (const id of RUNTIME_IDS) assert.ok(described.some((item) => item.id === id && item.kind === "runtime"), id);
    for (const id of ["1password", "agentmail", "agentcard"]) assert.ok(described.some((item) => item.id === id), id);
    for (const item of described) {
      if (item.id === "local" || item.id === "docker") assert.equal(item.configured, true);
      else assert.equal(item.configured, false, `${item.id} should be unconfigured without keys`);
      assert.ok(item.select.length > 0);
    }
  });
});

test("1Password references parse and unconfigured providers raise setup errors", async () => {
  assert.deepEqual(parseSecretRef("op://Private/Acme Shop"), { vault: "Private", item: "Acme Shop", field: undefined });
  assert.deepEqual(parseSecretRef("op://Private/Acme/password"), { vault: "Private", item: "Acme", field: "password" });
  assert.throws(() => parseSecretRef("Private/Acme"), /not a 1Password reference/);
  await withoutKeys(async () => {
    const secrets = onePassword();
    assert.equal(secrets.configured(), false);
    await assert.rejects(secrets.credential("op://Private/Acme"), (error: Error & { code?: string }) => {
      assert.equal(error.code, "integration_not_configured");
      assert.match(error.message, /OP_SERVICE_ACCOUNT_TOKEN/);
      return true;
    });
  });
});

test("AgentMail and Agentcard raise setup errors without keys, and codes are extracted from mail", async () => {
  assert.equal(extractCode("Your verification code is 482913. It expires soon."), "482913");
  assert.equal(extractCode("Use code 7F3K9Q to continue"), "7F3K9Q");
  assert.equal(extractCode("Order #2024 shipped"), "2024");
  assert.equal(extractCode("No numbers here"), null);
  await withoutKeys(async () => {
    const mail = new AgentMailbox("inbox_123");
    assert.equal(mail.configured(), false);
    await assert.rejects(mail.list(), /AGENTMAIL_API_KEY/);
    const payments = new AgentcardPayments();
    assert.equal(payments.configured(), false);
    await assert.rejects(payments.createCard({ amountCents: 2500 }), /AGENTCARD_CLIENT_ID/);
  });
});

test("integrationsForEnvironment only wires what the config asks for", () => {
  withoutKeys(() => {
    assert.deepEqual(integrationsForEnvironment({}), {});
    const wired = integrationsForEnvironment({ credentials: "op://Private/Shop", mailbox: "inbox_1", payments: "agentcard" });
    assert.equal(wired.credentialRef, "op://Private/Shop");
    assert.equal(wired.secrets?.name, "1password");
    assert.equal(wired.mail?.name, "agentmail");
    assert.equal(wired.payments?.name, "agentcard");
  });
});
