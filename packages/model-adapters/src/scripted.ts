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

export function resolveRecipe(prompt: string, ctx: { serverUrl: string }): Recipe | null {
  const lower = prompt.toLowerCase();
  const urlMatch = prompt.match(/https?:\/\/[^\s)]+/);
  void ctx;

  if (/\binvoice\b|\bdemo shop\b/.test(lower)) {
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

  if (/hacker news|\bycombinator\b|\bhn\b/.test(lower)) {
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

  if (urlMatch) {
    const url = urlMatch[0];
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

  return null;
}

export function planRun(prompt: string, skills: Skill[], ctx: { serverUrl: string }): Plan | null {
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
  const recipe = resolveRecipe(prompt, ctx);
  if (!recipe) return null;
  return { source: "recipe", ...recipe };
}

const NO_RECIPE =
  "No scripted recipe matches this task. The local adapter can download the latest demo shop invoice, summarize Hacker News, or open an explicit URL. Set OPENAI_API_KEY or ANTHROPIC_API_KEY for open-ended tasks.";

export const scriptedAdapter: CuaAdapter = {
  name: "local",
  description: "Keyless scripted adapter for the demo shop, Hacker News, and explicit URLs.",
  available: () => true,
  async run(input) {
    const existing = await input.skills.list();
    const plan = planRun(input.prompt, existing, { serverUrl: input.serverUrl });
    if (!plan) throw new Error(NO_RECIPE);
    if (plan.source === "skill") input.log("log", `Reusing skill ${plan.name}`);
    const result = await runSteps(plan.steps, {
      computer: input.computer,
      files: input.files,
      human: input.human,
      serverUrl: input.serverUrl,
      abortSignal: input.abortSignal,
      log: input.log,
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
