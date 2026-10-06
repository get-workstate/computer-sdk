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

export const credentialTools: ToolSpec[] = [
  {
    name: "credentials_fill",
    description:
      "Fill the environment's saved login (from 1Password) into the username and password fields on the current page. The secret never enters the conversation. Returns the field selectors used and whether a one-time code was also available.",
    parameters: object(
      {
        usernameSelector: { type: "string", description: "CSS selector of the username/email field. Defaults to a heuristic." },
        passwordSelector: { type: "string", description: "CSS selector of the password field. Defaults to input[type=password]." },
        submit: { type: "boolean", description: "Press Enter in the password field afterwards. Defaults to true." },
      },
      [],
    ),
  },
  {
    name: "credentials_fill_otp",
    description: "Fill the current one-time password from the saved 1Password login into a selector. Only works when the item has a TOTP field.",
    parameters: object({ selector: { type: "string" } }, ["selector"]),
  },
];

export const mailTools: ToolSpec[] = [
  {
    name: "mail_address",
    description: "Return the environment's AgentMail address, for sign-ups and verification emails.",
    parameters: object({}),
  },
  {
    name: "mail_list",
    description: "List the latest emails in the environment inbox (newest first).",
    parameters: object({ limit: { type: "number" } }, []),
  },
  {
    name: "mail_wait_for_code",
    description: "Wait up to two minutes for a new email containing a verification code and return the code.",
    parameters: object({ from: { type: "string", description: "Only accept mail whose sender contains this text." } }, []),
  },
];

export const paymentTools: ToolSpec[] = [
  {
    name: "card_create",
    description:
      "Ask a person to approve issuing a single-use virtual card (Agentcard) for the given amount, then issue it. Returns the card id, last4, and expiry. Use card_details to read the number at checkout.",
    parameters: object({ amountCents: { type: "number" }, memo: { type: "string" } }, ["amountCents"]),
  },
  {
    name: "card_details",
    description: "Return the number, expiry, and CVV for a card issued in this run so you can type it into a checkout form.",
    parameters: object({ cardId: { type: "string" } }, ["cardId"]),
  },
  {
    name: "card_close",
    description: "Close a card issued in this run and release its funds.",
    parameters: object({ cardId: { type: "string" } }, ["cardId"]),
  },
];

/** The tools an adapter should expose for this run, based on which integrations the environment enabled. */
export function integrationTools(input: AdapterRunInput): ToolSpec[] {
  const tools: ToolSpec[] = [];
  if (input.integrations?.secrets && input.integrations.credentialRef) tools.push(...credentialTools);
  if (input.integrations?.mail) tools.push(...mailTools);
  if (input.integrations?.payments) tools.push(...paymentTools);
  return tools;
}

export function toolsFor(input: AdapterRunInput, options: { pointer?: boolean } = {}): ToolSpec[] {
  return [...sharedTools, ...(options.pointer ? pointerTools : []), ...integrationTools(input)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const USERNAME_SELECTOR =
  'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[type="text"]';

async function fillCredentials(args: Record<string, unknown>, input: AdapterRunInput): Promise<unknown> {
  const secrets = input.integrations?.secrets;
  const ref = input.integrations?.credentialRef;
  if (!secrets || !ref) throw new Error("This environment has no saved credentials. Set config.credentials to an op:// reference.");
  const credential = await secrets.credential(ref);
  const usernameSelector = String(args.usernameSelector || USERNAME_SELECTOR);
  const passwordSelector = String(args.passwordSelector || 'input[type="password"]');
  await input.computer.fill(usernameSelector, credential.username);
  await input.computer.fill(passwordSelector, credential.password);
  input.log("log", `Filled saved credentials from ${ref}`);
  if (args.submit !== false) {
    await input.computer.key("Enter");
    await input.computer.wait(1500);
  }
  return { filled: true, usernameSelector, passwordSelector, submitted: args.submit !== false, otpAvailable: Boolean(credential.otp) };
}

async function fillOtp(args: Record<string, unknown>, input: AdapterRunInput): Promise<unknown> {
  const secrets = input.integrations?.secrets;
  const ref = input.integrations?.credentialRef;
  if (!secrets || !ref) throw new Error("This environment has no saved credentials.");
  const credential = await secrets.credential(ref);
  if (!credential.otp) throw new Error("The saved login has no one-time password field.");
  await input.computer.fill(String(args.selector ?? 'input[autocomplete="one-time-code"]'), credential.otp);
  return { filled: true };
}

async function createCard(args: Record<string, unknown>, input: AdapterRunInput): Promise<unknown> {
  const payments = input.integrations?.payments;
  if (!payments) throw new Error("Payments are not enabled on this environment. Set config.payments to \"agentcard\".");
  const amountCents = Math.round(Number(args.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer.");
  const memo = typeof args.memo === "string" ? args.memo : undefined;
  const dollars = (amountCents / 100).toFixed(2);
  const approval = await input.human.request({
    kind: "approval",
    message: `Approve a single-use card for $${dollars}${memo ? ` — ${memo}` : ""}?`,
  });
  if (approval.action !== "approve") return { approved: false, message: "A person declined the card." };
  const card = await payments.createCard({ amountCents, memo });
  input.log("log", `Issued card ${card.id} for $${dollars}`, { cardId: card.id, amountCents });
  return { approved: true, card };
}

export async function executeTool(name: string, rawArgs: unknown, input: AdapterRunInput): Promise<unknown> {
  const args = asRecord(rawArgs);
  switch (name) {
    case "credentials_fill":
      return fillCredentials(args, input);
    case "credentials_fill_otp":
      return fillOtp(args, input);
    case "mail_address": {
      const mail = input.integrations?.mail;
      if (!mail) throw new Error("This environment has no mailbox.");
      return { address: await mail.address() };
    }
    case "mail_list": {
      const mail = input.integrations?.mail;
      if (!mail) throw new Error("This environment has no mailbox.");
      return { messages: await mail.list(Number(args.limit ?? 10)) };
    }
    case "mail_wait_for_code": {
      const mail = input.integrations?.mail;
      if (!mail) throw new Error("This environment has no mailbox.");
      const found = await mail.waitForCode({ from: typeof args.from === "string" ? args.from : undefined, signal: input.abortSignal });
      return { code: found.code, from: found.message.from, subject: found.message.subject };
    }
    case "card_create":
      return createCard(args, input);
    case "card_details": {
      const payments = input.integrations?.payments;
      if (!payments) throw new Error("Payments are not enabled on this environment.");
      return payments.cardDetails(String(args.cardId ?? ""));
    }
    case "card_close": {
      const payments = input.integrations?.payments;
      if (!payments) throw new Error("Payments are not enabled on this environment.");
      await payments.closeCard(String(args.cardId ?? ""));
      return { closed: true };
    }
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
    case "scroll": {
      if (typeof action.x === "number" || Array.isArray(action.coordinate)) await input.computer.move(x, y);
      // OpenAI sends pixel deltas; Anthropic sends a direction plus a tick count.
      let dx = Number(action.scroll_x ?? action.dx ?? 0);
      let dy = Number(action.scroll_y ?? action.dy ?? 0);
      if (typeof action.scroll_direction === "string") {
        const ticks = Number(action.scroll_amount ?? 3) * 120;
        const direction = action.scroll_direction;
        dx = direction === "left" ? -ticks : direction === "right" ? ticks : 0;
        dy = direction === "up" ? -ticks : direction === "down" ? ticks : 0;
      }
      await input.computer.scroll(dx, dy);
      return;
    }
    case "triple_click":
      await input.computer.click(x, y, "left");
      await input.computer.doubleClick(x, y);
      return;
    case "cursor_position":
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
