import type { CuaAdapter } from "@workstate/sdk";
import { anthropicAdapter } from "./anthropic.js";
import { openaiAdapter } from "./openai.js";
import { scriptedAdapter } from "./scripted.js";

const registry = new Map<string, CuaAdapter>();

export function registerAdapter(adapter: CuaAdapter): void {
  registry.set(adapter.name, adapter);
}

export function listAdapters(): CuaAdapter[] {
  const extras = [...registry.values()].filter(
    (adapter) => !["local", "openai", "anthropic"].includes(adapter.name),
  );
  return [scriptedAdapter, openaiAdapter, anthropicAdapter, ...extras];
}

export function defaultModel(): string {
  if (process.env.WORKSTATE_DEFAULT_MODEL) return process.env.WORKSTATE_DEFAULT_MODEL;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic/claude-sonnet-4-5";
  if (process.env.OPENAI_API_KEY) return "openai/computer-use-preview";
  return "local/scripted";
}

export function resolveAdapter(model?: string): CuaAdapter {
  const requested = (model ?? defaultModel()).trim();
  if (registry.has(requested)) return registry.get(requested)!;
  if (requested === "local" || requested === "local/scripted" || requested.startsWith("local/")) return scriptedAdapter;
  if (requested.startsWith("openai/") || requested.startsWith("gpt") || requested.includes("computer-use")) return openaiAdapter;
  if (requested.startsWith("anthropic/") || requested.startsWith("claude")) return anthropicAdapter;
  return scriptedAdapter;
}

export { anthropicAdapter } from "./anthropic.js";
export { createCustomAdapter } from "./custom.js";
export { openaiAdapter } from "./openai.js";
export { scriptedAdapter, matchSkill, planRun, resolveRecipe } from "./scripted.js";
export type { Plan, Recipe } from "./scripted.js";
export { buildSystemPrompt } from "./system-prompt.js";
export { interpolate, isLoginPage, parseProcedure, runSteps } from "./skill-steps.js";
export type { SkillStep, StepContext } from "./skill-steps.js";
export { executeTool, performComputerAction, pointerTools, sharedTools } from "./tools.js";
export type { ToolSpec } from "./tools.js";
