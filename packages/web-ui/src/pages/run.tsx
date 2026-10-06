import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EventFeed } from "@/components/event-feed";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api, type RunEvent, type RunRecord } from "@/lib/api";
import { isActiveStatus } from "@/lib/format";

export function RunPage() {
  const { id = "" } = useParams();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const snapshot = await api.run(id);
        if (stop) return;
        setRun(snapshot.run);
        setEvents(snapshot.events);
        setState("ready");
        if (!isActiveStatus(snapshot.run.status)) stop = true;
      } catch (cause) {
        if (stop) return;
        setError(cause instanceof ApiError ? cause.message : "Could not load this run.");
        setState("error");
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!stop) void load();
    }, 1200);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id]);

  async function openArtifact(path: string) {
    if (!run) return;
    const payload = await api.fileContent(run.environmentName, path);
    setFile({ path, content: payload.content });
  }

  if (state === "loading") return <div className="h-48 animate-pulse rounded-2xl bg-line/60" />;
  if (state === "error" || !run) {
    return (
      <div className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
        <p className="text-sm text-bad">{error || "Run not found."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">{run.id}</p>
          <h1 className="mt-1 max-w-3xl font-serif text-3xl">{run.prompt}</h1>
          <p className="mt-2 text-sm text-muted">
            <Link className="underline" to={`/env/${run.environmentName}`}>
              {run.environmentName}
            </Link>
            <span className="mx-2">·</span>
            <span className="font-mono text-xs">{run.model}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <Button variant="outline" render={<Link to={`/live/${run.environmentName}?run=${run.id}`} />}>
            Live view
          </Button>
        </div>
      </div>
      {run.humanRequest ? (
        <div className="rounded-2xl border border-wait/30 bg-wait/5 p-4 text-sm">
          <p className="font-medium">A person is needed</p>
          <p className="mt-1">{run.humanRequest.message}</p>
        </div>
      ) : null}
      {run.error ? <p className="rounded-2xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{run.error}</p> : null}
      {run.result?.text ? <p className="rounded-2xl border border-line bg-card p-4 text-sm">{run.result.text}</p> : null}
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-medium">Events</h2>
        <div className="mt-3">
          <EventFeed events={events} />
        </div>
      </section>
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-medium">Artifacts</h2>
        {run.result?.artifacts && run.result.artifacts.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {run.result.artifacts.map((artifact) => (
              <li key={artifact}>
                <button type="button" className="font-mono text-sm text-accent hover:underline" onClick={() => void openArtifact(artifact)}>
                  {artifact}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No files were saved.</p>
        )}
        {file ? <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-ink p-3 font-mono text-xs text-paper">{file.content}</pre> : null}
      </section>
    </div>
  );
}
