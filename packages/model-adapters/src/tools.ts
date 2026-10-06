import type { AdapterRunInput } from "@workstate/sdk";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const sharedTools: ToolSpec[] = [
  {
    name: "computer_open",
    description: "Open a URL in the environment browser.",
    parameters: object({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "computer_text",
    description: "Read the visible text of the current page.",
    parameters: object({}),
  },
  {
    name: "computer_extract",
    description: "Extract text or link hrefs for a CSS selector on the current page.",
    parameters: object({ selector: { type: "string" } }, ["selector"]),
  },
  {
    name: "shell_exec",
    description: "Run a bash command. /workspace and /workstate/skills are rewritten to the environment directories.",
    parameters: object({ command: { type: "string" } }, ["command"]),
  },
  {
    name: "files_read",
    description: "Read a text file inside /workspace or /workstate/skills.",
    parameters: object({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "files_write",
    description: "Write a text file inside /workspace or /workstate/skills.",
    parameters: object({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  },
  {
    name: "files_list",
    description: "List a directory inside /workspace or /workstate/skills.",
    parameters: object({ path: { type: "string" } }, ["path"]),
  },
  {
    name: "human_request",
    description: "Pause and ask a person for a login, an approval, or an answer. Wait for their response.",
    parameters: object(
      {
        kind: { type: "string", enum: ["login", "approval", "input", "takeover"] },
        message: { type: "string" },
      },
      ["kind", "message"],
    ),
  },
  {
    name: "skills_list",
    description: "List procedures saved in this environment.",
    parameters: object({}),
  },
  {
    name: "skills_write",
    description: "Save a reusable procedure for a later run. procedure is a JSON array of steps.",
    parameters: object(
      {
        name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        procedure: { type: "string" },
      },
      ["name", "description", "tags", "procedure"],
    ),
  },
  {
    name: "finish",
    description: "Finish the run with a short result and optional artifact paths.",
    parameters: object({
      text: { type: "string" },
      artifacts: { type: "array", items: { type: "string" } },
    }, ["text"]),
  },
];

export const pointerTools: ToolSpec[] = [
  {
    name: "computer_click",
    description: "Click a viewport coordinate.",
    parameters: object(
      { x: { type: "number" }, y: { type: "number" }, button: { type: "string", enum: ["left", "right", "middle"] } },
      ["x", "y"],
    ),
  },
  {
    name: "computer_type",
    description: "Type text into the focused element.",
    parameters: object({ text: { type: "string" } }, ["text"]),
  },
  {
    name: "computer_key",
    description: "Press a keyboard key, for example Enter or Control+l.",
    parameters: object({ key: { type: "string" } }, ["key"]),
  },
  {
    name: "computer_scroll",
    description: "Scroll the page by pixel deltas.",
    parameters: object({ dx: { type: "number" }, dy: { type: "number" } }, ["dx", "dy"]),
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function executeTool(name: string, rawArgs: unknown, input: AdapterRunInput): Promise<unknown> {
  const args = asRecord(rawArgs);
  switch (name) {
    case "computer_open":
      return input.computer.open(String(args.url ?? ""));
    case "computer_text":
      return { text: await input.computer.text() };
    case "computer_extract":
      return { values: await input.computer.extract(String(args.selector ?? "")) };
    case "computer_click":
      await input.computer.click(Number(args.x), Number(args.y), (args.button as "left" | "right" | "middle") ?? "left");
      return { ok: true };
    case "computer_type":
      await input.computer.type(String(args.text ?? ""));
      return { ok: true };
    case "computer_key":
      await input.computer.key(String(args.key ?? "Enter"));
      return { ok: true };
    case "computer_scroll":
      await input.computer.scroll(Number(args.dx ?? 0), Number(args.dy ?? 0));
      return { ok: true };
    case "shell_exec":
      return input.shell.exec(String(args.command ?? ""));
    case "files_read":
      return { content: await input.files.read(String(args.path ?? "")) };
    case "files_write":
      await input.files.write(String(args.path ?? ""), String(args.content ?? ""));
      return { path: args.path };
    case "files_list":
      return { entries: await input.files.list(String(args.path ?? "/workspace")) };
    case "human_request":
      return input.human.request({
        kind: (args.kind as "login" | "approval" | "input" | "takeover") ?? "input",
        message: String(args.message ?? "Need a person."),
      });
    case "skills_list":
      return input.skills.list();
    case "skills_write":
      return input.skills.write({
        name: String(args.name ?? ""),
        description: String(args.description ?? ""),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        procedure: String(args.procedure ?? "[]"),
      });
    case "finish":
      return {
        finish: true,
        text: String(args.text ?? ""),
        artifacts: Array.isArray(args.artifacts) ? args.artifacts.map(String) : undefined,
      };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export async function performComputerAction(input: AdapterRunInput, action: Record<string, unknown> | undefined): Promise<void> {
  if (!action) return;
  const type = String(action.type ?? action.action ?? "screenshot");
  const x = Number(action.x ?? (Array.isArray(action.coordinate) ? action.coordinate[0] : 0));
  const y = Number(action.y ?? (Array.isArray(action.coordinate) ? action.coordinate[1] : 0));
  switch (type) {
    case "click":
    case "left_click":
      await input.computer.click(x, y, "left");
      return;
    case "right_click":
      await input.computer.click(x, y, "right");
      return;
    case "middle_click":
      await input.computer.click(x, y, "middle");
      return;
    case "double_click":
    case "doubleClick":
      await input.computer.doubleClick(x, y);
      return;
    case "move":
    case "mouse_move":
      await input.computer.move(x, y);
      return;
    case "type":
      await input.computer.type(String(action.text ?? ""));
      return;
    case "key":
    case "keypress": {
      const keys = Array.isArray(action.keys) ? action.keys.map(String) : [String(action.key ?? action.text ?? "Enter")];
      await input.computer.key(keys.join("+"));
      return;
    }
    case "scroll":
      await input.computer.scroll(Number(action.scroll_x ?? action.dx ?? 0), Number(action.scroll_y ?? action.dy ?? action.scroll_y ?? 0));
      if (typeof action.x === "number" && typeof action.y === "number") await input.computer.move(x, y);
      return;
    case "wait":
      await input.computer.wait(Number(action.ms ?? action.duration ?? 500));
      return;
    case "screenshot":
      return;
    case "back":
      await input.computer.back();
      return;
    default:
      input.log("log", `Ignored unsupported computer action ${type}`);
  }
}
