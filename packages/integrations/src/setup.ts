export class IntegrationSetupError extends Error {
  readonly code = "integration_not_configured";
  readonly status = 400;

  constructor(
    readonly integration: string,
    message: string,
    readonly envVars: string[] = [],
  ) {
    super(message);
    this.name = "IntegrationSetupError";
  }
}

export function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function requireEnv(integration: string, names: string[], docsUrl?: string): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = env(name);
    if (value) values[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    const docs = docsUrl ? ` See ${docsUrl}.` : "";
    throw new IntegrationSetupError(
      integration,
      `${integration} is not configured. Set ${missing.join(" and ")} in the server's environment, then start the run again.${docs}`,
      missing,
    );
  }
  return values;
}

/**
 * Load an SDK that ships as an optional peer dependency. Keeps the core install small and
 * turns a missing package into an actionable message instead of a bare module-not-found.
 */
export async function loadOptional<T>(integration: string, specifier: string): Promise<T> {
  try {
    return (await import(specifier)) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      throw new IntegrationSetupError(
        integration,
        `${integration} needs the ${specifier} package. Install it with \`pnpm add ${specifier} --filter @workstate/integrations\` and restart the server.`,
      );
    }
    throw error;
  }
}

export async function jsonRequest<T>(
  integration: string,
  url: string,
  init: RequestInit & { expect?: number[] } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(`${integration} request to ${new URL(url).host} failed. ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  const okStatuses = init.expect ?? [200, 201, 202];
  if (!okStatuses.includes(response.status)) {
    const hint =
      response.status === 401 || response.status === 403
        ? " Check the API key."
        : response.status === 402
          ? " The account has no credit."
          : "";
    throw new Error(`${integration} returned ${response.status}.${hint} ${text.slice(0, 300)}`.trim());
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${integration} returned a non-JSON response: ${text.slice(0, 200)}`);
  }
}
