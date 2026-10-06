import type { Credential, SecretsProvider } from "@workstate/sdk";
import { IntegrationSetupError, env, jsonRequest, loadOptional } from "../setup.js";

export interface SecretRef {
  vault: string;
  item: string;
  field?: string;
}

/** Parse a 1Password secret reference such as op://Vault/Item or op://Vault/Item/field. */
export function parseSecretRef(ref: string): SecretRef {
  const match = ref.trim().match(/^op:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) {
    throw new Error(`"${ref}" is not a 1Password reference. Use op://Vault/Item or op://Vault/Item/field.`);
  }
  return {
    vault: decodeURIComponent(match[1]!),
    item: decodeURIComponent(match[2]!),
    field: match[3] ? decodeURIComponent(match[3]) : undefined,
  };
}

interface ConnectVault {
  id: string;
  name: string;
}

interface ConnectField {
  id?: string;
  label?: string;
  purpose?: "USERNAME" | "PASSWORD" | "NOTES";
  type?: string;
  value?: string;
  totp?: string;
}

interface ConnectItem {
  id: string;
  title: string;
  fields?: ConnectField[];
}

/**
 * 1Password Connect server (self-hosted REST API). Set OP_CONNECT_HOST and OP_CONNECT_TOKEN.
 * https://developer.1password.com/docs/connect/connect-api-reference
 */
export class OnePasswordConnect implements SecretsProvider {
  readonly name = "1password-connect";

  configured(): boolean {
    return Boolean(env("OP_CONNECT_HOST") && env("OP_CONNECT_TOKEN"));
  }

  private auth(): { host: string; headers: Record<string, string> } {
    const host = env("OP_CONNECT_HOST");
    const token = env("OP_CONNECT_TOKEN");
    if (!host || !token) {
      throw new IntegrationSetupError(
        "1Password",
        "1Password is not configured. Set OP_SERVICE_ACCOUNT_TOKEN (1Password SDK) or OP_CONNECT_HOST and OP_CONNECT_TOKEN (Connect server) on the Workstate server.",
        ["OP_SERVICE_ACCOUNT_TOKEN", "OP_CONNECT_HOST", "OP_CONNECT_TOKEN"],
      );
    }
    return { host: host.replace(/\/$/, ""), headers: { authorization: `Bearer ${token}` } };
  }

  private async item(ref: SecretRef): Promise<ConnectItem> {
    const { host, headers } = this.auth();
    const vaults = await jsonRequest<ConnectVault[]>("1Password Connect", `${host}/v1/vaults`, { headers });
    const vault = vaults.find((candidate) => candidate.id === ref.vault || candidate.name === ref.vault);
    if (!vault) throw new Error(`1Password vault "${ref.vault}" is not visible to this Connect token.`);
    const filter = encodeURIComponent(`title eq "${ref.item.replace(/"/g, '\\"')}"`);
    let items = await jsonRequest<ConnectItem[]>("1Password Connect", `${host}/v1/vaults/${vault.id}/items?filter=${filter}`, { headers });
    if (items.length === 0) {
      // The reference may use the item id instead of its title.
      items = [{ id: ref.item, title: ref.item }];
    }
    const summary = items[0]!;
    return jsonRequest<ConnectItem>("1Password Connect", `${host}/v1/vaults/${vault.id}/items/${summary.id}`, { headers });
  }

  async resolve(ref: string): Promise<string> {
    const parsed = parseSecretRef(ref);
    const item = await this.item(parsed);
    const wanted = parsed.field ?? "password";
    const field = (item.fields ?? []).find(
      (candidate) =>
        candidate.id === wanted ||
        candidate.label?.toLowerCase() === wanted.toLowerCase() ||
        candidate.purpose?.toLowerCase() === wanted.toLowerCase(),
    );
    if (!field) throw new Error(`1Password item "${parsed.item}" has no field "${wanted}".`);
    return field.type === "OTP" ? (field.totp ?? "") : (field.value ?? "");
  }

  async credential(ref: string): Promise<Credential> {
    const parsed = parseSecretRef(ref);
    const item = await this.item(parsed);
    const fields = item.fields ?? [];
    const username = fields.find((field) => field.purpose === "USERNAME")?.value ?? fields.find((field) => field.id === "username")?.value;
    const password = fields.find((field) => field.purpose === "PASSWORD")?.value ?? fields.find((field) => field.id === "password")?.value;
    if (!username || !password) {
      throw new Error(`1Password item "${parsed.item}" is not a Login item with a username and password.`);
    }
    const otp = fields.find((field) => field.type === "OTP")?.totp;
    return { username, password, otp: otp || undefined };
  }
}

interface OnePasswordSdkClient {
  secrets: { resolve(ref: string): Promise<string> };
}

interface OnePasswordSdkModule {
  createClient(options: { auth: string; integrationName: string; integrationVersion: string }): Promise<OnePasswordSdkClient>;
  default?: {
    createClient(options: { auth: string; integrationName: string; integrationVersion: string }): Promise<OnePasswordSdkClient>;
  };
}

/**
 * 1Password SDK with a service account token. Set OP_SERVICE_ACCOUNT_TOKEN and install @1password/sdk.
 * https://developer.1password.com/docs/sdks
 */
export class OnePasswordServiceAccount implements SecretsProvider {
  readonly name = "1password";
  private client: Promise<OnePasswordSdkClient> | null = null;

  configured(): boolean {
    return Boolean(env("OP_SERVICE_ACCOUNT_TOKEN"));
  }

  private connect(): Promise<OnePasswordSdkClient> {
    const token = env("OP_SERVICE_ACCOUNT_TOKEN");
    if (!token) {
      throw new IntegrationSetupError(
        "1Password",
        "1Password is not configured. Set OP_SERVICE_ACCOUNT_TOKEN (1Password SDK) or OP_CONNECT_HOST and OP_CONNECT_TOKEN (Connect server) on the Workstate server.",
        ["OP_SERVICE_ACCOUNT_TOKEN", "OP_CONNECT_HOST", "OP_CONNECT_TOKEN"],
      );
    }
    if (!this.client) {
      this.client = loadOptional<OnePasswordSdkModule>("1Password", "@1password/sdk").then((sdk) =>
        (sdk.createClient ?? sdk.default!.createClient)({
          auth: token,
          integrationName: "Workstate",
          integrationVersion: "v0.1.0",
        }),
      );
      this.client.catch(() => {
        this.client = null;
      });
    }
    return this.client;
  }

  async resolve(ref: string): Promise<string> {
    const parsed = parseSecretRef(ref);
    const client = await this.connect();
    return client.secrets.resolve(`op://${parsed.vault}/${parsed.item}/${parsed.field ?? "password"}`);
  }

  async credential(ref: string): Promise<Credential> {
    const parsed = parseSecretRef(ref);
    const client = await this.connect();
    const base = `op://${parsed.vault}/${parsed.item}`;
    const [username, password] = await Promise.all([
      client.secrets.resolve(`${base}/username`),
      client.secrets.resolve(`${base}/password`),
    ]);
    const otp = await client.secrets.resolve(`${base}/one-time password?attribute=otp`).catch(() => undefined);
    return { username, password, otp: otp || undefined };
  }
}

/** Pick the configured 1Password transport: service account SDK first, then Connect. Unconfigured is still returned so errors are clear. */
export function onePassword(): SecretsProvider {
  const sdk = new OnePasswordServiceAccount();
  if (sdk.configured()) return sdk;
  const connect = new OnePasswordConnect();
  if (connect.configured()) return connect;
  return sdk;
}
