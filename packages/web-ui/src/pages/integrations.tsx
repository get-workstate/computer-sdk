import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, api, type IntegrationInfo, type IntegrationKind } from "@/lib/api";

const GROUPS: { kind: IntegrationKind; title: string; blurb: string }[] = [
  { kind: "runtime", title: "Runtimes", blurb: "Where the environment's browser, shell, and files live. Set per environment." },
  { kind: "model", title: "Models and harnesses", blurb: "What drives the computer. Pick per run, or set a default model on the environment." },
  { kind: "secrets", title: "Secrets", blurb: "Logins the agent can fill without reading them." },
  { kind: "mail", title: "Mail", blurb: "An inbox for verification codes and sign-up mail." },
  { kind: "payments", title: "Payments", blurb: "Single-use cards, each gated on a human approval." },
];

export function IntegrationsPage() {
  const [items, setItems] = useState<IntegrationInfo[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  function load() {
    setState("loading");
    api.integrations()
      .then((payload) => {
        setItems(payload.integrations);
        setState("ready");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Could not load integrations.");
        setState("error");
      });
  }

  useEffect(() => {
    load();
  }, []);

  const configured = items.filter((item) => item.configured).length;

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Integrations</h1>
        <p className="mt-3 text-base text-muted">
          Everything here ships in the tree. A key is read from the server's environment variables; without one the integration stays listed and fails with a
          setup error instead of pretending to work.
        </p>
        {state === "ready" ? (
          <p className="mt-2 font-mono text-xs text-muted">
            {configured} of {items.length} configured on this server
          </p>
        ) : null}
      </div>
      {state === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-28 animate-pulse rounded-2xl bg-line/60" />
          <div className="h-28 animate-pulse rounded-2xl bg-line/60" />
        </div>
      ) : null}
      {state === "error" ? (
        <div className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
          <p className="text-sm text-bad">{error}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}
      {state === "ready"
        ? GROUPS.map((group) => {
            const rows = items.filter((item) => item.kind === group.kind);
            if (rows.length === 0) return null;
            return (
              <section key={group.kind}>
                <h2 className="font-serif text-2xl">{group.title}</h2>
                <p className="mt-1 text-sm text-muted">{group.blurb}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {rows.map((item) => (
                    <IntegrationCard key={item.id} item={item} />
                  ))}
                </div>
              </section>
            );
          })
        : null}
    </div>
  );
}

function IntegrationCard({ item }: { item: IntegrationInfo }) {
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-card p-4" data-integration={item.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{item.name}</h3>
          <p className="font-mono text-[11px] text-muted">{item.id}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <Badge className={item.configured ? "border-good/40 bg-good/10 text-good" : "border-wait/40 bg-wait/10 text-wait"}>
            {item.configured ? "configured" : item.envVars.length > 0 ? "needs key" : "unavailable"}
          </Badge>
          {item.status === "verified" ? <Badge>verified here</Badge> : <Badge>untested here</Badge>}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{item.description}</p>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div>
          <dt className="text-muted">Select</dt>
          <dd className="font-mono break-all">{item.select}</dd>
        </div>
        {item.envVars.length > 0 ? (
          <div>
            <dt className="text-muted">Server env vars</dt>
            <dd className="font-mono break-all">{item.envVars.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {item.docsUrl ? (
        <a
          className="mt-auto inline-flex items-center gap-1 pt-3 text-xs text-accent hover:underline"
          href={item.docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Provider docs
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </article>
  );
}
