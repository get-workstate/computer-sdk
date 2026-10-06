import type { Computer, Credential, Files, Human } from "@workstate/sdk";

export type SkillStep =
  | { op: "open"; url: string }
  | { op: "ensureLoggedIn"; message?: string }
  | { op: "extract"; selector: string; as: string }
  | { op: "openVar"; var: string; index?: number }
  | { op: "saveText"; path: string; text: string }
  | { op: "wait"; ms: number }
  | { op: "output"; text: string };

export interface StepContext {
  computer: Computer;
  files: Files;
  human: Human;
  serverUrl: string;
  abortSignal?: AbortSignal;
  log?: (kind: string, message: string, data?: unknown) => void;
  /** Saved login for this environment; tried before asking a person. */
  credentials?: () => Promise<Credential>;
}

const STEP_OPS = new Set(["open", "ensureLoggedIn", "extract", "openVar", "saveText", "wait", "output"]);

export function interpolate(template: string, vars: Record<string, string | string[] | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)(?:\[(\d+)\])?\s*\}\}/g, (_match, name: string, index: string | undefined) => {
    const value = vars[name];
    if (index !== undefined) {
      const list = Array.isArray(value) ? value : value != null && value !== "" ? [String(value)] : [];
      return list[Number(index)] ?? "";
    }
    if (Array.isArray(value)) return value.join("\n");
    return value == null ? "" : String(value);
  });
}

export function isLoginPage(input: { url?: string; title?: string; text?: string; passwordFields?: number }): boolean {
  if ((input.passwordFields ?? 0) > 0) return true;
  const url = (input.url ?? "").toLowerCase();
  if (/\/login(?:\/|$|\?)/.test(url)) return true;
  const title = (input.title ?? "").toLowerCase();
  return title.includes("sign in") || title.includes("log in");
}

export function parseProcedure(procedure: string): SkillStep[] {
  let data: unknown;
  try {
    data = JSON.parse(procedure) as unknown;
  } catch {
    throw new Error("Skill procedure is not valid JSON.");
  }
  const steps = Array.isArray(data) ? data : (data as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) throw new Error("Skill procedure must be a JSON array of steps.");
  return steps.map(validateStep);
}

function validateStep(value: unknown): SkillStep {
  if (!value || typeof value !== "object" || !("op" in value) || typeof (value as { op: unknown }).op !== "string") {
    throw new Error("Invalid skill step.");
  }
  const step = value as { op: string; url?: unknown; message?: unknown; selector?: unknown; as?: unknown; var?: unknown; index?: unknown; path?: unknown; text?: unknown; ms?: unknown };
  if (!STEP_OPS.has(step.op)) throw new Error(`Unknown skill step "${step.op}".`);
  switch (step.op) {
    case "open":
      if (typeof step.url !== "string") throw new Error("open requires a url.");
      return { op: "open", url: step.url };
    case "ensureLoggedIn":
      return { op: "ensureLoggedIn", message: typeof step.message === "string" ? step.message : undefined };
    case "extract":
      if (typeof step.selector !== "string" || typeof step.as !== "string") throw new Error("extract requires selector and as.");
      return { op: "extract", selector: step.selector, as: step.as };
    case "openVar":
      if (typeof step.var !== "string") throw new Error("openVar requires var.");
      return { op: "openVar", var: step.var, index: typeof step.index === "number" ? step.index : undefined };
    case "saveText":
      if (typeof step.path !== "string" || typeof step.text !== "string") throw new Error("saveText requires path and text.");
      return { op: "saveText", path: step.path, text: step.text };
    case "wait":
      if (typeof step.ms !== "number") throw new Error("wait requires ms.");
      return { op: "wait", ms: step.ms };
    case "output":
      if (typeof step.text !== "string") throw new Error("output requires text.");
      return { op: "output", text: step.text };
    default:
      throw new Error(`Unknown skill step "${step.op}".`);
  }
}

async function onLoginPage(computer: Computer): Promise<boolean> {
  const page = await computer.page();
  const passwords = await computer.extract('input[type="password"]');
  return isLoginPage({ url: page.url, title: page.title, passwordFields: passwords.length });
}

function absolutize(url: string, serverUrl: string, pageUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    if (url.startsWith("/")) return new URL(url, serverUrl).toString();
    return new URL(url, pageUrl || serverUrl).toString();
  } catch {
    return url;
  }
}

export async function runSteps(steps: SkillStep[], ctx: StepContext): Promise<{ text: string; artifacts: string[] }> {
  const vars: Record<string, string | string[]> = {
    serverUrl: ctx.serverUrl.replace(/\/$/, ""),
    date: new Date().toISOString().slice(0, 10),
    title: "",
    url: "",
    pageText: "",
  };
  const artifacts: string[] = [];
  let output = "";
  let lastOpenUrl = "";

  const remember = async (page: { url: string; title: string }) => {
    vars.url = page.url;
    vars.title = page.title;
    vars.pageText = await ctx.computer.text();
  };

  for (const step of steps) {
    if (ctx.abortSignal?.aborted) throw new Error("Run cancelled");
    switch (step.op) {
      case "open": {
        const url = interpolate(step.url, vars);
        lastOpenUrl = url;
        const page = await ctx.computer.open(url);
        await remember(page);
        ctx.log?.("log", `Opened ${page.title || url}`);
        break;
      }
      case "ensureLoggedIn": {
        if (ctx.credentials && (await onLoginPage(ctx.computer))) {
          try {
            const credential = await ctx.credentials();
            await ctx.computer.fill(
              'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[type="text"]',
              credential.username,
            );
            await ctx.computer.fill('input[type="password"]', credential.password);
            await ctx.computer.key("Enter");
            await ctx.computer.wait(1500);
            ctx.log?.("log", "Signed in with the environment's saved credentials");
          } catch (error) {
            ctx.log?.("log", `Saved credentials did not work: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (await onLoginPage(ctx.computer)) {
          await ctx.human.request({
            kind: "login",
            message: step.message ?? "Sign in on the live view, then return control to the agent.",
          });
          if (lastOpenUrl) {
            const page = await ctx.computer.open(lastOpenUrl);
            await remember(page);
          }
          if (await onLoginPage(ctx.computer)) {
            throw new Error("Still on a sign-in page after control was returned.");
          }
        }
        break;
      }
      case "extract": {
        const values = await ctx.computer.extract(step.selector);
        vars[step.as] = values;
        if (values.length === 0) throw new Error(`Nothing matched ${step.selector}.`);
        ctx.log?.("log", `Extracted ${values.length} match${values.length === 1 ? "" : "es"} for ${step.as}`);
        break;
      }
      case "openVar": {
        const raw = vars[step.var];
        const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
        const picked = list[step.index ?? 0];
        if (!picked) throw new Error(`Variable ${step.var} is empty.`);
        const url = absolutize(picked, String(vars.serverUrl), String(vars.url));
        lastOpenUrl = url;
        const page = await ctx.computer.open(url);
        await remember(page);
        ctx.log?.("log", `Opened ${page.title || url}`);
        break;
      }
      case "saveText": {
        const file = interpolate(step.path, vars);
        const body = interpolate(step.text, vars);
        const content = body.endsWith("\n") ? body : `${body}\n`;
        await ctx.files.write(file, content);
        artifacts.push(file);
        ctx.log?.("log", `Saved ${file}`);
        break;
      }
      case "wait": {
        await ctx.computer.wait(step.ms);
        break;
      }
      case "output": {
        output = interpolate(step.text, vars);
        break;
      }
      default:
        throw new Error("Unknown skill step.");
    }
  }

  return { text: output || "Finished.", artifacts };
}
