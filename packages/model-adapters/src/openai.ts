import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { executeTool, performComputerAction, sharedTools } from "./tools.js";

const MAX_STEPS = 16;

function modelId(model: string): string {
  return model.replace(/^openai\//, "") || "computer-use-preview";
}

interface ResponseItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  action?: Record<string, unknown>;
  content?: unknown;
}

function textFromOutput(output: ResponseItem[], fallback: string): string {
  const chunks: string[] = [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content as Array<{ type?: string; text?: string }>) {
        if (typeof part.text === "string") chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim() || fallback;
}

export const openaiAdapter: CuaAdapter = {
  name: "openai",
  description: "OpenAI Responses API with the computer_use_preview tool. Untested without an API key.",
  available: () => Boolean(process.env.OPENAI_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI adapter selected but OPENAI_API_KEY is not set.");

    let items: unknown[] = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.prompt },
    ];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId(input.model),
          truncation: "auto",
          tools: [
            {
              type: "computer_use_preview",
              display_width: 1280,
              display_height: 800,
              environment: "browser",
            },
            ...sharedTools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          ],
          input: items,
        }),
        signal: input.abortSignal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const data = (await response.json()) as { output?: ResponseItem[]; output_text?: string };
      const output = data.output ?? [];
      items = [...items, ...output];
      const calls = output.filter((item) => item.type === "computer_call" || item.type === "function_call");
      if (calls.length === 0) {
        return { text: data.output_text?.trim() || textFromOutput(output, "Finished.") };
      }

      for (const call of calls) {
        if (call.type === "computer_call") {
          await performComputerAction(input, call.action);
          const shot = await input.computer.screenshot();
          items.push({
            type: "computer_call_output",
            call_id: call.call_id,
            output: {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${shot.data}`,
            },
          });
          continue;
        }
        let args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}") as unknown;
        } catch {
          args = {};
        }
        const result = await executeTool(String(call.name), args, input);
        if (result && typeof result === "object" && "finish" in result && (result as { finish?: boolean }).finish) {
          const finished = result as { text?: string; artifacts?: string[] };
          return { text: finished.text ?? "Finished.", artifacts: finished.artifacts };
        }
        items.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
    }

    throw new Error("OpenAI adapter stopped after 16 steps without finishing.");
  },
};
