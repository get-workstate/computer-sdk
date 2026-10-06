import assert from "node:assert/strict";
import test from "node:test";
import type { AdapterRunInput, Computer } from "@workstate/sdk";
import {
  denormalize,
  executeTool,
  geminiKey,
  integrationTools,
  listAdapters,
  parseStagehandModel,
  performComputerAction,
  performGeminiAction,
  pickTextProvider,
  resolveAdapter,
} from "../dist/index.js";

function recordingComputer(): { computer: Computer; calls: string[] } {
  const calls: string[] = [];
  const computer: Computer = {
    open: async (url) => {
      calls.push(`open ${url}`);
      return { url, title: "" };
    },
    screenshot: async () => ({ mimeType: "image/jpeg", data: "", width: 1280, height: 800 }),
    click: async (x, y, button = "left") => {
      calls.push(`click ${x},${y} ${button}`);
    },
    doubleClick: async (x, y) => {
      calls.push(`dblclick ${x},${y}`);
    },
    move: async (x, y) => {
      calls.push(`move ${x},${y}`);
    },
    type: async (text) => {
      calls.push(`type ${text}`);
    },
    key: async (key) => {
      calls.push(`key ${key}`);
    },
    scroll: async (dx, dy) => {
      calls.push(`scroll ${dx},${dy}`);
    },
    wait: async (ms) => {
      calls.push(`wait ${ms}`);
    },
    back: async () => {
      calls.push("back");
    },
    page: async () => ({ url: "about:blank", title: "" }),
    text: async () => "",
    extract: async () => [],
    fill: async (selector, text) => {
      calls.push(`fill ${selector} ${text}`);
    },
  };
  return { computer, calls };
}

test("model ids route to the right adapter", () => {
  assert.equal(resolveAdapter("local/scripted").name, "local");
  assert.equal(resolveAdapter("openai/computer-use-preview").name, "openai");
  assert.equal(resolveAdapter("anthropic/claude-sonnet-4-5").name, "anthropic");
  assert.equal(resolveAdapter("gemini/gemini-3.8-flash").name, "gemini");
  assert.equal(resolveAdapter("google/gemini-3-flash-preview").name, "gemini");
  assert.equal(resolveAdapter("stagehand/openai/computer-use-preview").name, "stagehand");
  assert.equal(resolveAdapter("stagehand-dom/anthropic/claude-sonnet-4-5").name, "stagehand");
  assert.equal(resolveAdapter("browser-use/cloud").name, "browser-use");
  assert.equal(resolveAdapter("browser-harness/anthropic/claude-sonnet-4-5").name, "browser-harness");
  const names = listAdapters().map((adapter) => adapter.name);
  for (const name of ["local", "openai", "anthropic", "gemini", "stagehand", "browser-use", "browser-harness"]) {
    assert.ok(names.includes(name), name);
  }
});

test("adapters that need keys report unavailable without them", () => {
  const saved = { ...process.env };
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "BROWSER_USE_API_KEY"]) delete process.env[key];
  try {
    for (const adapter of listAdapters()) {
      assert.equal(adapter.available(), adapter.name === "local", `${adapter.name} should be unavailable without keys`);
    }
  } finally {
    process.env = saved;
  }
});

test("Gemini actions scale from the 0–999 grid and map to computer calls", async () => {
  assert.equal(denormalize(500, 1280), 640);
  assert.equal(denormalize(999, 800), 799);
  assert.equal(denormalize(0, 800), 0);
  assert.equal(geminiKey("return"), "Enter");
  assert.equal(geminiKey("PageDown"), "PageDown");
  const { computer, calls } = recordingComputer();
  const input = { computer, log: () => undefined };
  const viewport = { width: 1280, height: 800 };
  await performGeminiAction(input, { name: "click", args: { x: 500, y: 500 } }, viewport);
  await performGeminiAction(input, { name: "type_text_at", args: { x: 100, y: 100, text: "hello", press_enter: false } }, viewport);
  await performGeminiAction(input, { name: "scroll", args: { x: 500, y: 500, direction: "down", magnitude_in_pixels: 400 } }, viewport);
  await performGeminiAction(input, { name: "navigate", args: { url: "https://example.com" } }, viewport);
  await performGeminiAction(input, { name: "hotkey", args: { keys: ["ctrl", "l"] } }, viewport);
  const unsupported = await performGeminiAction(input, { name: "drag_and_drop", args: {} }, viewport);
  assert.deepEqual(calls, [
    "click 640,400 left",
    "click 128,80 left",
    "key Control+a",
    "key Backspace",
    "type hello",
    "move 640,400",
    "scroll 0,400",
    "open https://example.com",
    "key Control+l",
  ]);
  assert.match(String(unsupported.error), /Unsupported/);
});

test("Anthropic and OpenAI computer actions both map onto the computer", async () => {
  const { computer, calls } = recordingComputer();
  const input = { computer, log: () => undefined } as unknown as AdapterRunInput;
  await performComputerAction(input, { action: "left_click", coordinate: [10, 20] });
  await performComputerAction(input, { action: "scroll", coordinate: [10, 20], scroll_direction: "down", scroll_amount: 2 });
  await performComputerAction(input, { type: "scroll", x: 5, y: 6, scroll_x: 0, scroll_y: 300 });
  await performComputerAction(input, { type: "keypress", keys: ["CTRL", "L"] });
  assert.deepEqual(calls, ["click 10,20 left", "move 10,20", "scroll 0,240", "move 5,6", "scroll 0,300", "key CTRL+L"]);
});

test("credential fill never exposes the secret and only appears when configured", async () => {
  const { computer, calls } = recordingComputer();
  const seen: unknown[] = [];
  const input = {
    computer,
    log: (_kind: string, message: string, data?: unknown) => seen.push([message, data]),
    integrations: {
      credentialRef: "op://Private/Shop",
      secrets: {
        name: "fake",
        configured: () => true,
        resolve: async () => "x",
        credential: async () => ({ username: "demo@workstate.dev", password: "hunter2" }),
      },
    },
  } as unknown as AdapterRunInput;
  const names = integrationTools(input).map((tool) => tool.name);
  assert.deepEqual(names, ["credentials_fill", "credentials_fill_otp"]);
  assert.deepEqual(integrationTools({ integrations: {} } as unknown as AdapterRunInput), []);
  const result = (await executeTool("credentials_fill", { passwordSelector: "#pw" }, input)) as Record<string, unknown>;
  assert.equal(result.filled, true);
  assert.equal(JSON.stringify(result).includes("hunter2"), false, "tool result must not leak the password");
  assert.equal(JSON.stringify(seen).includes("hunter2"), false, "logs must not leak the password");
  assert.ok(calls.some((call) => call === "fill #pw hunter2"), "the password reaches the browser");
  assert.ok(calls.includes("key Enter"));
});

test("card issuing waits for approval and respects a decline", async () => {
  const created: number[] = [];
  const input = {
    computer: recordingComputer().computer,
    log: () => undefined,
    human: { request: async () => ({ id: "h", action: "decline" }) },
    integrations: {
      payments: {
        name: "fake",
        configured: () => true,
        createCard: async ({ amountCents }: { amountCents: number }) => {
          created.push(amountCents);
          return { id: "card_1", amountCents };
        },
        cardDetails: async () => ({ id: "card_1", amountCents: 1, number: "4", cvv: "1" }),
        closeCard: async () => undefined,
      },
    },
  } as unknown as AdapterRunInput;
  const declined = (await executeTool("card_create", { amountCents: 2500 }, input)) as { approved: boolean };
  assert.equal(declined.approved, false);
  assert.deepEqual(created, []);
  (input.human as { request: unknown }).request = async () => ({ id: "h", action: "approve" });
  const approved = (await executeTool("card_create", { amountCents: 2500, memo: "shoes" }, input)) as { approved: boolean; card: { id: string } };
  assert.equal(approved.approved, true);
  assert.equal(approved.card.id, "card_1");
  assert.deepEqual(created, [2500]);
});

test("harness model specs pick providers", () => {
  assert.deepEqual(parseStagehandModel("stagehand/openai/computer-use-preview"), { mode: "cua", modelName: "openai/computer-use-preview", provider: "openai" });
  assert.deepEqual(parseStagehandModel("stagehand-dom/anthropic/claude-sonnet-4-5"), { mode: "dom", modelName: "anthropic/claude-sonnet-4-5", provider: "anthropic" });
  assert.equal(parseStagehandModel("stagehand/gemini-3-flash-preview").provider, "google");
  assert.equal(pickTextProvider("anthropic/claude-sonnet-4-5").provider, "anthropic");
  assert.equal(pickTextProvider("openai/gpt-5").model, "gpt-5");
});
