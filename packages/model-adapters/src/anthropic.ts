import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { errorPayload, isFinish, maxSteps } from "./limits.js";
import { executeTool, performComputerAction, toolsFor } from "./tools.js";

export function anthropicModelId(model: string): string {
  const stripped = model.replace(/^anthropic\//, "").trim();
  return stripped && stripped !== "anthropic" ? stripped : "claude-sonnet-4-5";
}

interface ToolUseBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

/**
 * Anthropic Messages API with the computer tool (computer-use-2025-01-24 beta) plus Workstate's
 * function tools. Screenshots are JPEG at the environment viewport.
 */
export const anthropicAdapter: CuaAdapter = {
  name: "anthropic",
  description: "Anthropic Claude computer use through the Messages API (model ids anthropic/<model>, default claude-sonnet-4-5).",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Anthropic adapter selected but ANTHROPIC_API_KEY is not set on the Workstate server.");
    const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
    const first = await input.computer.screenshot();
    const tools = toolsFor(input);

    const messages: unknown[] = [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image", source: { type: "base64", media_type: first.mimeType, data: first.data } },
        ],
      },
    ];
    const budget = maxSteps();

    for (let step = 0; step < budget; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "computer-use-2025-01-24",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: anthropicModelId(input.model),
          max_tokens: 4096,
          system: input.systemPrompt,
          tools: [
            {
              type: "computer_20250124",
              name: "computer",
              display_width_px: first.width,
              display_height_px: first.height,
            },
            ...tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          ],
          messages,
        }),
        signal: input.abortSignal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Anthropic request failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const data = (await response.json()) as { stop_reason?: string; content?: ToolUseBlock[] };
      const content = data.content ?? [];
      messages.push({ role: "assistant", content });
      const toolUses = content.filter((block) => block.type === "tool_use");
      if (toolUses.length === 0) {
        const text = content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
        return { text: text || "Finished." };
      }

      const results: unknown[] = [];
      for (const toolUse of toolUses) {
        if (toolUse.name === "computer") {
          input.log("action", String(toolUse.input?.action ?? "action"), toolUse.input);
          let failure: string | null = null;
          try {
            await performComputerAction(input, toolUse.input);
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
          }
          const shot = await input.computer.screenshot();
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: Boolean(failure),
            content: [
              ...(failure ? [{ type: "text", text: failure }] : []),
              { type: "image", source: { type: "base64", media_type: shot.mimeType, data: shot.data } },
            ],
          });
          continue;
        }
        input.log("tool", String(toolUse.name), toolUse.input);
        let result: unknown;
        let isError = false;
        try {
          result = await executeTool(String(toolUse.name), toolUse.input ?? {}, input);
        } catch (error) {
          if ((error as { code?: string }).code === "cancelled") throw error;
          result = errorPayload(error);
          isError = true;
        }
        if (isFinish(result)) return { text: result.text ?? "Finished.", artifacts: result.artifacts };
        results.push({ type: "tool_result", tool_use_id: toolUse.id, is_error: isError, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });
    }

    throw new Error(`Anthropic adapter stopped after ${budget} steps without finishing. Raise WORKSTATE_MAX_STEPS to allow more.`);
  },
};
