import { spawn } from "node:child_process";
import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { pickTextProvider, runTextAgent } from "./text-agent.js";
import { executeTool, sharedTools, integrationTools, type ToolSpec } from "./tools.js";

export const HARNESS_BINARY = process.env.WORKSTATE_BROWSER_HARNESS_BIN ?? "browser-harness";

export function harnessModelSpec(model: string): string | undefined {
  const stripped = model.replace(/^browser-harness\/?/, "").trim();
  return stripped || undefined;
}

export interface HarnessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a Python snippet through the browser-harness CLI, attached to the given CDP endpoint. */
export function runHarness(code: string, cdpUrl: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<HarnessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(HARNESS_BINARY, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BU_CDP_URL: cdpUrl, BU_CDP_WS: cdpUrl },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    const onAbort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `browser-harness is not installed on the Workstate server. Install it with \`uv tool install --python 3.12 browser-harness\` (https://github.com/browser-use/browser-harness) or point WORKSTATE_BROWSER_HARNESS_BIN at the binary.`,
          ),
        );
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout: stdout.slice(-20_000), stderr: stderr.slice(-5_000), exitCode: code ?? 1 });
    });
    child.stdin.end(code);
  });
}

export const harnessTool: ToolSpec = {
  name: "harness_exec",
  description:
    "Run a Python snippet inside browser-harness, which is attached to the environment browser over CDP. The harness helpers (for example new_tab(url), goto_url(url), page_info()) are pre-imported; print([n for n in dir() if not n.startswith('_')]) lists the rest. print() what you need to see.",
  parameters: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
    additionalProperties: false,
  },
};

const HARNESS_PROMPT =
  "You control a real Chromium browser through browser-harness. Use harness_exec to run short Python snippets; always print the information you need. Before repeating a known job, call skills_list and replay the matching saved procedure. Start navigation with new_tab(url). After harness_exec you can read the page with computer_text or computer_extract. When a job succeeds, call skills_write with the reusable browser-harness code and decisions as the procedure so the next run can replay the trajectory locally. Shell, files, skills, and human_request tools work as usual. Call finish when done.";

/**
 * browser-use/browser-harness as the tool layer, with an OpenAI or Anthropic chat model as the
 * brain. The harness attaches to the environment browser, so logins and the profile are shared.
 */
export const browserHarnessAdapter: CuaAdapter = {
  name: "browser-harness",
  description: "browser-harness CLI attached to the environment browser, driven by a chat model (model ids browser-harness/<provider>/<model>).",
  available: () => Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const picked = pickTextProvider(harnessModelSpec(input.model));
    if (!process.env[picked.envVar]) throw new Error(`browser-harness adapter needs ${picked.envVar} on the Workstate server.`);
    if (!input.cdpUrl) {
      throw new Error("browser-harness needs a browser CDP endpoint. The local, Anchor, Browserbase, Steel, and Kernel runtimes expose one; Docker, E2B, and Daytona do not yet.");
    }
    const cdpUrl = input.cdpUrl;
    // Fail fast with the install hint instead of after the first model turn.
    const probe = await runHarness("print(page_info())", cdpUrl, { timeoutMs: 60_000, signal: input.abortSignal });
    if (probe.exitCode !== 0 && !probe.stdout) {
      throw new Error(`browser-harness could not attach to the browser at ${cdpUrl}. ${probe.stderr.trim().slice(-400)}`);
    }
    input.log("log", `browser-harness attached (${picked.provider}/${picked.model})`);
    const tools = [harnessTool, ...sharedTools, ...integrationTools(input)];
    return runTextAgent({
      input,
      provider: picked.provider,
      model: picked.model,
      tools,
      systemPrompt: `${input.systemPrompt}\n\n${HARNESS_PROMPT}`,
      execute: async (name, args) => {
        if (name === "harness_exec") {
          const result = await runHarness(String(args.code ?? ""), cdpUrl, { signal: input.abortSignal });
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
        }
        return executeTool(name, args, input);
      },
    });
  },
};
