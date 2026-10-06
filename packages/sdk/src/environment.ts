import type { HttpClient } from "./http.js";
import {
  ENV_NAME_RE,
  isTerminalStatus,
  type EnvironmentRecord,
  type HumanKind,
  type HumanResponse,
  type RunEvent,
  type RunRecord,
  type RunStatus,
} from "./types.js";
import { WorkstateError } from "./http.js";

export interface RunOptions {
  prompt: string;
  model?: string;
}

export interface RunHandlers {
  onEvent?: (event: RunEvent) => void;
  onStatus?: (status: RunStatus) => void;
}

export interface HumanRespondInput {
  action: "approve" | "decline" | "answer" | "returned" | "return" | "take_control" | "stop";
  requestId?: string;
  answers?: Record<string, string>;
  text?: string;
}

export interface ToolExecuteInput {
  prompt: string;
  model?: string;
}

export interface EnvironmentTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: { prompt: { type: "string"; description: string } };
    required: ["prompt"];
  };
  execute: (input: ToolExecuteInput) => Promise<RunRecord>;
  openai: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: EnvironmentTool["inputSchema"];
    };
  };
  anthropic: {
    name: string;
    description: string;
    input_schema: EnvironmentTool["inputSchema"];
  };
}

export class RemoteHuman {
  constructor(
    private readonly client: HttpClient,
    private readonly environmentId: string,
  ) {}

  respond(input: HumanRespondInput): Promise<{ ok: true; run: RunRecord }> {
    return this.client.post(`/api/environments/${this.environmentId}/human`, input);
  }

  requestApproval(message: string, kind: HumanKind = "approval"): Promise<RunRecord> {
    return this.client.post(`/api/environments/${this.environmentId}/human-requests`, { kind, message });
  }
}

export class Environment {
  readonly human: RemoteHuman;

  constructor(
    private readonly client: HttpClient,
    readonly record: EnvironmentRecord,
  ) {
    this.human = new RemoteHuman(client, record.id);
  }

  get id(): string {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  async run(promptOrOptions: string | RunOptions, handlers?: RunHandlers): Promise<RunRecord> {
    const prompt = typeof promptOrOptions === "string" ? promptOrOptions : promptOrOptions.prompt;
    const model = typeof promptOrOptions === "string" ? undefined : promptOrOptions.model;
    if (!prompt.trim()) {
      throw new WorkstateError("A run needs a prompt.", { code: "invalid_prompt" });
    }
    const created = await this.client.post<RunRecord>(`/api/environments/${encodeURIComponent(this.name)}/runs`, {
      prompt,
      model,
    });
    return this.waitForRun(created.id, handlers);
  }

  async waitForRun(id: string, handlers?: RunHandlers): Promise<RunRecord> {
    let after = 0;
    let lastStatus: RunStatus | null = null;
    for (;;) {
      const snap = await this.client.get<{ run: RunRecord; events: RunEvent[] }>(
        `/api/runs/${encodeURIComponent(id)}?wait=1&after=${after}`,
      );
      for (const event of snap.events) {
        after = event.id;
        handlers?.onEvent?.(event);
      }
      if (snap.run.status !== lastStatus) {
        lastStatus = snap.run.status;
        handlers?.onStatus?.(snap.run.status);
      }
      if (isTerminalStatus(snap.run.status)) return snap.run;
    }
  }

  asTool(): EnvironmentTool {
    const name = `workstate_${this.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const description = `Run a task on the persistent Workstate environment "${this.name}". The environment keeps its browser logins, files, and skills between calls.`;
    const inputSchema: EnvironmentTool["inputSchema"] = {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "What the environment should do.",
        },
      },
      required: ["prompt"],
    };
    return {
      name,
      description,
      inputSchema,
      execute: (input) => this.run({ prompt: input.prompt, model: input.model }),
      openai: { type: "function", function: { name, description, parameters: inputSchema } },
      anthropic: { name, description, input_schema: inputSchema },
    };
  }
}

export function assertEnvironmentName(name: string): void {
  if (!ENV_NAME_RE.test(name)) {
    throw new WorkstateError(
      `Invalid environment name "${name}". Use 1–64 characters: letters, numbers, dots, underscores, or hyphens.`,
      { code: "invalid_name", status: 400 },
    );
  }
}
