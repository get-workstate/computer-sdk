import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { EnvironmentConfig, IntegrationInfo } from "@/lib/api";

export const DEFAULT_RUNTIME = "local";

export function integrationLabel(item: IntegrationInfo): string {
  return item.configured ? item.name : `${item.name} (needs key)`;
}

/** Form fields shared by "New environment" and the environment setup editor. */
export function EnvironmentConfigFields({
  idPrefix,
  value,
  onChange,
  integrations,
}: {
  idPrefix: string;
  value: EnvironmentConfig;
  onChange: (next: EnvironmentConfig) => void;
  integrations: IntegrationInfo[];
}) {
  const runtimes = integrations.filter((item) => item.kind === "runtime");
  const models = integrations.filter((item) => item.kind === "model");
  const secrets = integrations.find((item) => item.kind === "secrets");
  const mail = integrations.find((item) => item.kind === "mail");
  const payments = integrations.find((item) => item.kind === "payments");

  const automaticRuntime = runtimes.find((item) => item.id === "anchor" && item.configured) ? "anchor" : DEFAULT_RUNTIME;
  const runtime = value.runtime ?? automaticRuntime;
  const selectedRuntime = runtimes.find((item) => item.id === runtime);
  const model = value.model ?? "";
  const selectedModel = models.find((item) => model.startsWith(`${item.id}/`) || model === item.id);

  function set(key: string, next: string) {
    onChange({ ...value, [key]: next === "" ? null : next });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-runtime`}>Runtime</Label>
        <Select
          id={`${idPrefix}-runtime`}
          aria-label="Runtime"
          value={runtime}
          onValueChange={(next) => set("runtime", next === automaticRuntime ? "" : next)}
          options={
            runtimes.length > 0
              ? runtimes.map((item) => ({ value: item.id, label: integrationLabel(item) }))
              : [{ value: DEFAULT_RUNTIME, label: "Local Chromium" }]
          }
        />
        {selectedRuntime ? <p className="text-xs text-muted">{selectedRuntime.description}</p> : null}
        {selectedRuntime && !selectedRuntime.configured ? (
          <p className="text-xs text-wait">Set {selectedRuntime.envVars.join(", ")} on the server before the first run.</p>
        ) : null}
      </div>
      {runtime === "anchor" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-anchor-identity`}>Anchor identity</Label>
            <Input
              id={`${idPrefix}-anchor-identity`}
              value={value.anchorIdentityId ?? ""}
              onChange={(event) => set("anchorIdentityId", event.target.value)}
              placeholder="Managed identity id (optional)"
            />
            <p className="text-xs text-muted">Reuses authentication and supports managed reauthentication.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-anchor-profile`}>Anchor profile</Label>
            <Input
              id={`${idPrefix}-anchor-profile`}
              value={value.anchorProfile ?? ""}
              onChange={(event) => set("anchorProfile", event.target.value)}
              placeholder="Persistent profile name (optional)"
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-model`}>Default model</Label>
        <Input
          id={`${idPrefix}-model`}
          value={model}
          onChange={(event) => set("model", event.target.value)}
          placeholder="Server default (leave empty) or e.g. openai/computer-use-preview"
          list={`${idPrefix}-model-options`}
        />
        <datalist id={`${idPrefix}-model-options`}>
          {models.map((item) => (
            <option key={item.id} value={item.select.replace(/^model = /, "")}>
              {integrationLabel(item)}
            </option>
          ))}
        </datalist>
        {selectedModel && !selectedModel.configured ? (
          <p className="text-xs text-wait">
            {selectedModel.name} needs {selectedModel.envVars.join(", ")}.
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-credentials`}>Login credentials (1Password)</Label>
        <Input
          id={`${idPrefix}-credentials`}
          value={value.credentials ?? ""}
          onChange={(event) => set("credentials", event.target.value)}
          placeholder="op://Vault/Item"
          pattern={"op://.+/.+"}
        />
        {secrets && !secrets.configured && value.credentials ? (
          <p className="text-xs text-wait">1Password is not configured on the server ({secrets.envVars.join(" or ")}).</p>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-mailbox`}>Mailbox (AgentMail)</Label>
          <Input
            id={`${idPrefix}-mailbox`}
            value={value.mailbox ?? ""}
            onChange={(event) => set("mailbox", event.target.value)}
            placeholder="inbox id, address, or 'new'"
          />
          {mail && !mail.configured && value.mailbox ? <p className="text-xs text-wait">Needs {mail.envVars.join(", ")}.</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-payments`}>Payments</Label>
          <Select
            id={`${idPrefix}-payments`}
            aria-label="Payments"
            value={value.payments ?? "none"}
            onValueChange={(next) => set("payments", next === "none" ? "" : next)}
            options={[
              { value: "none", label: "None" },
              { value: "agentcard", label: payments ? integrationLabel(payments) : "Agentcard" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Drop null/empty values so a fresh environment only stores what the user set. */
export function compactConfig(config: EnvironmentConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === "string" && val.trim() !== "") out[key] = val.trim();
  }
  return out;
}
