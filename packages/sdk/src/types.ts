export const RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_human",
  "human_controlling",
  "resumed",
  "success",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES = ["success", "failed", "cancelled"] as const;
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export function isTerminalStatus(status: RunStatus): status is TerminalRunStatus {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export interface Screenshot {
  mimeType: "image/jpeg" | "image/png";
  data: string;
  width: number;
  height: number;
}

export interface PageInfo {
  url: string;
  title: string;
}

export type MouseButton = "left" | "right" | "middle";

export interface Computer {
  open(url: string): Promise<PageInfo>;
  screenshot(): Promise<Screenshot>;
  click(x: number, y: number, button?: MouseButton): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  key(key: string): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  wait(ms: number): Promise<void>;
  back(): Promise<void>;
  page(): Promise<PageInfo>;
  text(): Promise<string>;
  extract(selector: string): Promise<string[]>;
  fill(selector: string, text: string): Promise<void>;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Shell {
  exec(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ShellResult>;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  size?: number;
}

export interface Files {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
}

export type HumanKind = "login" | "approval" | "input" | "takeover";

export interface HumanField {
  name: string;
  label: string;
  type?: "text" | "password" | "secret";
}

export interface HumanRequestInput {
  kind: HumanKind;
  message: string;
  fields?: HumanField[];
}

export interface HumanResponse {
  id: string;
  action: "approve" | "decline" | "answer" | "returned";
  answers?: Record<string, string>;
}

export interface Human {
  request(input: HumanRequestInput): Promise<HumanResponse>;
}

export interface Skill {
  name: string;
  description: string;
  tags: string[];
  procedure: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDraft {
  name: string;
  description: string;
  tags: string[];
  procedure: string;
}

export interface Skills {
  list(): Promise<Skill[]>;
  read(name: string): Promise<Skill | null>;
  write(skill: SkillDraft): Promise<Skill>;
}

export interface EnvironmentPaths {
  root: string;
  files: string;
  skills: string;
  browserProfile: string;
  runs: string;
}

export interface EnvironmentRecord {
  id: string;
  name: string;
  createdAt: string;
  config: Record<string, unknown>;
  paths: EnvironmentPaths;
}

export interface RunResult {
  text: string;
  artifacts?: string[];
}

export interface HumanRequestRecord {
  id: string;
  kind: HumanKind;
  message: string;
  fields?: HumanField[];
  createdAt: string;
}

export interface RunRecord {
  id: string;
  environmentId: string;
  environmentName: string;
  sessionId: string | null;
  prompt: string;
  model: string;
  status: RunStatus;
  error: string | null;
  result: RunResult | null;
  humanRequest: HumanRequestRecord | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  kind: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface RuntimeSession {
  id: string;
  environmentId: string;
  computer: Computer;
  shell: Shell;
  files: Files;
  /** Chrome DevTools Protocol endpoint for harnesses that attach to the same browser. */
  cdpUrl?: string;
  /** Provider-hosted live view, when the browser runs somewhere else. */
  liveViewUrl?: string;
  stop(): Promise<void>;
}

export interface RuntimeEnvironment {
  id: string;
  name: string;
  paths: EnvironmentPaths;
  headless: boolean;
  config: Record<string, unknown>;
}

export interface RuntimeProvider {
  name: string;
  start(env: RuntimeEnvironment): Promise<RuntimeSession>;
}

export interface Credential {
  username: string;
  password: string;
  otp?: string;
}

export interface SecretsProvider {
  name: string;
  configured(): boolean;
  resolve(ref: string): Promise<string>;
  credential(ref: string): Promise<Credential>;
}

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  text: string;
  createdAt: string;
}

export interface Mailbox {
  name: string;
  configured(): boolean;
  address(): Promise<string>;
  list(limit?: number): Promise<MailMessage[]>;
  waitForCode(options?: { timeoutMs?: number; after?: string; from?: string; signal?: AbortSignal }): Promise<{ code: string; message: MailMessage }>;
}

export interface CardSummary {
  id: string;
  last4?: string;
  expiry?: string;
  amountCents: number;
  status?: string;
}

export interface CardDetails extends CardSummary {
  number: string;
  cvv: string;
}

export interface Payments {
  name: string;
  configured(): boolean;
  createCard(input: { amountCents: number; memo?: string }): Promise<CardSummary>;
  cardDetails(id: string): Promise<CardDetails>;
  closeCard(id: string): Promise<void>;
}

export interface RunIntegrations {
  secrets?: SecretsProvider;
  /** 1Password-style reference to the login item for this environment, for example op://Vault/Item. */
  credentialRef?: string;
  mail?: Mailbox;
  payments?: Payments;
}

export type IntegrationKind = "runtime" | "model" | "secrets" | "mail" | "payments";

export interface IntegrationDescriptor {
  id: string;
  kind: IntegrationKind;
  name: string;
  description: string;
  envVars: string[];
  configured: boolean;
  docsUrl?: string;
  /** How to select it: an environment config key, a model id, or an env var. */
  select: string;
  status: "verified" | "untested";
}

export interface AdapterRunInput {
  prompt: string;
  model: string;
  computer: Computer;
  shell: Shell;
  files: Files;
  human: Human;
  skills: Skills;
  skillsPath: string;
  environment: { id: string; name: string; config?: Record<string, unknown> };
  run: { id: string; sessionId: string; liveUrl: string };
  systemPrompt: string;
  serverUrl: string;
  cdpUrl?: string;
  integrations?: RunIntegrations;
  log: (kind: string, message: string, data?: unknown) => void;
  abortSignal: AbortSignal;
}

export interface AdapterRunResult {
  text: string;
  artifacts?: string[];
}

export interface CuaAdapter {
  name: string;
  description?: string;
  available(): boolean;
  run(input: AdapterRunInput): Promise<AdapterRunResult>;
}

export const ENV_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
