import type { CuaAdapter, IntegrationDescriptor } from "@workstate/sdk";
import { anchorAdapter } from "./anchor.js";
import { anthropicAdapter } from "./anthropic.js";
import { browserHarnessAdapter } from "./browser-harness.js";
import { browserUseAdapter } from "./browser-use.js";
import { geminiAdapter } from "./gemini.js";
import { openaiAdapter } from "./openai.js";
import { scriptedAdapter } from "./scripted.js";
import { stagehandAdapter } from "./stagehand.js";

const builtIn: CuaAdapter[] = [
  scriptedAdapter,
  anchorAdapter,
  openaiAdapter,
  anthropicAdapter,
  geminiAdapter,
  stagehandAdapter,
  browserUseAdapter,
  browserHarnessAdapter,
];

const registry = new Map<string, CuaAdapter>();

export function registerAdapter(adapter: CuaAdapter): void {
  registry.set(adapter.name, adapter);
}

export function listAdapters(): CuaAdapter[] {
  const names = new Set(builtIn.map((adapter) => adapter.name));
  const extras = [...registry.values()].filter((adapter) => !names.has(adapter.name));
  return [...builtIn, ...extras];
}

export function defaultModel(): string {
  if (process.env.WORKSTATE_DEFAULT_MODEL) return process.env.WORKSTATE_DEFAULT_MODEL;
  if (process.env.ANCHOR_API_KEY) return "anchor/agent";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic/claude-sonnet-4-5";
  if (process.env.OPENAI_API_KEY) return "openai/computer-use-preview";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini/gemini-3.8-flash";
  return "local/scripted";
}

/**
 * Model ids are "<adapter>/<model>". The adapter prefix picks the loop; the rest is passed to it.
 *   local/scripted · openai/computer-use-preview · anthropic/claude-sonnet-4-5 · gemini/gemini-3.8-flash
 *   stagehand/openai/computer-use-preview · browser-use/cloud · browser-harness/anthropic/claude-sonnet-4-5
 */
export function resolveAdapter(model?: string): CuaAdapter {
  const requested = (model ?? defaultModel()).trim();
  if (registry.has(requested)) return registry.get(requested)!;
  const prefix = requested.split("/")[0] ?? requested;
  if (registry.has(prefix)) return registry.get(prefix)!;
  if (requested === "local" || requested.startsWith("local/")) return scriptedAdapter;
  if (requested === "anchor" || requested.startsWith("anchor/")) return anchorAdapter;
  if (requested.startsWith("stagehand")) return stagehandAdapter;
  if (requested.startsWith("browser-use")) return browserUseAdapter;
  if (requested.startsWith("browser-harness")) return browserHarnessAdapter;
  if (requested.startsWith("gemini") || requested.startsWith("google/")) return geminiAdapter;
  if (requested.startsWith("openai/") || requested.startsWith("gpt") || requested.includes("computer-use")) return openaiAdapter;
  if (requested.startsWith("anthropic/") || requested.startsWith("claude")) return anthropicAdapter;
  return scriptedAdapter;
}

const MODEL_META: Record<string, { envVars: string[]; example: string; docsUrl?: string; status: "verified" | "untested" }> = {
  local: { envVars: [], example: "local/scripted", status: "verified" },
  anchor: { envVars: ["ANCHOR_API_KEY"], example: "anchor/agent", docsUrl: "https://docs.anchorbrowser.io", status: "verified" },
  openai: { envVars: ["OPENAI_API_KEY"], example: "openai/computer-use-preview", docsUrl: "https://platform.openai.com/docs/guides/tools-computer-use", status: "untested" },
  anthropic: { envVars: ["ANTHROPIC_API_KEY"], example: "anthropic/claude-sonnet-4-5", docsUrl: "https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool", status: "untested" },
  gemini: { envVars: ["GEMINI_API_KEY"], example: "gemini/gemini-3.8-flash", docsUrl: "https://ai.google.dev/gemini-api/docs/computer-use", status: "untested" },
  stagehand: { envVars: ["OPENAI_API_KEY | ANTHROPIC_API_KEY | GEMINI_API_KEY"], example: "stagehand/openai/computer-use-preview", docsUrl: "https://docs.stagehand.dev", status: "untested" },
  "browser-use": { envVars: ["BROWSER_USE_API_KEY"], example: "browser-use/cloud", docsUrl: "https://docs.browser-use.com/cloud", status: "untested" },
  "browser-harness": { envVars: ["OPENAI_API_KEY | ANTHROPIC_API_KEY"], example: "browser-harness/anthropic/claude-sonnet-4-5", docsUrl: "https://github.com/browser-use/browser-harness", status: "untested" },
};

export function describeAdapters(): IntegrationDescriptor[] {
  return listAdapters().map((adapter) => {
    const meta = MODEL_META[adapter.name];
    return {
      id: adapter.name,
      kind: "model",
      name: adapter.name,
      description: adapter.description ?? "",
      envVars: meta?.envVars ?? [],
      configured: adapter.available(),
      docsUrl: meta?.docsUrl,
      select: `model = ${meta?.example ?? `${adapter.name}/<model>`}`,
      status: meta?.status ?? "untested",
    };
  });
}

export { anthropicAdapter, anthropicModelId } from "./anthropic.js";
export { anchorAdapter, matchAnchorTask } from "./anchor.js";
export { browserHarnessAdapter, harnessModelSpec, runHarness } from "./browser-harness.js";
export { browserUseAdapter, browserUseLlm } from "./browser-use.js";
export { createCustomAdapter } from "./custom.js";
export { denormalize, geminiAdapter, geminiKey, geminiModelId, performGeminiAction } from "./gemini.js";
export { openaiAdapter, openaiModelId } from "./openai.js";
export { RECIPE_IDS, describeRecipes, matchSkill, planRun, resolveRecipe, scriptedAdapter, wantsInvoiceDownload } from "./scripted.js";
export type { RecipeId, RecipeInfo } from "./scripted.js";
export type { Plan, Recipe } from "./scripted.js";
export { parseStagehandModel, providerApiKey, stagehandAdapter } from "./stagehand.js";
export { buildSystemPrompt } from "./system-prompt.js";
export { interpolate, isLoginPage, parseProcedure, runSteps } from "./skill-steps.js";
export type { SkillStep, StepContext } from "./skill-steps.js";
export { pickTextProvider, runTextAgent } from "./text-agent.js";
export {
  credentialTools,
  executeTool,
  integrationTools,
  mailTools,
  paymentTools,
  performComputerAction,
  pointerTools,
  sharedTools,
  toolsFor,
} from "./tools.js";
export type { ToolSpec } from "./tools.js";
