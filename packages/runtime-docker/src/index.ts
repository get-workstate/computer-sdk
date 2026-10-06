import { spawn } from "node:child_process";
import type { RuntimeEnvironment, RuntimeProvider, RuntimeSession } from "@workstate/sdk";
import { newRemoteSession, rpc, waitForDaemon } from "./remote-session.js";

export const DEFAULT_IMAGE = "workstate/runtime:0.1";
export const DAEMON_PORT = 4790;

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

function docker(args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(Object.assign(new Error("Docker is not installed, so the docker runtime cannot start."), { code: "docker_unavailable", status: 500 }));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export class DockerRuntimeProvider implements RuntimeProvider {
  readonly name = "docker";

  constructor(private readonly image = process.env.WORKSTATE_RUNTIME_IMAGE ?? DEFAULT_IMAGE) {}

  async start(env: RuntimeEnvironment): Promise<RuntimeSession> {
    const container = `workstate-${env.id}`.toLowerCase();
    const removed = await docker(["rm", "-f", container]).catch((error: unknown) => {
      if ((error as { code?: string }).code === "docker_unavailable") throw error;
      return { code: 1, stdout: "", stderr: "" };
    });
    void removed;
    const started = await docker([
      "run",
      "-d",
      "--name",
      container,
      "-p",
      `127.0.0.1::${DAEMON_PORT}`,
      "-v",
      `${env.paths.root}:/environment`,
      this.image,
    ]);
    if (started.code !== 0) {
      throw new Error(`Could not start ${this.image}. ${started.stderr.trim() || started.stdout.trim()}`);
    }
    const mapped = await docker(["port", container, `${DAEMON_PORT}/tcp`]);
    const match = mapped.stdout.match(/:(\d+)\s*$/m);
    if (!match?.[1]) throw new Error(`Could not read the published port for ${container}.`);
    const base = `http://127.0.0.1:${match[1]}`;
    await waitForDaemon(base);
    await rpc(base, "session.start", {
      profileDir: "/environment/browser-profile",
      filesDir: "/environment/files",
      skillsDir: "/environment/skills",
      headless: env.headless,
    });
    return newRemoteSession(base, env.id, async () => {
      await rpc(base, "session.stop").catch(() => undefined);
      await docker(["rm", "-f", container]).catch(() => undefined);
    });
  }
}

export { createDaemonApp } from "./http-app.js";
export { RemoteRuntimeSession, newRemoteSession, rpc, waitForDaemon } from "./remote-session.js";
export type { DaemonTarget } from "./remote-session.js";
