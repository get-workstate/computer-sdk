import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { errorPayload, isFinish, maxSteps } from "./limits.js";
import { executeTool, performComputerAction, toolsFor } from "./tools.js";

export function openaiModelId(model: string): string {
  const stripped = model.replace(/^openai\//, "").trim();
  return stripped && stripped !== "openai" ? stripped : "computer-use-preview";
}

interface ResponseItem {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  action?: Record<string, unknown>;
  content?: unknown;
  pending_safety_checks?: Array<{ id: string; code?: string; message?: string }>;
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

/**
 * OpenAI Responses API with the computer_use_preview tool plus Workstate's function tools.
 * Safety checks the model flags are routed to a person through the live panel.
 */
export const openaiAdapter: CuaAdapter = {
  name: "openai",
  description: "OpenAI computer-use models through the Responses API (model ids openai/<model>, default computer-use-preview).",
  available: () => Boolean(process.env.OPENAI_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI adapter selected but OPENAI_API_KEY is not set on the Workstate server.");
    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const first = await input.computer.screenshot();
    const tools = toolsFor(input);

    let items: unknown[] = [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: [
          { type: "input_text", text: input.prompt },
          { type: "input_image", image_url: `data:${first.mimeType};base64,${first.data}`, detail: "auto" },
        ],
      },
    ];
    let previousResponseId: string | undefined;
    const budget = maxSteps();

    for (let step = 0; step < budget; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: openaiModelId(input.model),
          truncation: "auto",
          previous_response_id: previousResponseId,
          tools: [
            {
              type: "computer_use_preview",
              display_width: first.width,
              display_height: first.height,
              environment: "browser",
            },
            ...tools.map((tool) => ({
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
      const data = (await response.json()) as { id?: string; output?: ResponseItem[]; output_text?: string };
      const output = data.output ?? [];
      previousResponseId = data.id;
      items = [];
      const calls = output.filter((item) => item.type === "computer_call" || item.type === "function_call");
      if (calls.length === 0) {
        return { text: data.output_text?.trim() || textFromOutput(output, "Finished.") };
      }

      for (const call of calls) {
        if (call.type === "computer_call") {
          const checks = call.pending_safety_checks ?? [];
          if (checks.length > 0) {
            const summary = checks.map((check) => check.message ?? check.code ?? check.id).join("; ");
            const decision = await input.human.request({ kind: "approval", message: `OpenAI flagged this action: ${summary}. Continue?` });
            if (decision.action !== "approve") throw new Error(`Stopped at a safety check: ${summary}`);
          }
          const actionType = String(call.action?.type ?? "action");
          input.log("action", `${actionType}`, call.action);
          await performComputerAction(input, call.action);
          const shot = await input.computer.screenshot();
          const page = await input.computer.page().catch(() => null);
          items.push({
            type: "computer_call_output",
            call_id: call.call_id,
            acknowledged_safety_checks: checks,
            output: {
              type: "computer_screenshot",
              image_url: `data:${shot.mimeType};base64,${shot.data}`,
            },
            ...(page ? { current_url: page.url } : {}),
          });
          continue;
        }
        let args: unknown = {};
        try {
          args = JSON.parse(call.arguments || "{}") as unknown;
        } catch {
          args = {};
        }
        input.log("tool", String(call.name), args);
        let result: unknown;
        try {
          result = await executeTool(String(call.name), args, input);
        } catch (error) {
          if ((error as { code?: string }).code === "cancelled") throw error;
          result = errorPayload(error);
        }
        if (isFinish(result)) return { text: result.text ?? "Finished.", artifacts: result.artifacts };
        items.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
      }
    }

    throw new Error(`OpenAI adapter stopped after ${budget} steps without finishing. Raise WORKSTATE_MAX_STEPS to allow more.`);
  },
};
