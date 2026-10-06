import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { maxSteps } from "./limits.js";

export interface StagehandTarget {
  mode: "cua" | "dom" | "hybrid";
  modelName: string;
  provider: string;
}

/** stagehand/<provider>/<model> runs the computer-use agent; stagehand-dom/... and stagehand-hybrid/... pick the other modes. */
export function parseStagehandModel(model: string): StagehandTarget {
  const match = model.trim().match(/^stagehand(?:-(dom|hybrid))?\/(.+)$/);
  const mode = (match?.[1] as "dom" | "hybrid" | undefined) ?? "cua";
  const rest = match?.[2]?.trim() || "openai/computer-use-preview";
  const provider = rest.includes("/") ? rest.split("/")[0]! : rest.startsWith("claude") ? "anthropic" : rest.startsWith("gemini") ? "google" : "openai";
  const modelName = rest.includes("/") ? rest : `${provider}/${rest}`;
  return { mode, modelName, provider };
}

export function providerApiKey(provider: string): { envVar: string; value: string | undefined } {
  switch (provider) {
    case "anthropic":
      return { envVar: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY };
    case "google":
      return { envVar: "GEMINI_API_KEY", value: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY };
    case "openai":
      return { envVar: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY };
    default:
      return { envVar: `${provider.toUpperCase()}_API_KEY`, value: process.env[`${provider.toUpperCase()}_API_KEY`] };
  }
}

interface StagehandInstance {
  init(): Promise<unknown>;
  close(): Promise<unknown>;
  agent(config: Record<string, unknown>): {
    execute(options: { instruction: string; maxSteps?: number; signal?: AbortSignal }): Promise<{
      success?: boolean;
      completed?: boolean;
      message?: string;
      actions?: unknown[];
    }>;
  };
}

interface StagehandModule {
  Stagehand: new (options: Record<string, unknown>) => StagehandInstance;
}

const STAGEHAND_PACKAGE = "@browserbasehq/stagehand";

async function loadStagehand(): Promise<StagehandModule> {
  try {
    return (await import(STAGEHAND_PACKAGE)) as unknown as StagehandModule;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new Error(
        "Stagehand is not installed. Run `pnpm add @browserbasehq/stagehand --filter @workstate/model-adapters` and restart the server.",
      );
    }
    throw error;
  }
}

/**
 * Stagehand attached to the environment's browser over CDP, so its agent works inside the same
 * persistent profile as every other run. The run's result is the agent's final message.
 */
export const stagehandAdapter: CuaAdapter = {
  name: "stagehand",
  description: "Browserbase Stagehand agent attached to the environment browser (model ids stagehand/<provider>/<model>).",
  available: () => Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const target = parseStagehandModel(input.model);
    const key = providerApiKey(target.provider);
    if (!key.value) throw new Error(`Stagehand with ${target.modelName} needs ${key.envVar} on the Workstate server.`);
    if (!input.cdpUrl) {
      throw new Error("Stagehand needs a browser CDP endpoint. The local, Anchor, Browserbase, Steel, and Kernel runtimes expose one; Docker, E2B, and Daytona do not yet.");
    }
    const { Stagehand } = await loadStagehand();
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: input.cdpUrl },
      model: { modelName: target.modelName, apiKey: key.value },
      verbose: 0,
      disablePino: true,
    });
    input.log("log", `Stagehand attaching to the environment browser (${target.mode} mode, ${target.modelName})`);
    await stagehand.init();
    try {
      const agent = stagehand.agent({
        mode: target.mode,
        model: { modelName: target.modelName, apiKey: key.value },
        systemPrompt: input.systemPrompt,
      });
      const result = await agent.execute({ instruction: input.prompt, maxSteps: maxSteps(), signal: input.abortSignal });
      if (Array.isArray(result.actions)) input.log("log", `Stagehand took ${result.actions.length} actions`);
      if (result.success === false && result.completed !== true) {
        throw new Error(result.message || "Stagehand did not complete the task.");
      }
      return { text: result.message?.trim() || "Finished." };
    } finally {
      await stagehand.close().catch(() => undefined);
    }
  },
};
