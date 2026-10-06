import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { executeTool, performComputerAction, sharedTools } from "./tools.js";

const MAX_STEPS = 16;

function modelId(model: string): string {
  return model.replace(/^anthropic\//, "") || "claude-sonnet-4-5";
}

interface ToolUseBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

export const anthropicAdapter: CuaAdapter = {
  name: "anthropic",
  description: "Anthropic Messages API with the computer-use-2025-01-24 beta. Untested without an API key.",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Anthropic adapter selected but ANTHROPIC_API_KEY is not set.");

    const messages: unknown[] = [{ role: "user", content: input.prompt }];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "computer-use-2025-01-24",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId(input.model),
          max_tokens: 4096,
          system: input.systemPrompt,
          tools: [
            {
              type: "computer_20250124",
              name: "computer",
              display_width_px: 1280,
              display_height_px: 800,
            },
            ...sharedTools.map((tool) => ({
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
          await performComputerAction(input, toolUse.input);
          const shot = await input.computer.screenshot();
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: shot.data },
              },
            ],
          });
          continue;
        }
        const result = await executeTool(String(toolUse.name), toolUse.input ?? {}, input);
        if (result && typeof result === "object" && "finish" in result && (result as { finish?: boolean }).finish) {
          const finished = result as { text?: string; artifacts?: string[] };
          return { text: finished.text ?? "Finished.", artifacts: finished.artifacts };
        }
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: results });
    }

    throw new Error("Anthropic adapter stopped after 16 steps without finishing.");
  },
};
