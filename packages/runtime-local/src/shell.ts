import { spawn } from "node:child_process";
import type { Shell, ShellResult } from "@workstate/sdk";
import { resolveVirtual, rewriteCommand, type VirtualRoots } from "./paths.js";

const MAX_OUTPUT = 200_000;

export class LocalShell implements Shell {
  constructor(private readonly roots: VirtualRoots) {}

  exec(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ShellResult> {
    const cwd = opts?.cwd ? resolveVirtual(this.roots, opts.cwd).real : this.roots.files;
    const rewritten = rewriteCommand(this.roots, command);
    const timeoutMs = opts?.timeoutMs ?? 30_000;

    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-lc", rewritten], { cwd });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = (stdout + chunk).slice(0, MAX_OUTPUT);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(0, MAX_OUTPUT);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }
}
