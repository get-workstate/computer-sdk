import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createId, type RuntimeEnvironment, type RuntimeProvider, type RuntimeSession } from "@workstate/sdk";
import { PlaywrightComputer } from "./computer.js";
import { LocalFiles } from "./files.js";
import { LocalShell } from "./shell.js";

async function clearSingletonLocks(dir: string): Promise<void> {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await rm(path.join(dir, name), { force: true });
  }
}

export class LocalRuntimeProvider implements RuntimeProvider {
  readonly name = "local";

  constructor(private readonly headless = true) {}

  async start(env: RuntimeEnvironment): Promise<RuntimeSession> {
    await mkdir(env.paths.files, { recursive: true });
    await mkdir(env.paths.skills, { recursive: true });
    await mkdir(env.paths.browserProfile, { recursive: true });
    await clearSingletonLocks(env.paths.browserProfile);

    const computer = await PlaywrightComputer.launch({
      profileDir: env.paths.browserProfile,
      headless: this.headless && env.headless,
    });
    const roots = { files: env.paths.files, skills: env.paths.skills };
    return {
      id: createId("ses"),
      environmentId: env.id,
      computer,
      shell: new LocalShell(roots),
      files: new LocalFiles(roots),
      cdpUrl: computer.cdpUrl ?? undefined,
      stop: async () => {
        await computer.close();
      },
    };
  }
}

export interface RemoteBrowser {
  cdpUrl: string;
  liveViewUrl?: string;
  stop(): Promise<void>;
}

/**
 * Runtime whose browser is hosted elsewhere and reached over CDP, while the shell and
 * files stay on this machine inside the environment directory.
 */
export class CdpBrowserRuntimeProvider implements RuntimeProvider {
  constructor(
    readonly name: string,
    private readonly openBrowser: (env: RuntimeEnvironment) => Promise<RemoteBrowser>,
  ) {}

  async start(env: RuntimeEnvironment): Promise<RuntimeSession> {
    await mkdir(env.paths.files, { recursive: true });
    await mkdir(env.paths.skills, { recursive: true });
    const remote = await this.openBrowser(env);
    let computer: PlaywrightComputer;
    try {
      computer = await PlaywrightComputer.connect({ cdpUrl: remote.cdpUrl });
    } catch (error) {
      await remote.stop().catch(() => undefined);
      throw error;
    }
    const roots = { files: env.paths.files, skills: env.paths.skills };
    return {
      id: createId("ses"),
      environmentId: env.id,
      computer,
      shell: new LocalShell(roots),
      files: new LocalFiles(roots),
      cdpUrl: remote.cdpUrl,
      liveViewUrl: remote.liveViewUrl,
      stop: async () => {
        await computer.close();
        await remote.stop();
      },
    };
  }
}

export { PlaywrightComputer, DEFAULT_VIEWPORT } from "./computer.js";
export { LocalFiles } from "./files.js";
export { LocalShell } from "./shell.js";
export { resolveVirtual, rewriteCommand, pathError } from "./paths.js";
export type { VirtualRoots } from "./paths.js";
