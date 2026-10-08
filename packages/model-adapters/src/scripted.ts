import type { CuaAdapter, Skill } from "@workstate/sdk";
import { parseProcedure, runSteps, type SkillStep } from "./skill-steps.js";

const LOGIN_MESSAGE =
  "The demo shop is waiting for a sign-in. Use demo@workstate.dev / workstate on the live screen, then return control to the agent.";

export interface Recipe {
  name: string;
  description: string;
  tags: string[];
  steps: SkillStep[];
  persist: boolean;
}

export interface Plan extends Recipe {
  source: "skill" | "recipe";
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
}

export function matchSkill(skills: Skill[], prompt: string): Skill | null {
  const tokens = new Set(tokenize(prompt));
  let best: { skill: Skill; score: number } | null = null;
  for (const skill of skills) {
    const score = skill.tags.filter((tag) => tokens.has(tag.toLowerCase())).length;
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && skill.updatedAt > best.skill.updatedAt)) {
      best = { skill, score };
    }
  }
  return best?.skill ?? null;
}

export const RECIPE_IDS = ["download-latest-invoice", "summarize-hacker-news", "open-url"] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export interface RecipeInfo {
  id: RecipeId;
  description: string;
  match: string;
  persist: boolean;
  human?: "login";
}

/** True when the prompt asks to download an invoice, not merely when it names a shop. */
export function wantsInvoiceDownload(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /\bdownload\b[\s\S]{0,80}\binvoice\b|\binvoice\b[\s\S]{0,80}\bdownload\b|\blatest invoice\b/.test(lower);
}

function invoiceRecipe(): Recipe {
  return {
    name: "download-latest-invoice",
    description: "Download the latest invoice from the bundled demo shop and save it under /workspace/invoices.",
    tags: ["invoice", "download", "shop", "demo", "latest"],
    persist: true,
    steps: [
      { op: "open", url: "{{serverUrl}}/demo/shop/orders" },
      { op: "ensureLoggedIn", message: LOGIN_MESSAGE },
      { op: "extract", selector: "[data-order-id]", as: "orderId" },
      { op: "extract", selector: "[data-order-total]", as: "total" },
      { op: "extract", selector: "a[data-invoice]", as: "invoiceUrl" },
      { op: "openVar", var: "invoiceUrl" },
      { op: "saveText", path: "/workspace/invoices/{{orderId[0]}}.txt", text: "{{pageText}}" },
      {
        op: "output",
        text: "Saved invoice {{orderId[0]}} ({{total[0]}}) to /workspace/invoices/{{orderId[0]}}.txt",
      },
    ],
  };
}

function hackerNewsRecipe(): Recipe {
  return {
    name: "summarize-hacker-news",
    description: "Save the titles from the Hacker News front page.",
    tags: ["hacker", "news", "summarize", "hn", "frontpage"],
    persist: true,
    steps: [
      { op: "open", url: "https://news.ycombinator.com/" },
      { op: "extract", selector: ".titleline a", as: "titles" },
      { op: "saveText", path: "/workspace/hacker-news-{{date}}.txt", text: "{{titles}}" },
      { op: "output", text: "Saved the Hacker News front page to /workspace/hacker-news-{{date}}.txt" },
    ],
  };
}

function openUrlRecipe(url: string): Recipe {
  return {
    name: "open-url",
    description: `Open ${url} and save the visible text.`,
    tags: ["open", "url", "page"],
    persist: false,
    steps: [
      { op: "open", url },
      { op: "saveText", path: "/workspace/pages/page.txt", text: "{{title}}\n{{url}}\n\n{{pageText}}" },
      { op: "output", text: "Saved {{title}} to /workspace/pages/page.txt" },
    ],
  };
}

export function describeRecipes(): RecipeInfo[] {
  return [
    {
      id: "download-latest-invoice",
      description: invoiceRecipe().description,
      match: "Asks to download an invoice, or mentions an invoice or the demo shop and does not include an explicit URL.",
      persist: true,
      human: "login",
    },
    {
      id: "summarize-hacker-news",
      description: hackerNewsRecipe().description,
      match: "Mentions Hacker News, Y Combinator, or HN, and does not include an explicit URL.",
      persist: true,
    },
    {
      id: "open-url",
      description: "Open the first http(s) URL in the prompt and save the visible text.",
      match: "Contains an http(s) URL. An explicit URL wins over the words invoice and demo shop unless the prompt also asks to download an invoice.",
      persist: false,
    },
  ];
}

export function resolveRecipe(prompt: string, ctx: { serverUrl: string; recipe?: string }): Recipe | null {
  const lower = prompt.toLowerCase();
  const urlMatch = prompt.match(/https?:\/\/[^\s)]+/);
  const forced = ctx.recipe?.trim();
  void ctx.serverUrl;

  if (forced === "download-latest-invoice") return invoiceRecipe();
  if (forced === "summarize-hacker-news") return hackerNewsRecipe();
  if (forced === "open-url") return urlMatch ? openUrlRecipe(urlMatch[0]) : null;
  if (forced) return null;

  // An explicit URL is the task, unless the prompt also asks to download an invoice.
  if (urlMatch && !wantsInvoiceDownload(prompt)) return openUrlRecipe(urlMatch[0]);
  if (wantsInvoiceDownload(prompt) || /\binvoice\b|\bdemo shop\b/.test(lower)) return invoiceRecipe();
  if (/hacker news|\bycombinator\b|\bhn\b/.test(lower)) return hackerNewsRecipe();
  if (urlMatch) return openUrlRecipe(urlMatch[0]);
  return null;
}

export function planRun(prompt: string, skills: Skill[], ctx: { serverUrl: string; recipe?: string }): Plan | null {
  if (!ctx.recipe) {
    const matched = matchSkill(skills, prompt);
    if (matched) {
      return {
        source: "skill",
        name: matched.name,
        description: matched.description,
        tags: matched.tags,
        steps: parseProcedure(matched.procedure),
        persist: false,
      };
    }
  }
  const recipe = resolveRecipe(prompt, ctx);
  if (!recipe) return null;
  return { source: "recipe", ...recipe };
}

const NO_RECIPE =
  "No scripted recipe matches this task. The local adapter can download the latest demo shop invoice, summarize Hacker News, or open an explicit URL. Pass recipe on the run, or set OPENAI_API_KEY or ANTHROPIC_API_KEY for open-ended tasks.";

function planError(code: "no_recipe" | "invalid_recipe", message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export const scriptedAdapter: CuaAdapter = {
  name: "local",
  description: "Keyless scripted adapter for the demo shop, Hacker News, and explicit URLs.",
  available: () => true,
  async run(input) {
    const existing = await input.skills.list();
    const plan = planRun(input.prompt, existing, { serverUrl: input.serverUrl, recipe: input.recipe });
    if (!plan) {
      throw planError(
        input.recipe ? "invalid_recipe" : "no_recipe",
        input.recipe ? `Recipe "${input.recipe}" does not apply to this prompt.` : NO_RECIPE,
      );
    }
    input.log("plan", plan.source === "skill" ? `Reusing skill ${plan.name}` : `Using recipe ${plan.name}`, {
      source: plan.source,
      name: plan.name,
    });
    const result = await runSteps(plan.steps, {
      computer: input.computer,
      files: input.files,
      human: input.human,
      serverUrl: input.serverUrl,
      abortSignal: input.abortSignal,
      log: input.log,
      credentials:
        input.integrations?.secrets && input.integrations.credentialRef
          ? () => input.integrations!.secrets!.credential(input.integrations!.credentialRef!)
          : undefined,
    });
    if (plan.persist) {
      await input.skills.write({
        name: plan.name,
        description: plan.description,
        tags: plan.tags,
        procedure: JSON.stringify(plan.steps, null, 2),
      });
    }
    return result;
  },
};
