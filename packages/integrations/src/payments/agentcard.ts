import type { CardDetails, CardSummary, Payments } from "@workstate/sdk";
import { IntegrationSetupError, env, jsonRequest } from "../setup.js";

const API = "https://api.agentcard.sh";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface AgentcardCard {
  id: string;
  last4?: string;
  lastFour?: string;
  expiry?: string;
  expMonth?: number;
  expYear?: number;
  amountCents?: number;
  balanceCents?: number;
  status?: string;
}

interface AgentcardCardDetails extends AgentcardCard {
  pan?: string;
  number?: string;
  cvv?: string;
}

function summarize(card: AgentcardCard, fallbackAmount = 0): CardSummary {
  const expiry =
    card.expiry ?? (card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : undefined);
  return {
    id: card.id,
    last4: card.last4 ?? card.lastFour,
    expiry,
    amountCents: card.amountCents ?? card.balanceCents ?? fallbackAmount,
    status: card.status,
  };
}

/**
 * Agentcard: single-use virtual Visa cards for agents. Set AGENTCARD_CLIENT_ID and
 * AGENTCARD_CLIENT_SECRET (sandbox or production credentials from the Agentcard dashboard).
 * https://docs.agentcard.sh
 */
export class AgentcardPayments implements Payments {
  readonly name = "agentcard";
  private token: { value: string; expiresAt: number } | null = null;

  configured(): boolean {
    return Boolean(env("AGENTCARD_CLIENT_ID") && env("AGENTCARD_CLIENT_SECRET"));
  }

  private async accessToken(): Promise<string> {
    const clientId = env("AGENTCARD_CLIENT_ID");
    const clientSecret = env("AGENTCARD_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new IntegrationSetupError(
        "Agentcard",
        "Agentcard is not configured. Set AGENTCARD_CLIENT_ID and AGENTCARD_CLIENT_SECRET on the Workstate server (sandbox credentials mint sandbox cards).",
        ["AGENTCARD_CLIENT_ID", "AGENTCARD_CLIENT_SECRET"],
      );
    }
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const data = await jsonRequest<TokenResponse>("Agentcard", `${API}/api/v2/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!data.access_token) throw new Error("Agentcard did not return an access token.");
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  }

  private async headers(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.accessToken()}`, "content-type": "application/json" };
  }

  async createCard(input: { amountCents: number; memo?: string }): Promise<CardSummary> {
    if (!Number.isInteger(input.amountCents) || input.amountCents < 100) {
      throw new Error("Agentcard cards need an integer amountCents of at least 100 ($1.00).");
    }
    const cardholderId = env("AGENTCARD_CARDHOLDER_ID");
    const card = await jsonRequest<AgentcardCard>("Agentcard", `${API}/api/v1/cards`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ amountCents: input.amountCents, ...(cardholderId ? { cardholderId } : {}), ...(input.memo ? { memo: input.memo } : {}) }),
    });
    return summarize(card, input.amountCents);
  }

  async cardDetails(id: string): Promise<CardDetails> {
    const headers = await this.headers();
    const [summary, details] = await Promise.all([
      jsonRequest<AgentcardCard>("Agentcard", `${API}/api/v1/cards/${encodeURIComponent(id)}`, { headers }),
      jsonRequest<AgentcardCardDetails>("Agentcard", `${API}/api/v1/cards/${encodeURIComponent(id)}/details`, { headers }),
    ]);
    const number = details.pan ?? details.number;
    if (!number || !details.cvv) throw new Error(`Agentcard did not return credentials for card ${id}.`);
    return { ...summarize({ ...summary, ...details }), number, cvv: details.cvv };
  }

  async closeCard(id: string): Promise<void> {
    await jsonRequest("Agentcard", `${API}/api/v1/cards/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await this.headers(),
      expect: [200, 202, 204],
    });
  }
}
