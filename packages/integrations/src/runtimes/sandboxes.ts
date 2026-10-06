import { DAEMON_PORT, newRemoteSession, rpc, waitForDaemon, type DaemonTarget } from "@workstate/runtime-docker";
import type { RuntimeEnvironment, RuntimeProvider, RuntimeSession } from "@workstate/sdk";
import { env, loadOptional, requireEnv } from "../setup.js";

/**
 * Sandbox providers. The sandbox runs the Workstate runtime image (packages/runtime-docker/Dockerfile),
 * whose daemon exposes the browser, shell, and files over HTTP on port 4790. Workstate reaches that
 * daemon through the provider's preview URL, so the whole environment — browser profile, /workspace,
 * and skills — lives inside the sandbox.
 */

export const DAEMON_START_COMMAND = "node /opt/workstate/packages/runtime-docker/dist/daemon.js";

const SANDBOX_PATHS = {
  profileDir: "/environment/browser-profile",
  filesDir: "/environment/files",
  skillsDir: "/environment/skills",
};

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function attachDaemon(
  providerName: string,
  target: DaemonTarget,
  environment: RuntimeEnvironment,
  teardown: () => Promise<void>,
): Promise<RuntimeSession> {
  try {
    await waitForDaemon(target, 60_000);
    await rpc(target, "session.start", { ...SANDBOX_PATHS, headless: environment.headless });
  } catch (error) {
    await teardown().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${providerName} sandbox started but the Workstate runtime daemon did not answer on port ${DAEMON_PORT}. ` +
        `Make sure the template/image is built from packages/runtime-docker/Dockerfile. ${detail}`,
    );
  }
  return newRemoteSession(target, environment.id, async () => {
    await rpc(target, "session.stop").catch(() => undefined);
    await teardown();
  });
}

// ---------------------------------------------------------------------------
// E2B — https://e2b.dev/docs
// ---------------------------------------------------------------------------

interface E2BSandbox {
  sandboxId: string;
  trafficAccessToken?: string;
  getHost(port: number): string;
  kill(): Promise<unknown>;
}

interface E2BModule {
  Sandbox: {
    create(template: string, opts?: Record<string, unknown>): Promise<E2BSandbox>;
  };
}

export const e2bRuntime: RuntimeProvider = {
  name: "e2b",
  async start(environment: RuntimeEnvironment): Promise<RuntimeSession> {
    const { E2B_API_KEY } = requireEnv("E2B", ["E2B_API_KEY"], "https://e2b.dev/docs");
    const template = configString(environment.config, "e2bTemplate") ?? env("WORKSTATE_E2B_TEMPLATE") ?? "workstate-runtime";
    const { Sandbox } = await loadOptional<E2BModule>("E2B", "e2b");
    const sandbox = await Sandbox.create(template, {
      apiKey: E2B_API_KEY,
      timeoutMs: 60 * 60 * 1000,
      metadata: { workstateEnvironment: environment.name },
    });
    const host = sandbox.getHost(DAEMON_PORT);
    const target: DaemonTarget = {
      base: `https://${host}`,
      headers: sandbox.trafficAccessToken ? { "x-access-token": sandbox.trafficAccessToken } : undefined,
    };
    return attachDaemon("E2B", target, environment, async () => {
      await sandbox.kill();
    });
  },
};

// ---------------------------------------------------------------------------
// Daytona — https://www.daytona.io/docs
// ---------------------------------------------------------------------------

interface DaytonaSandbox {
  id: string;
  process: { executeCommand(command: string, cwd?: string, envVars?: Record<string, string>, timeout?: number): Promise<unknown> };
  getPreviewLink(port: number): Promise<{ url: string; token?: string }>;
  delete(): Promise<void>;
}

interface DaytonaModule {
  Daytona: new (config?: Record<string, unknown>) => {
    create(params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<DaytonaSandbox>;
  };
}

export const daytonaRuntime: RuntimeProvider = {
  name: "daytona",
  async start(environment: RuntimeEnvironment): Promise<RuntimeSession> {
    const { DAYTONA_API_KEY } = requireEnv("Daytona", ["DAYTONA_API_KEY"], "https://www.daytona.io/docs");
    const snapshot = configString(environment.config, "daytonaSnapshot") ?? env("WORKSTATE_DAYTONA_SNAPSHOT");
    const image = configString(environment.config, "daytonaImage") ?? env("WORKSTATE_DAYTONA_IMAGE") ?? "workstate/runtime:0.1";
    // The SDK is published under both names; prefer the current one.
    const { Daytona } = await loadOptional<DaytonaModule>("Daytona", "@daytona/sdk").catch(() =>
      loadOptional<DaytonaModule>("Daytona", "@daytonaio/sdk"),
    );
    const daytona = new Daytona({
      apiKey: DAYTONA_API_KEY,
      ...(env("DAYTONA_API_URL") ? { apiUrl: env("DAYTONA_API_URL") } : {}),
      ...(env("DAYTONA_TARGET") ? { target: env("DAYTONA_TARGET") } : {}),
    });
    const sandbox = await daytona.create(
      {
        ...(snapshot ? { snapshot } : { image }),
        labels: { workstateEnvironment: environment.name },
        autoStopInterval: 60,
      },
      { timeout: 180 },
    );
    const teardown = async () => {
      await sandbox.delete();
    };
    try {
      // Daytona does not run the image CMD, so start the daemon explicitly.
      await sandbox.process.executeCommand(`nohup ${DAEMON_START_COMMAND} > /tmp/workstate-daemon.log 2>&1 &`, "/opt/workstate");
    } catch (error) {
      await teardown().catch(() => undefined);
      throw new Error(`Daytona sandbox started but the runtime daemon could not be launched. ${error instanceof Error ? error.message : String(error)}`);
    }
    const preview = await sandbox.getPreviewLink(DAEMON_PORT);
    const target: DaemonTarget = {
      base: preview.url.replace(/\/$/, ""),
      headers: preview.token ? { "x-daytona-preview-token": preview.token } : undefined,
    };
    return attachDaemon("Daytona", target, environment, teardown);
  },
};
