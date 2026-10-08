#!/usr/bin/env node
import { spawn } from "node:child_process";
import { defaultModel } from "@workstate/model-adapters";
import { Workstate, WorkstateError } from "@workstate/sdk";
import { DEFAULT_PORT, startServer, VERSION, type ServerHandle } from "@workstate/server";

interface Flags {
  [key: string]: string | boolean;
}

function parseArgs(argv: string[]): { flags: Flags; positionals: string[] } {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positionals.push(arg);
  }
  return { flags, positionals };
}

function asString(value: string | boolean | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function help(): void {
  console.log(`Workstate ${VERSION}

Usage:
  workstate start [--host 127.0.0.1] [--port ${DEFAULT_PORT}] [--no-open]
  workstate run [--env acme] [--model local/scripted] [--url http://127.0.0.1:${DEFAULT_PORT}] "prompt"
  workstate env create <name> [--runtime local|docker|anchor|browserbase|steel|kernel|e2b|daytona]
                              [--model <adapter>/<model>] [--credentials op://Vault/Item]
                              [--anchor-identity-id <id>] [--anchor-profile <name>]
                              [--mailbox <agentmail inbox>] [--payments agentcard]
  workstate env set <name> [same flags as create; --no-<flag> clears a setting]
  workstate env list
  workstate env open <name>
  workstate integrations [--json]
  workstate live <name>
  workstate skills list --env <name>
  workstate setup

Set ANCHOR_API_KEY to make Anchor the default runtime and native model. Without it,
Workstate falls back to local Chromium and the local scripted model.

Integrations are selected per environment and read their API keys from the server's
environment variables. \`workstate integrations\` shows what each one needs.
`);
}

const CONFIG_FLAGS = [
  "runtime",
  "model",
  "credentials",
  "mailbox",
  "payments",
  "anchor-identity-id",
  "anchor-profile",
  "browserbase-context-id",
  "kernel-profile",
  "e2b-template",
  "daytona-image",
  "daytona-snapshot",
] as const;

function camel(flag: string): string {
  return flag.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Turn --runtime anchor / --no-credentials style flags into an environment config patch. */
export function configFromFlags(flags: Flags): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const flag of CONFIG_FLAGS) {
    const value = flags[flag];
    if (typeof value === "string") config[camel(flag)] = value;
    else if (value === true && flag === "mailbox") config.mailbox = true;
    if (flags[`no-${flag}`] === true) config[camel(flag)] = null;
  }
  return config;
}

function describeConfig(config: Record<string, unknown>): string {
  const entries = Object.entries(config).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return "runtime=local (default)";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join("  ");
}

async function serverReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function connect(flags: Flags): Promise<{ url: string; handle?: ServerHandle }> {
  const port = Number(asString(flags.port, String(process.env.WORKSTATE_PORT ?? DEFAULT_PORT)));
  const host = asString(flags.host, process.env.WORKSTATE_HOST ?? "127.0.0.1");
  const url = asString(flags.url, process.env.WORKSTATE_URL ?? `http://127.0.0.1:${port}`);
  if (await serverReachable(url)) return { url };
  const handle = await startServer({ host, port });
  return { url: handle.url, handle };
}

function printJson(value: unknown, flags: Flags): void {
  if (flags.json) console.log(JSON.stringify(value, null, 2));
}

function maybeOpen(url: string, flags: Flags): void {
  if (flags["no-open"]) return;
  const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  const [command, sub, name] = positionals;
  if (!command || command === "help" || flags.help) {
    help();
    return;
  }

  if (command === "setup") {
    console.log(`Workstate ${VERSION}`);
    console.log(`Node ${process.version}`);
    console.log(`Default model: ${defaultModel()}`);
    console.log("Install the browser with: pnpm exec playwright install chromium");
    console.log("OpenAI: set OPENAI_API_KEY. Anthropic: set ANTHROPIC_API_KEY.");
    console.log("Docker runtime (optional, untested here): WORKSTATE_RUNTIME=docker");
    return;
  }

  if (command === "start") {
    const port = Number(asString(flags.port, String(process.env.WORKSTATE_PORT ?? DEFAULT_PORT)));
    const host = asString(flags.host, process.env.WORKSTATE_HOST ?? "127.0.0.1");
    const handle = await startServer({ host, port });
    maybeOpen(handle.url, flags);
    return;
  }

  if (command === "run") {
    const prompt = positionals.slice(1).join(" ").trim();
    if (!prompt) {
      console.error("Give the run a prompt. Example: workstate run --env acme \"Download the latest invoice from the demo shop\"");
      process.exitCode = 1;
      return;
    }
    const connected = await connect(flags);
    try {
      const ws = new Workstate({ url: connected.url });
      const envName = asString(flags.env, "acme");
      const env = await ws.environment(envName);
      const run = await env.run(
        { prompt, model: asString(flags.model, "") || undefined },
        {
          onStatus: (status) => {
            if (!flags.json) console.log(status);
          },
        },
      );
      if (flags.json) printJson(run, flags);
      else if (run.status === "success") console.log(run.result?.text ?? "Finished.");
      else {
        console.error(run.error ?? `Run ${run.status}`);
        process.exitCode = 1;
      }
    } finally {
      await connected.handle?.close();
    }
    return;
  }

  if (command === "env") {
    const connected = await connect(flags);
    try {
      const ws = new Workstate({ url: connected.url });
      if (sub === "list") {
        const list = await ws.listEnvironments();
        if (flags.json) printJson(list, flags);
        else if (list.length === 0) console.log("No environments yet.");
        else for (const env of list) console.log(`${env.name}\t${env.id}`);
        return;
      }
      if (sub === "create") {
        if (!name) throw new WorkstateError("Usage: workstate env create <name> [--runtime ...] [--model ...]", { code: "usage" });
        const env = await ws.environment(name, configFromFlags(flags));
        if (flags.json) printJson(env.record, flags);
        else {
          console.log(`Created ${env.name} (${env.id})`);
          console.log(`  ${describeConfig(env.record.config)}`);
        }
        return;
      }
      if (sub === "set") {
        if (!name) throw new WorkstateError("Usage: workstate env set <name> --runtime anchor | --credentials op://Vault/Item | ...", { code: "usage" });
        const patch = configFromFlags(flags);
        if (Object.keys(patch).length === 0) {
          throw new WorkstateError(`Nothing to change. Flags: ${CONFIG_FLAGS.map((flag) => `--${flag}`).join(", ")}`, { code: "usage" });
        }
        const env = await ws.environment(name);
        const updated = await env.configure(patch);
        if (flags.json) printJson(updated, flags);
        else {
          console.log(`Updated ${updated.name}`);
          console.log(`  ${describeConfig(updated.config)}`);
        }
        return;
      }
      if (sub === "open") {
        if (!name) throw new WorkstateError("Usage: workstate env open <name>", { code: "usage" });
        await ws.environment(name);
        const page = `${connected.url}/env/${name}`;
        console.log(page);
        console.log(`${connected.url}/live/${name}`);
        maybeOpen(page, flags);
        return;
      }
      throw new WorkstateError("Usage: workstate env create|set|list|open", { code: "usage" });
    } finally {
      if (sub !== "open") await connected.handle?.close();
    }
    return;
  }

  if (command === "integrations") {
    const connected = await connect(flags);
    try {
      const ws = new Workstate({ url: connected.url });
      const { integrations } = await ws.integrations();
      if (flags.json) {
        printJson(integrations, flags);
        return;
      }
      const kinds: Array<[string, string]> = [
        ["runtime", "Runtimes (config.runtime)"],
        ["model", "Models and harnesses (--model)"],
        ["secrets", "Secrets"],
        ["mail", "Mail"],
        ["payments", "Payments"],
      ];
      for (const [kind, title] of kinds) {
        const rows = integrations.filter((item) => item.kind === kind);
        if (rows.length === 0) continue;
        console.log(`\n${title}`);
        for (const item of rows) {
          const state = item.configured ? "ready" : "needs key";
          const needs = item.envVars.length > 0 ? `  needs ${item.envVars.join(", ")}` : "";
          console.log(`  ${item.id.padEnd(16)} ${state.padEnd(10)} ${item.select}${needs}`);
        }
      }
      console.log("");
    } finally {
      await connected.handle?.close();
    }
    return;
  }

  if (command === "live") {
    if (!sub) {
      console.error("Usage: workstate live <name>");
      process.exitCode = 1;
      return;
    }
    const connected = await connect(flags);
    const page = `${connected.url}/live/${sub}`;
    console.log(page);
    maybeOpen(page, flags);
    if (connected.handle) console.log("Server is running. Ctrl-C stops it.");
    return;
  }

  if (command === "skills" && sub === "list") {
    const envName = asString(flags.env, "");
    if (!envName) {
      console.error("Usage: workstate skills list --env <name>");
      process.exitCode = 1;
      return;
    }
    const connected = await connect(flags);
    try {
      const response = await fetch(`${connected.url}/api/environments/${encodeURIComponent(envName)}/skills`);
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        const message = (body as { error?: string }).error ?? response.statusText;
        throw new WorkstateError(message, { code: "http_error", status: response.status });
      }
      if (flags.json) printJson(body, flags);
      else {
        const skills = body as Array<{ name: string; description: string }>;
        if (skills.length === 0) console.log(`No skills in ${envName} yet.`);
        else for (const skill of skills) console.log(`${skill.name}\t${skill.description}`);
      }
    } finally {
      await connected.handle?.close();
    }
    return;
  }

  help();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof WorkstateError) console.error(error.message);
  else console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
