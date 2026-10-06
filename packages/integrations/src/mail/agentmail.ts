import type { Mailbox, MailMessage } from "@workstate/sdk";
import { IntegrationSetupError, env, jsonRequest } from "../setup.js";

const DEFAULT_API = "https://api.agentmail.to";

interface AgentMailInbox {
  inbox_id: string;
  email?: string;
  display_name?: string;
}

interface AgentMailMessage {
  message_id?: string;
  id?: string;
  from?: string;
  subject?: string;
  text?: string;
  extracted_text?: string;
  preview?: string;
  created_at?: string;
  timestamp?: string;
}

/** Pull a verification code out of an email body: 4–8 digits, or 6+ uppercase alphanumerics near "code". */
export function extractCode(text: string): string | null {
  const near = text.match(/(?:code|otp|passcode|verification)[^0-9A-Z]{0,40}?\b([0-9]{4,8}|[A-Z0-9]{6,8})\b/i);
  if (near?.[1]) return near[1];
  const digits = text.match(/\b([0-9]{6}|[0-9]{4}|[0-9]{8})\b/);
  return digits?.[1] ?? null;
}

/**
 * AgentMail inbox for an environment. Set AGENTMAIL_API_KEY on the server and point the
 * environment at an inbox (config "mailbox": inbox id or address). With "new" or no reference,
 * an inbox is created on first use and the id is logged.
 * https://docs.agentmail.to
 */
export class AgentMailbox implements Mailbox {
  readonly name = "agentmail";
  private inbox: Promise<AgentMailInbox> | null = null;

  constructor(private readonly inboxRef?: string) {}

  configured(): boolean {
    return Boolean(env("AGENTMAIL_API_KEY"));
  }

  private auth(): { base: string; headers: Record<string, string> } {
    const key = env("AGENTMAIL_API_KEY");
    if (!key) {
      throw new IntegrationSetupError(
        "AgentMail",
        "AgentMail is not configured. Set AGENTMAIL_API_KEY on the Workstate server, then set the environment's mailbox (workstate env set <name> --mailbox <inbox id>).",
        ["AGENTMAIL_API_KEY"],
      );
    }
    return { base: env("AGENTMAIL_API_URL") ?? DEFAULT_API, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } };
  }

  private resolveInbox(): Promise<AgentMailInbox> {
    if (!this.inbox) {
      this.inbox = (async () => {
        const { base, headers } = this.auth();
        if (this.inboxRef && this.inboxRef !== "new") {
          if (this.inboxRef.includes("@")) {
            const listed = await jsonRequest<{ inboxes?: AgentMailInbox[] }>("AgentMail", `${base}/v0/inboxes?limit=100`, { headers });
            const match = (listed.inboxes ?? []).find((inbox) => inbox.email === this.inboxRef || inbox.inbox_id === this.inboxRef);
            if (!match) throw new Error(`AgentMail has no inbox ${this.inboxRef} on this account.`);
            return match;
          }
          return jsonRequest<AgentMailInbox>("AgentMail", `${base}/v0/inboxes/${encodeURIComponent(this.inboxRef)}`, { headers });
        }
        return jsonRequest<AgentMailInbox>("AgentMail", `${base}/v0/inboxes`, {
          method: "POST",
          headers,
          body: JSON.stringify({ display_name: "Workstate agent" }),
        });
      })();
      this.inbox.catch(() => {
        this.inbox = null;
      });
    }
    return this.inbox;
  }

  async address(): Promise<string> {
    const inbox = await this.resolveInbox();
    return inbox.email ?? inbox.inbox_id;
  }

  async list(limit = 10): Promise<MailMessage[]> {
    const { base, headers } = this.auth();
    const inbox = await this.resolveInbox();
    const data = await jsonRequest<{ messages?: AgentMailMessage[] }>(
      "AgentMail",
      `${base}/v0/inboxes/${encodeURIComponent(inbox.inbox_id)}/messages?limit=${limit}`,
      { headers },
    );
    return (data.messages ?? []).map((message) => ({
      id: message.message_id ?? message.id ?? "",
      from: message.from ?? "",
      subject: message.subject ?? "",
      text: message.extracted_text ?? message.text ?? message.preview ?? "",
      createdAt: message.created_at ?? message.timestamp ?? "",
    }));
  }

  async waitForCode(options: { timeoutMs?: number; after?: string; from?: string; signal?: AbortSignal } = {}): Promise<{ code: string; message: MailMessage }> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const started = Date.now();
    const after = options.after ? Date.parse(options.after) : started - 60_000;
    while (Date.now() - started < timeoutMs) {
      if (options.signal?.aborted) throw new Error("Run cancelled");
      const messages = await this.list(10);
      for (const message of messages) {
        const stamp = Date.parse(message.createdAt);
        if (Number.isFinite(stamp) && stamp < after) continue;
        if (options.from && !message.from.toLowerCase().includes(options.from.toLowerCase())) continue;
        const code = extractCode(`${message.subject}\n${message.text}`);
        if (code) return { code, message };
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    throw new Error(`No verification code arrived in ${await this.address()} within ${Math.round(timeoutMs / 1000)}s.`);
  }
}
