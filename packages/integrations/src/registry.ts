import { DockerRuntimeProvider } from "@workstate/runtime-docker";
import { LocalRuntimeProvider } from "@workstate/runtime-local";
import type { IntegrationDescriptor, RunIntegrations, RuntimeProvider } from "@workstate/sdk";
import { AgentMailbox } from "./mail/agentmail.js";
import { AgentcardPayments } from "./payments/agentcard.js";
import { anchorRuntime, browserbaseRuntime, kernelRuntime, steelRuntime } from "./runtimes/hosted-browsers.js";
import { daytonaRuntime, e2bRuntime } from "./runtimes/sandboxes.js";
import { onePassword } from "./secrets/onepassword.js";
import { env } from "./setup.js";

export const RUNTIME_IDS = ["local", "docker", "anchor", "browserbase", "steel", "kernel", "e2b", "daytona"] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

export function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && (RUNTIME_IDS as readonly string[]).includes(value);
}

/** Resolve which runtime an environment uses: its config, then WORKSTATE_RUNTIME, then local. */
export function runtimeIdFor(config: Record<string, unknown> | undefined): RuntimeId {
  const fromConfig = config?.runtime;
  if (isRuntimeId(fromConfig)) return fromConfig;
  const fromEnv = env("WORKSTATE_RUNTIME");
  if (isRuntimeId(fromEnv)) return fromEnv;
  return "local";
}

export function createRuntimeProvider(id: RuntimeId, options: { headless: boolean }): RuntimeProvider {
  switch (id) {
    case "local":
      return new LocalRuntimeProvider(options.headless);
    case "docker":
      return new DockerRuntimeProvider();
    case "anchor":
      return anchorRuntime;
    case "browserbase":
      return browserbaseRuntime;
    case "steel":
      return steelRuntime;
    case "kernel":
      return kernelRuntime;
    case "e2b":
      return e2bRuntime;
    case "daytona":
      return daytonaRuntime;
  }
}

function has(...names: string[]): boolean {
  return names.every((name) => Boolean(env(name)));
}

export function describeRuntimes(): IntegrationDescriptor[] {
  return [
    {
      id: "local",
      kind: "runtime",
      name: "Local Chromium",
      description: "Persistent Playwright Chromium profile on this machine. Shell and files live in the environment directory.",
      envVars: [],
      configured: true,
      select: 'config.runtime = "local" (default)',
      status: "verified",
    },
    {
      id: "docker",
      kind: "runtime",
      name: "Docker",
      description: "Runs the Workstate runtime image as a container per environment, with the environment directory mounted.",
      envVars: ["WORKSTATE_RUNTIME_IMAGE"],
      configured: true,
      select: 'config.runtime = "docker"',
      docsUrl: "https://docs.docker.com/get-started/",
      status: "verified",
    },
    {
      id: "anchor",
      kind: "runtime",
      name: "Anchor Browser",
      description: "Cloud Chromium over CDP with a live view. Optional named profile persists logins between sessions.",
      envVars: ["ANCHOR_API_KEY", "WORKSTATE_ANCHOR_PROFILE"],
      configured: has("ANCHOR_API_KEY"),
      select: 'config.runtime = "anchor"',
      docsUrl: "https://docs.anchorbrowser.io",
      status: "untested",
    },
    {
      id: "browserbase",
      kind: "runtime",
      name: "Browserbase",
      description: "Cloud Chromium over CDP. Optional Browserbase context id persists cookies between sessions.",
      envVars: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "WORKSTATE_BROWSERBASE_CONTEXT_ID"],
      configured: has("BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"),
      select: 'config.runtime = "browserbase"',
      docsUrl: "https://docs.browserbase.com",
      status: "untested",
    },
    {
      id: "steel",
      kind: "runtime",
      name: "Steel",
      description: "Open-source cloud browser over CDP with a session viewer. STEEL_API_URL points at a self-hosted instance.",
      envVars: ["STEEL_API_KEY", "STEEL_API_URL"],
      configured: has("STEEL_API_KEY"),
      select: 'config.runtime = "steel"',
      docsUrl: "https://docs.steel.dev",
      status: "untested",
    },
    {
      id: "kernel",
      kind: "runtime",
      name: "Kernel",
      description: "Cloud Chromium over CDP with a live view. Optional Kernel profile keeps logins between sessions.",
      envVars: ["KERNEL_API_KEY", "WORKSTATE_KERNEL_PROFILE"],
      configured: has("KERNEL_API_KEY"),
      select: 'config.runtime = "kernel"',
      docsUrl: "https://www.kernel.sh/docs",
      status: "untested",
    },
    {
      id: "e2b",
      kind: "runtime",
      name: "E2B",
      description: "Full sandbox: browser, shell, and files run inside an E2B sandbox built from the Workstate runtime image.",
      envVars: ["E2B_API_KEY", "WORKSTATE_E2B_TEMPLATE"],
      configured: has("E2B_API_KEY"),
      select: 'config.runtime = "e2b"',
      docsUrl: "https://e2b.dev/docs",
      status: "untested",
    },
    {
      id: "daytona",
      kind: "runtime",
      name: "Daytona",
      description: "Full sandbox: browser, shell, and files run inside a Daytona sandbox created from the Workstate runtime image.",
      envVars: ["DAYTONA_API_KEY", "WORKSTATE_DAYTONA_IMAGE", "WORKSTATE_DAYTONA_SNAPSHOT"],
      configured: has("DAYTONA_API_KEY"),
      select: 'config.runtime = "daytona"',
      docsUrl: "https://www.daytona.io/docs",
      status: "untested",
    },
  ];
}

export function describeServices(): IntegrationDescriptor[] {
  return [
    {
      id: "1password",
      kind: "secrets",
      name: "1Password",
      description: "Resolves op:// references for environment logins. The agent fills credentials without ever seeing them.",
      envVars: ["OP_SERVICE_ACCOUNT_TOKEN", "OP_CONNECT_HOST", "OP_CONNECT_TOKEN"],
      configured: has("OP_SERVICE_ACCOUNT_TOKEN") || has("OP_CONNECT_HOST", "OP_CONNECT_TOKEN"),
      select: 'config.credentials = "op://Vault/Item"',
      docsUrl: "https://developer.1password.com/docs/sdks",
      status: "untested",
    },
    {
      id: "agentmail",
      kind: "mail",
      name: "AgentMail",
      description: "Gives the environment an email inbox so the agent can receive verification codes and sign-up mail.",
      envVars: ["AGENTMAIL_API_KEY"],
      configured: has("AGENTMAIL_API_KEY"),
      select: 'config.mailbox = "<inbox id or address>"',
      docsUrl: "https://docs.agentmail.to",
      status: "untested",
    },
    {
      id: "agentcard",
      kind: "payments",
      name: "Agentcard",
      description: "Issues single-use virtual cards for checkout. Every card needs a person's approval in the live panel first.",
      envVars: ["AGENTCARD_CLIENT_ID", "AGENTCARD_CLIENT_SECRET", "AGENTCARD_CARDHOLDER_ID"],
      configured: has("AGENTCARD_CLIENT_ID", "AGENTCARD_CLIENT_SECRET"),
      select: 'config.payments = "agentcard"',
      docsUrl: "https://docs.agentcard.sh",
      status: "untested",
    },
  ];
}

export function describeIntegrations(): IntegrationDescriptor[] {
  return [...describeRuntimes(), ...describeServices()];
}

function configString(config: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = config?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Build the per-run integration handles from an environment's config. */
export function integrationsForEnvironment(config: Record<string, unknown> | undefined): RunIntegrations {
  const result: RunIntegrations = {};
  const credentials = configString(config, "credentials");
  if (credentials) {
    result.credentialRef = credentials;
    result.secrets = onePassword();
  }
  const mailbox = configString(config, "mailbox");
  if (mailbox || config?.mailbox === true) {
    result.mail = new AgentMailbox(mailbox);
  }
  if (configString(config, "payments") === "agentcard") {
    result.payments = new AgentcardPayments();
  }
  return result;
}

export const ENVIRONMENT_CONFIG_KEYS = {
  runtime: `Runtime provider: ${RUNTIME_IDS.join(" | ")}`,
  model: "Default model id for runs on this environment, for example openai/computer-use-preview",
  credentials: "1Password reference to a Login item, for example op://Vault/Item",
  mailbox: "AgentMail inbox id or address",
  payments: 'Set to "agentcard" to let the agent issue approved single-use cards',
  anchorProfile: "Anchor Browser profile name to persist logins",
  browserbaseContextId: "Browserbase context id to persist cookies",
  kernelProfile: "Kernel profile name to persist logins",
  e2bTemplate: "E2B template built from packages/runtime-docker/Dockerfile",
  daytonaImage: "Image for Daytona sandboxes (default workstate/runtime:0.1)",
  daytonaSnapshot: "Daytona snapshot name, used instead of daytonaImage",
} as const;
