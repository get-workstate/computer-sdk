import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";
export const DEFAULT_PORT = 4780;

export interface Config {
  host: string;
  port: number;
  home: string;
  publicUrl: string;
  webUiDir?: string;
  headless: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = overrides.port ?? Number(process.env.WORKSTATE_PORT ?? DEFAULT_PORT);
  const host = overrides.host ?? process.env.WORKSTATE_HOST ?? "127.0.0.1";
  const home = overrides.home ?? process.env.WORKSTATE_HOME ?? path.join(os.homedir(), ".workstate");
  const publicUrl = overrides.publicUrl ?? process.env.WORKSTATE_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  const headless =
    overrides.headless ??
    !["0", "false", "no"].includes(String(process.env.WORKSTATE_HEADLESS ?? "1").toLowerCase());
  return {
    host,
    port,
    home,
    publicUrl,
    webUiDir: overrides.webUiDir ?? process.env.WORKSTATE_WEB_UI_DIR,
    headless,
  };
}
