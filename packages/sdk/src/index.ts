import { assertEnvironmentName, Environment } from "./environment.js";
import { HttpClient } from "./http.js";
import type { EnvironmentRecord, IntegrationDescriptor } from "./types.js";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:4780";

export class Workstate {
  readonly client: HttpClient;

  constructor(options?: { url?: string }) {
    this.client = new HttpClient(options?.url ?? process.env.WORKSTATE_URL ?? DEFAULT_SERVER_URL);
  }

  async environment(name: string, config?: Record<string, unknown>): Promise<Environment> {
    assertEnvironmentName(name);
    const record = await this.client.post<EnvironmentRecord>("/api/environments", {
      name,
      config: config ?? {},
    });
    return new Environment(this.client, record);
  }

  listEnvironments(): Promise<EnvironmentRecord[]> {
    return this.client.get<EnvironmentRecord[]>("/api/environments");
  }

  /** Every runtime, model adapter, secrets, mail, and payments integration the server knows, with configured status. */
  integrations(): Promise<{ integrations: IntegrationDescriptor[]; configKeys: Record<string, string> }> {
    return this.client.get("/api/integrations");
  }
}

export { Environment, RemoteHuman } from "./environment.js";
export type {
  AnchorDemonstration,
  AnchorDemonstrationInput,
  EnvironmentTool,
  HumanRespondInput,
  RunHandlers,
  RunOptions,
  ToolExecuteInput,
} from "./environment.js";
export { HttpClient, WorkstateError } from "./http.js";
export { createId, nowIso } from "./id.js";
export {
  ENV_NAME_RE,
  RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isTerminalStatus,
} from "./types.js";
export type {
  AdapterRunInput,
  AdapterRunResult,
  CardDetails,
  CardSummary,
  Computer,
  Credential,
  CuaAdapter,
  IntegrationDescriptor,
  IntegrationKind,
  Mailbox,
  MailMessage,
  Payments,
  RunIntegrations,
  SecretsProvider,
  EnvironmentPaths,
  EnvironmentRecord,
  FileEntry,
  Files,
  Human,
  HumanField,
  HumanKind,
  HumanRequestInput,
  HumanRequestRecord,
  HumanResponse,
  MouseButton,
  PageInfo,
  RunEvent,
  RunRecord,
  RunResult,
  RunStatus,
  RuntimeEnvironment,
  RuntimeProvider,
  RuntimeSession,
  Screenshot,
  Shell,
  ShellResult,
  Skill,
  SkillDraft,
  Skills,
  TerminalRunStatus,
} from "./types.js";
