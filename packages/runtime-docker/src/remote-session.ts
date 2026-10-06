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

export async function rpc<T>(base: string, method: string, params?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params: params ?? {} }),
    });
  } catch (error) {
    throw new Error(`Runtime daemon at ${base} did not answer. ${error instanceof Error ? error.message : ""}`.trim());
  }
  const data = (await response.json()) as { ok?: boolean; result?: T; error?: string };
  if (!response.ok || !data.ok) throw new Error(data.error || `Runtime call ${method} failed.`);
  return data.result as T;
}

function remoteComputer(base: string): Computer {
  return {
    open: (url) => rpc<PageInfo>(base, "computer.open", { url }),
    screenshot: () => rpc<Screenshot>(base, "computer.screenshot"),
    click: (x, y, button) => rpc<void>(base, "computer.click", { x, y, button }),
    doubleClick: (x, y) => rpc<void>(base, "computer.doubleClick", { x, y }),
    move: (x, y) => rpc<void>(base, "computer.move", { x, y }),
    type: (text) => rpc<void>(base, "computer.type", { text }),
    key: (key) => rpc<void>(base, "computer.key", { key }),
    scroll: (dx, dy) => rpc<void>(base, "computer.scroll", { dx, dy }),
    wait: (ms) => rpc<void>(base, "computer.wait", { ms }),
    back: () => rpc<void>(base, "computer.back"),
    page: () => rpc<PageInfo>(base, "computer.page"),
    text: () => rpc<string>(base, "computer.text"),
    extract: (selector) => rpc<string[]>(base, "computer.extract", { selector }),
  };
}

function remoteShell(base: string): Shell {
  return {
    exec: (command, opts) => rpc<ShellResult>(base, "shell.exec", { command, cwd: opts?.cwd, timeoutMs: opts?.timeoutMs }),
  };
}

function remoteFiles(base: string): Files {
  return {
    read: (filePath) => rpc<string>(base, "files.read", { path: filePath }),
    write: (filePath, content) => rpc<void>(base, "files.write", { path: filePath, content }),
    list: (filePath) => rpc<FileEntry[]>(base, "files.list", { path: filePath }),
  };
}

export class RemoteRuntimeSession implements RuntimeSession {
  readonly computer: Computer;
  readonly shell: Shell;
  readonly files: Files;

  constructor(
    private readonly base: string,
    readonly id: string,
    readonly environmentId: string,
    private readonly onStop: () => Promise<void>,
  ) {
    this.computer = remoteComputer(base);
    this.shell = remoteShell(base);
    this.files = remoteFiles(base);
  }

  async stop(): Promise<void> {
    await this.onStop();
  }
}

export function newRemoteSession(base: string, environmentId: string, onStop: () => Promise<void>): RemoteRuntimeSession {
  return new RemoteRuntimeSession(base, createId("ses"), environmentId, onStop);
}
