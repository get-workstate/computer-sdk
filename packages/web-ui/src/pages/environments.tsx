import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Radio } from "lucide-react";
import { RunForm } from "@/components/run-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EnvironmentConfigFields, compactConfig } from "@/components/environment-config";
import { ApiError, api, type EnvironmentConfig, type EnvironmentRecord, type IntegrationInfo } from "@/lib/api";
import { formatTime } from "@/lib/format";

export function EnvironmentsPage() {
  const [environments, setEnvironments] = useState<EnvironmentRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<EnvironmentConfig>({});
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function load() {
    setState("loading");
    api.environments()
      .then((rows) => {
        setEnvironments(rows);
        setState("ready");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Could not load environments.");
        setState("error");
      });
  }

  useEffect(() => {
    load();
    api.integrations()
      .then((payload) => setIntegrations(payload.integrations))
      .catch(() => setIntegrations([]));
  }, []);

  async function createEnvironment(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.createEnvironment(name.trim(), compactConfig(config));
      setOpen(false);
      setName("");
      setConfig({});
      load();
    } catch (cause) {
      setCreateError(cause instanceof ApiError ? cause.message : "Could not create that environment.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">A computer that remembers</h1>
          <p className="mt-3 text-base text-muted">
            Workstate gives an agent a browser, a shell, and a filesystem that stay put. When a login wall shows up, you take the mouse, then hand it back.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          New environment
        </Button>
      </div>
      <RunForm />
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
      {state === "ready" && environments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6">
          <p className="font-medium">No environments yet.</p>
          <p className="mt-1 text-sm text-muted">Start a run and Workstate will create one. Files, logins, and skills stay attached to that name.</p>
        </div>
      ) : null}
      {state === "ready" && environments.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {environments.map((environment) => (
            <article key={environment.id} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-2xl">{environment.name}</h2>
                  <p className="mt-1 font-mono text-[11px] text-muted">{environment.id}</p>
                </div>
                <p className="text-xs text-muted">{formatTime(environment.createdAt)}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge>runtime: {typeof environment.config.runtime === "string" ? environment.config.runtime : "local"}</Badge>
                {typeof environment.config.model === "string" ? <Badge>model: {environment.config.model}</Badge> : null}
                {typeof environment.config.credentials === "string" ? <Badge>1Password</Badge> : null}
                {typeof environment.config.mailbox === "string" ? <Badge>AgentMail</Badge> : null}
                {environment.config.payments === "agentcard" ? <Badge>Agentcard</Badge> : null}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" render={<Link to={`/env/${environment.name}`} />}>
                  <FolderOpen className="size-3.5" />
                  Files
                </Button>
                <Button size="sm" render={<Link to={`/live/${environment.name}`} />}>
                  <Radio className="size-3.5" />
                  Live
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New environment"
        description="A name is enough. Pick a runtime and services here, or change them later from the environment page."
      >
        <form onSubmit={createEnvironment} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-env">Name</Label>
            <Input
              id="new-env"
              value={name}
              onChange={(event) => setName(event.target.value)}
              pattern={"[a-zA-Z0-9][a-zA-Z0-9._\\-]{0,63}"}
              required
              autoFocus
            />
          </div>
          <EnvironmentConfigFields idPrefix="new-env" value={config} onChange={setConfig} integrations={integrations} />
          {createError ? <p className="text-sm text-bad">{createError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
