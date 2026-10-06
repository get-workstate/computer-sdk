import type { AdapterRunInput, AdapterRunResult, CuaAdapter } from "@workstate/sdk";
import { errorPayload, isFinish, maxSteps } from "./limits.js";
import { executeTool, toolsFor } from "./tools.js";

export function geminiModelId(model: string): string {
  const stripped = model.replace(/^(gemini|google)\//, "").trim();
  return stripped && stripped !== "gemini" && stripped !== "google" ? stripped : "gemini-3.8-flash";
}

interface FunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: FunctionCall;
  inlineData?: { mimeType: string; data: string };
}

interface Content {
  role: string;
  parts: Part[];
}

/** Gemini computer-use coordinates are on a 0–999 grid; scale them to the viewport. */
export function denormalize(value: unknown, size: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(size - 1, Math.floor((n / 1000) * size)));
}

const GEMINI_KEY_MAP: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  space: " ",
  backspace: "Backspace",
  tab: "Tab",
  delete: "Delete",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  ctrl: "Control",
  control: "Control",
  cmd: "Meta",
  meta: "Meta",
  alt: "Alt",
  shift: "Shift",
};

export function geminiKey(key: string): string {
  return GEMINI_KEY_MAP[key.toLowerCase()] ?? (key.length === 1 ? key : key.charAt(0).toUpperCase() + key.slice(1));
}

/** Execute one Gemini computer-use action against a Workstate computer. Returns extra result fields. */
export async function performGeminiAction(
  input: Pick<AdapterRunInput, "computer" | "log">,
  call: FunctionCall,
  viewport: { width: number; height: number },
): Promise<Record<string, unknown>> {
  const args = call.args ?? {};
  const x = denormalize(args.x, viewport.width);
  const y = denormalize(args.y, viewport.height);
  switch (call.name) {
    case "click":
      await input.computer.click(x, y, "left");
      return {};
    case "double_click":
      await input.computer.doubleClick(x, y);
      return {};
    case "triple_click":
      await input.computer.click(x, y, "left");
      await input.computer.doubleClick(x, y);
      return {};
    case "right_click":
      await input.computer.click(x, y, "right");
      return {};
    case "middle_click":
      await input.computer.click(x, y, "middle");
      return {};
    case "move":
      await input.computer.move(x, y);
      return {};
    case "type":
    case "type_text_at": {
      if (args.x !== undefined && args.y !== undefined) await input.computer.click(x, y, "left");
      if (args.clear_before_typing !== false && call.name === "type_text_at") {
        await input.computer.key("Control+a");
        await input.computer.key("Backspace");
      }
      await input.computer.type(String(args.text ?? ""));
      if (args.press_enter === true || (call.name === "type_text_at" && args.press_enter !== false)) await input.computer.key("Enter");
      return {};
    }
    case "press_key":
      await input.computer.key(geminiKey(String(args.key ?? "Enter")));
      return {};
    case "hotkey": {
      const keys = Array.isArray(args.keys) ? args.keys.map((key) => geminiKey(String(key))) : [];
      if (keys.length > 0) await input.computer.key(keys.join("+"));
      return {};
    }
    case "scroll":
    case "scroll_document":
    case "scroll_at": {
      if (args.x !== undefined && args.y !== undefined) await input.computer.move(x, y);
      const magnitude = Number(args.magnitude_in_pixels ?? args.magnitude ?? 300);
      const direction = String(args.direction ?? "down");
      const dx = direction === "left" ? -magnitude : direction === "right" ? magnitude : 0;
      const dy = direction === "up" ? -magnitude : direction === "down" ? magnitude : 0;
      await input.computer.scroll(dx, dy);
      return {};
    }
    case "navigate":
      await input.computer.open(String(args.url ?? ""));
      return {};
    case "go_back":
      await input.computer.back();
      return {};
    case "go_forward":
      await input.computer.key("Alt+ArrowRight");
      return {};
    case "wait":
    case "wait_5_seconds":
      await input.computer.wait(Math.min(Number(args.seconds ?? 1), 10) * 1000);
      return {};
    case "take_screenshot":
    case "search":
    case "open_web_browser":
      return {};
    default:
      input.log("log", `Ignored unsupported Gemini action ${call.name}`);
      return { error: `Unsupported action ${call.name}` };
  }
}

const COMPUTER_ACTIONS = new Set([
  "click",
  "double_click",
  "triple_click",
  "right_click",
  "middle_click",
  "mouse_down",
  "mouse_up",
  "move",
  "type",
  "type_text_at",
  "drag_and_drop",
  "press_key",
  "key_down",
  "key_up",
  "hotkey",
  "scroll",
  "scroll_document",
  "scroll_at",
  "navigate",
  "go_back",
  "go_forward",
  "wait",
  "wait_5_seconds",
  "take_screenshot",
  "search",
  "open_web_browser",
]);

/**
 * Gemini computer use through the Gemini API generateContent endpoint. The built-in computer_use
 * tool drives the browser; Workstate's function declarations add files, shell, skills, and handoff.
 */
export const geminiAdapter: CuaAdapter = {
  name: "gemini",
  description: "Google Gemini computer use through the Gemini API (model ids gemini/<model>, default gemini-3.8-flash).",
  available: () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("Gemini adapter selected but GEMINI_API_KEY is not set on the Workstate server.");
    const baseUrl = (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const model = geminiModelId(input.model);
    const first = await input.computer.screenshot();
    const viewport = { width: first.width, height: first.height };
    const tools = toolsFor(input);

    const contents: Content[] = [
      {
        role: "user",
        parts: [{ text: input.prompt }, { inlineData: { mimeType: first.mimeType, data: first.data } }],
      },
    ];
    const budget = maxSteps();

    for (let step = 0; step < budget; step += 1) {
      if (input.abortSignal.aborted) throw new Error("Run cancelled");
      const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemPrompt }] },
          contents,
          tools: [
            { computerUse: { environment: "ENVIRONMENT_BROWSER" } },
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: stripAdditional(tool.parameters),
              })),
            },
          ],
        }),
        signal: input.abortSignal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const data = (await response.json()) as { candidates?: Array<{ content?: Content; finishReason?: string }> };
      const candidate = data.candidates?.[0];
      const content = candidate?.content ?? { role: "model", parts: [] };
      contents.push(content);
      const calls = content.parts.filter((part) => part.functionCall).map((part) => part.functionCall!);
      if (calls.length === 0) {
        const text = content.parts
          .filter((part) => typeof part.text === "string" && !part.thought)
          .map((part) => part.text)
          .join("\n")
          .trim();
        return { text: text || "Finished." };
      }

      const responses: Part[] = [];
      for (const call of calls) {
        const args = call.args ?? {};
        const safety = args.safety_decision as { decision?: string; explanation?: string } | undefined;
        let acknowledged = false;
        if (safety?.decision === "require_confirmation") {
          const decision = await input.human.request({
            kind: "approval",
            message: `Gemini wants to ${call.name}${safety.explanation ? `: ${safety.explanation}` : ""}. Continue?`,
          });
          if (decision.action !== "approve") throw new Error(`Stopped at a safety check before ${call.name}.`);
          acknowledged = true;
        }
        if (COMPUTER_ACTIONS.has(call.name)) {
          input.log("action", `${call.name}${args.intent ? ` — ${String(args.intent)}` : ""}`, args);
          let extra: Record<string, unknown> = {};
          try {
            extra = await performGeminiAction(input, call, viewport);
          } catch (error) {
            extra = errorPayload(error);
          }
          const shot = await input.computer.screenshot();
          const page = await input.computer.page().catch(() => ({ url: "", title: "" }));
          responses.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { url: page.url, ...extra, ...(acknowledged ? { safety_acknowledgement: "true" } : {}) },
              parts: [{ inlineData: { mimeType: shot.mimeType, data: shot.data } }],
            },
          } as Part);
          continue;
        }
        input.log("tool", call.name, args);
        let result: unknown;
        try {
          result = await executeTool(call.name, args, input);
        } catch (error) {
          if ((error as { code?: string }).code === "cancelled") throw error;
          result = errorPayload(error);
        }
        if (isFinish(result)) return { text: result.text ?? "Finished.", artifacts: result.artifacts };
        responses.push({
          functionResponse: { id: call.id, name: call.name, response: wrapResponse(result) },
        } as Part);
      }
      contents.push({ role: "user", parts: responses });
    }

    throw new Error(`Gemini adapter stopped after ${budget} steps without finishing. Raise WORKSTATE_MAX_STEPS to allow more.`);
  },
};

function wrapResponse(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
  return { result };
}

/** Gemini's OpenAPI subset rejects additionalProperties. */
function stripAdditional(schema: Record<string, unknown>): Record<string, unknown> {
  const { additionalProperties, ...rest } = schema;
  void additionalProperties;
  if (Array.isArray(rest.required) && rest.required.length === 0) delete rest.required;
  if (rest.properties && typeof rest.properties === "object") {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest.properties as Record<string, unknown>)) {
      properties[key] = value && typeof value === "object" ? stripAdditional(value as Record<string, unknown>) : value;
    }
    rest.properties = properties;
  }
  return rest;
}
