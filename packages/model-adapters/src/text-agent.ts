import type { AdapterRunInput, AdapterRunResult } from "@workstate/sdk";
import { errorPayload, isFinish, maxSteps } from "./limits.js";
import type { ToolSpec } from "./tools.js";

export interface TextAgentOptions {
  input: AdapterRunInput;
  provider: "openai" | "anthropic";
  model: string;
  tools: ToolSpec[];
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  systemPrompt: string;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * A plain function-calling loop (no screenshots) for harnesses that expose the browser as a
 * tool. Works with OpenAI's Responses API or Anthropic's Messages API.
 */
export async function runTextAgent(options: TextAgentOptions): Promise<AdapterRunResult> {
  const { input, tools, execute } = options;
  const budget = maxSteps();

  const callTool = async (name: string, args: Record<string, unknown>): Promise<{ result: unknown; finished?: AdapterRunResult }> => {
    input.log("tool", name, args);
    try {
      const result = await execute(name, args);
      if (isFinish(result)) return { result, finished: { text: result.text ?? "Finished.", artifacts: result.artifacts } };
      return { result };
    } catch (error) {
      if ((error as { code?: string }).code === "cancelled") throw error;
      return { result: errorPayload(error) };
    }
  };

  if (options.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the Workstate server.");
    const messages: unknown[] = [{ role: "user", content: input.prompt }];
    for (let step = 0; step < budget; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch(`${(process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 4096,
          system: options.systemPrompt,
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
          messages,
        }),
        signal: input.abortSignal,
      });
      if (!response.ok) throw new Error(`Anthropic request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
      const data = (await response.json()) as { content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> };
      const content = data.content ?? [];
      messages.push({ role: "assistant", content });
      const uses = content.filter((block) => block.type === "tool_use");
      if (uses.length === 0) {
        return { text: content.map((block) => block.text ?? "").join("\n").trim() || "Finished." };
      }
      const results: unknown[] = [];
      for (const use of uses) {
        const outcome = await callTool(String(use.name), parseArgs(use.input));
        if (outcome.finished) return outcome.finished;
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(outcome.result) });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error(`Stopped after ${budget} steps without finishing. Raise WORKSTATE_MAX_STEPS to allow more.`);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on the Workstate server.");
  let items: unknown[] = [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: input.prompt },
  ];
  let previousResponseId: string | undefined;
  for (let step = 0; step < budget; step += 1) {
    if (input.abortSignal.aborted) throw new Error("Run cancelled");
    const response = await fetch(`${(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        previous_response_id: previousResponseId,
        tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })),
        input: items,
      }),
      signal: input.abortSignal,
    });
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const data = (await response.json()) as {
      id?: string;
      output?: Array<{ type?: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ text?: string }> }>;
      output_text?: string;
    };
    previousResponseId = data.id;
    const output = data.output ?? [];
    const calls = output.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      const text = data.output_text ?? output.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("\n");
      return { text: text.trim() || "Finished." };
    }
    items = [];
    for (const call of calls) {
      const outcome = await callTool(String(call.name), parseArgs(call.arguments));
      if (outcome.finished) return outcome.finished;
      items.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(outcome.result) });
    }
  }
  throw new Error(`Stopped after ${budget} steps without finishing. Raise WORKSTATE_MAX_STEPS to allow more.`);
}

/** Pick a chat provider for a harness: explicit "<provider>/<model>" suffix, else whichever key is set. */
export function pickTextProvider(spec: string | undefined): { provider: "openai" | "anthropic"; model: string; envVar: string } {
  const trimmed = (spec ?? "").trim();
  if (trimmed.startsWith("anthropic/")) return { provider: "anthropic", model: trimmed.slice("anthropic/".length) || "claude-sonnet-4-5", envVar: "ANTHROPIC_API_KEY" };
  if (trimmed.startsWith("openai/")) return { provider: "openai", model: trimmed.slice("openai/".length) || "gpt-5", envVar: "OPENAI_API_KEY" };
  if (trimmed.startsWith("claude")) return { provider: "anthropic", model: trimmed, envVar: "ANTHROPIC_API_KEY" };
  if (trimmed.startsWith("gpt") || trimmed.startsWith("o")) return { provider: "openai", model: trimmed, envVar: "OPENAI_API_KEY" };
  if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", model: "claude-sonnet-4-5", envVar: "ANTHROPIC_API_KEY" };
  return { provider: "openai", model: "gpt-5", envVar: "OPENAI_API_KEY" };
}
