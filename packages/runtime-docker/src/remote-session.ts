import {
  createId,
  type Computer,
  type FileEntry,
  type Files,
  type PageInfo,
  type RuntimeSession,
  type Screenshot,
  type Shell,
  type ShellResult,
} from "@workstate/sdk";

export interface DaemonTarget {
  /** Base URL of a Workstate runtime daemon, for example http://127.0.0.1:4790. */
  base: string;
  /** Extra headers, for hosted sandboxes that gate the preview URL behind a token. */
  headers?: Record<string, string>;
}

export async function rpc<T>(target: string | DaemonTarget, method: string, params?: unknown): Promise<T> {
  const { base, headers } = typeof target === "string" ? { base: target, headers: undefined } : target;
  let response: Response;
  try {
    response = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify({ method, params: params ?? {} }),
    });
  } catch (error) {
    throw new Error(`Runtime daemon at ${base} did not answer. ${error instanceof Error ? error.message : ""}`.trim());
  }
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string };
  if (!response.ok || !data.ok) throw new Error(data.error || `Runtime call ${method} failed (${response.status}).`);
  return data.result as T;
}

export async function waitForDaemon(target: string | DaemonTarget, timeoutMs = 20_000): Promise<void> {
  const { base, headers } = typeof target === "string" ? { base: target, headers: undefined } : target;
  const started = Date.now();
  let last = "daemon did not become ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${base}/healthz`, { headers });
      if (response.ok) return;
      last = `healthz returned ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Runtime daemon at ${base} did not become ready. ${last}`);
}

function remoteComputer(target: DaemonTarget): Computer {
  return {
    open: (url) => rpc<PageInfo>(target, "computer.open", { url }),
    screenshot: () => rpc<Screenshot>(target, "computer.screenshot"),
    click: (x, y, button) => rpc<void>(target, "computer.click", { x, y, button }),
    doubleClick: (x, y) => rpc<void>(target, "computer.doubleClick", { x, y }),
    move: (x, y) => rpc<void>(target, "computer.move", { x, y }),
    type: (text) => rpc<void>(target, "computer.type", { text }),
    key: (key) => rpc<void>(target, "computer.key", { key }),
    scroll: (dx, dy) => rpc<void>(target, "computer.scroll", { dx, dy }),
    wait: (ms) => rpc<void>(target, "computer.wait", { ms }),
    back: () => rpc<void>(target, "computer.back"),
    page: () => rpc<PageInfo>(target, "computer.page"),
    text: () => rpc<string>(target, "computer.text"),
    extract: (selector) => rpc<string[]>(target, "computer.extract", { selector }),
    fill: (selector, text) => rpc<void>(target, "computer.fill", { selector, text }),
  };
}

function remoteShell(target: DaemonTarget): Shell {
  return {
    exec: (command, opts) => rpc<ShellResult>(target, "shell.exec", { command, cwd: opts?.cwd, timeoutMs: opts?.timeoutMs }),
  };
}

function remoteFiles(target: DaemonTarget): Files {
  return {
    read: (filePath) => rpc<string>(target, "files.read", { path: filePath }),
    write: (filePath, content) => rpc<void>(target, "files.write", { path: filePath, content }),
    list: (filePath) => rpc<FileEntry[]>(target, "files.list", { path: filePath }),
  };
}

export class RemoteRuntimeSession implements RuntimeSession {
  readonly computer: Computer;
  readonly shell: Shell;
  readonly files: Files;

  constructor(
    private readonly target: DaemonTarget,
    readonly id: string,
    readonly environmentId: string,
    private readonly onStop: () => Promise<void>,
  ) {
    this.computer = remoteComputer(target);
    this.shell = remoteShell(target);
    this.files = remoteFiles(target);
  }

  get base(): string {
    return this.target.base;
  }

  async stop(): Promise<void> {
    await this.onStop();
  }
}

export function newRemoteSession(target: string | DaemonTarget, environmentId: string, onStop: () => Promise<void>): RemoteRuntimeSession {
  const resolved = typeof target === "string" ? { base: target } : target;
  return new RemoteRuntimeSession(resolved, createId("ses"), environmentId, onStop);
}
