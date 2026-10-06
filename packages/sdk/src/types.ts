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
  stop(): Promise<void>;
}

export interface RuntimeEnvironment {
  id: string;
  name: string;
  paths: EnvironmentPaths;
  headless: boolean;
}

export interface RuntimeProvider {
  name: string;
  start(env: RuntimeEnvironment): Promise<RuntimeSession>;
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
  environment: { id: string; name: string };
  run: { id: string; sessionId: string; liveUrl: string };
  systemPrompt: string;
  serverUrl: string;
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
