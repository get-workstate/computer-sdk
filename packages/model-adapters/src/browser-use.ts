import type { AdapterRunResult, CuaAdapter } from "@workstate/sdk";

const API = "https://api.browser-use.com/api/v2";

export function browserUseLlm(model: string): string | undefined {
  const stripped = model.replace(/^browser-use\//, "").trim();
  return stripped && stripped !== "browser-use" && stripped !== "cloud" ? stripped : undefined;
}

interface TaskStatus {
  status?: string;
  output?: string | null;
  isSuccess?: boolean | null;
  liveUrl?: string | null;
}

/**
 * Browser Use Cloud. The task runs in Browser Use's hosted browser, not in the environment's
 * browser, so logins saved in the environment do not carry over. The output is written to
 * /workspace/browser-use/<task id>.md so later runs can read it.
 */
export const browserUseAdapter: CuaAdapter = {
  name: "browser-use",
  description: "Browser Use Cloud tasks (model ids browser-use/cloud or browser-use/<llm>). Runs in Browser Use's hosted browser.",
  available: () => Boolean(process.env.BROWSER_USE_API_KEY),
  async run(input): Promise<AdapterRunResult> {
    const apiKey = process.env.BROWSER_USE_API_KEY;
    if (!apiKey) throw new Error("Browser Use adapter selected but BROWSER_USE_API_KEY is not set on the Workstate server.");
    const headers = { "x-browser-use-api-key": apiKey, "content-type": "application/json" };
    const llm = browserUseLlm(input.model);
    const skills = await input.skills.list();
    const skillNotes = skills.length > 0 ? `\n\nKnown procedures in this environment:\n${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}` : "";

    const created = await fetch(`${API}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        task: `${input.prompt}${skillNotes}`,
        ...(llm ? { llm } : {}),
        metadata: { workstateRun: input.run.id, workstateEnvironment: input.environment.name },
      }),
      signal: input.abortSignal,
    });
    if (!created.ok) throw new Error(`Browser Use returned ${created.status}: ${(await created.text()).slice(0, 300)}`);
    const { id } = (await created.json()) as { id?: string };
    if (!id) throw new Error("Browser Use did not return a task id.");
    input.log("log", `Browser Use Cloud task ${id} started`, { taskId: id });

    let lastStatus = "";
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      if (input.abortSignal.aborted) {
        await fetch(`${API}/tasks/${id}`, { method: "PATCH", headers, body: JSON.stringify({ action: "stop" }) }).catch(() => undefined);
        throw new Error("Run cancelled");
      }
      const response = await fetch(`${API}/tasks/${id}/status`, { headers, signal: input.abortSignal });
      if (!response.ok) throw new Error(`Browser Use status check returned ${response.status}.`);
      const status = (await response.json()) as TaskStatus;
      if (status.status && status.status !== lastStatus) {
        lastStatus = status.status;
        input.log("log", `Browser Use task ${status.status}`);
      }
      if (status.status === "finished" || status.status === "stopped") {
        const output = (status.output ?? "").trim();
        const path = `/workspace/browser-use/${id}.md`;
        await input.files.write(path, `# Browser Use task ${id}\n\nPrompt: ${input.prompt}\n\n${output || "(no output)"}\n`);
        if (status.status === "stopped" || status.isSuccess === false) {
          throw new Error(output || "Browser Use stopped the task without a result.");
        }
        return { text: output || "Browser Use finished without a text result.", artifacts: [path] };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Browser Use task did not finish within 20 minutes.");
  },
};
