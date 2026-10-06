import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { EnvironmentConfigFields } from "@/components/environment-config";
import { RunForm } from "@/components/run-form";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  ApiError,
  api,
  type EnvironmentConfig,
  type EnvironmentDetail,
  type FileEntry,
  type IntegrationInfo,
  type RunRecord,
} from "@/lib/api";
import { formatTime } from "@/lib/format";

const SETUP_KEYS = ["runtime", "model", "credentials", "mailbox", "payments"] as const;

function configStrings(config: Record<string, unknown>): EnvironmentConfig {
  const out: EnvironmentConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function EnvironmentPage() {
  const { name = "" } = useParams();
  const [detail, setDetail] = useState<EnvironmentDetail | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [directory, setDirectory] = useState("/workspace");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileBody, setFileBody] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EnvironmentConfig>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.integrations()
      .then((payload) => setIntegrations(payload.integrations))
      .catch(() => setIntegrations([]));
  }, []);

  function openEditor() {
    if (!detail) return;
    setDraft(configStrings(detail.config));
    setSaveError(null);
    setEditing(true);
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setSaving(true);
    setSaveError(null);
    const patch: EnvironmentConfig = {};
    for (const key of SETUP_KEYS) {
      const next = draft[key];
      const current = typeof detail.config[key] === "string" ? (detail.config[key] as string) : null;
      const value = typeof next === "string" && next.trim() !== "" ? next.trim() : null;
      if (value !== current) patch[key] = value;
    }
    try {
      if (Object.keys(patch).length > 0) await api.updateEnvironment(detail.name, patch);
      setEditing(false);
      load();
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "Could not save the setup.");
    } finally {
      setSaving(false);
    }
  }

  function load() {
    setState("loading");
    Promise.all([api.environment(name), api.runs(name)])
      .then(([environment, history]) => {
        setDetail(environment);
        setRuns(history);
        setState("ready");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Could not load this environment.");
        setState("error");
      });
  }

  useEffect(() => {
    load();
  }, [name]);

  useEffect(() => {
    if (!name) return;
    api.files(name, directory)
      .then((payload) => {
        setEntries(payload.entries);
        setFileError(null);
      })
      .catch((cause: unknown) => setFileError(cause instanceof ApiError ? cause.message : "Could not list files."));
  }, [name, directory]);

  async function openEntry(entry: FileEntry) {
    if (entry.kind === "dir") {
      setDirectory(entry.path);
      setFilePath(null);
      setFileBody("");
      return;
    }
    setFilePath(entry.path);
    try {
      const payload = await api.fileContent(name, entry.path);
      setFileBody(payload.content);
      setFileError(null);
    } catch (cause) {
      setFileError(cause instanceof ApiError ? cause.message : "Could not read that file.");
    }
  }

  if (state === "loading") return <div className="h-48 animate-pulse rounded-2xl bg-line/60" />;
  if (state === "error" || !detail) {
    return (
      <div className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
        <p className="text-sm text-bad">{error || "Environment not found."}</p>
        <Button className="mt-3" variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  const parent = directory === "/workspace" ? null : directory.split("/").slice(0, -1).join("/") || "/workspace";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">{detail.id}</p>
          <h1 className="font-serif text-4xl">{detail.name}</h1>
        </div>
        <Button render={<Link to={`/live/${detail.name}`} />}>Open live view</Button>
      </div>
      <RunForm initialEnv={detail.name} />
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Setup</h2>
            <p className="mt-1 text-sm text-muted">Where this environment runs and which services the agent can reach.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openEditor}>
            Edit setup
          </Button>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <SetupRow label="Runtime" value={typeof detail.config.runtime === "string" ? detail.config.runtime : "local"} />
          <SetupRow label="Default model" value={typeof detail.config.model === "string" ? detail.config.model : "server default"} />
          <SetupRow label="Credentials" value={typeof detail.config.credentials === "string" ? detail.config.credentials : "none"} />
          <SetupRow label="Mailbox" value={typeof detail.config.mailbox === "string" ? detail.config.mailbox : "none"} />
          <SetupRow label="Payments" value={detail.config.payments === "agentcard" ? "Agentcard (approval required)" : "none"} />
          <SetupRow
            label="Session"
            value={detail.session ? `${detail.session.status} on ${detail.session.runtime}` : "not started"}
            extra={
              detail.session?.liveViewUrl ? (
                <a className="text-accent hover:underline" href={detail.session.liveViewUrl} target="_blank" rel="noreferrer">
                  Provider live view
                </a>
              ) : null
            }
          />
        </dl>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-medium">Skills</h2>
          {detail.skills.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No skills yet. The first successful invoice or Hacker News run leaves a procedure here.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {detail.skills.map((skill) => (
                <li key={skill.name}>
                  <p className="font-mono text-sm">{skill.name}</p>
                  <p className="text-sm text-muted">{skill.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skill.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Files</h2>
            <p className="truncate font-mono text-[11px] text-muted">{directory}</p>
          </div>
          {parent ? (
            <button type="button" className="mt-2 text-sm text-accent" onClick={() => setDirectory(parent)}>
              Up
            </button>
          ) : null}
          {fileError ? <p className="mt-2 text-sm text-bad">{fileError}</p> : null}
          <ul className="mt-2 divide-y divide-line">
            {entries.length === 0 ? <li className="py-2 text-sm text-muted">Empty directory.</li> : null}
            {entries.map((entry) => (
              <li key={entry.path}>
                <button type="button" className="w-full py-2 text-left text-sm hover:underline" onClick={() => void openEntry(entry)}>
                  {entry.kind === "dir" ? `${entry.name}/` : entry.name}
                </button>
              </li>
            ))}
          </ul>
          {filePath ? (
            <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-ink px-3 py-2 font-mono text-xs text-paper">{fileBody}</pre>
          ) : null}
        </div>
      </section>
      <section>
        <h2 className="font-medium">Recent runs</h2>
        {runs.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing has run here yet.</p> : null}
        <ul className="mt-2 space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2">
              <Link to={`/runs/${run.id}`} className="text-sm hover:underline">
                {run.prompt}
              </Link>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{formatTime(run.createdAt)}</span>
                <StatusBadge status={run.status} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Environment setup"
        description="Changing the runtime stops the current session. The next run starts on the new one."
      >
        <form onSubmit={saveConfig} className="space-y-3">
          <EnvironmentConfigFields idPrefix="edit-env" value={draft} onChange={setDraft} integrations={integrations} />
          {saveError ? <p className="text-sm text-bad">{saveError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function SetupRow({ label, value, extra }: { label: string; value: string; extra?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="truncate font-mono text-xs" title={value}>
        {value}
        {extra ? <span className="ml-2 font-sans">{extra}</span> : null}
      </dd>
    </div>
  );
}
