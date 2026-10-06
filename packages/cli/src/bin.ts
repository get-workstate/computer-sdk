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
  workstate env create <name>
  workstate env list
  workstate env open <name>
  workstate live <name>
  workstate skills list --env <name>
  workstate setup

The local scripted model needs no API key. It can download the demo shop invoice,
summarize Hacker News, or open an explicit URL.
`);
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
        if (!name) throw new WorkstateError("Usage: workstate env create <name>", { code: "usage" });
        const env = await ws.environment(name);
        if (flags.json) printJson(env.record, flags);
        else console.log(`Created ${env.name} (${env.id})`);
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
      throw new WorkstateError("Usage: workstate env create|list|open", { code: "usage" });
    } finally {
      if (sub !== "open") await connected.handle?.close();
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
