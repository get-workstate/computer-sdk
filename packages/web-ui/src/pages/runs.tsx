import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api, type RunRecord } from "@/lib/api";
import { formatTime } from "@/lib/format";

export function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  function load() {
    setState("loading");
    api.runs()
      .then((rows) => {
        setRuns(rows);
        setState("ready");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Could not load runs.");
        setState("error");
      });
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-4xl">Runs</h1>
        <p className="mt-2 text-sm text-muted">Every task, including the ones waiting on you.</p>
      </div>
      {state === "loading" ? <div className="h-40 animate-pulse rounded-2xl bg-line/60" /> : null}
      {state === "error" ? (
        <div className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
          <p className="text-sm text-bad">{error}</p>
          <Button type="button" className="mt-3" variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      ) : null}
      {state === "ready" && runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6">
          <p className="font-medium">No runs yet.</p>
          <p className="mt-1 text-sm text-muted">Kick off the demo shop task and watch the agent hit the login wall.</p>
          <Button className="mt-4" render={<Link to="/" />}>
            Start a run
          </Button>
        </div>
      ) : null}
      {state === "ready" && runs.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Task</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">Environment</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-line/70">
                  <td className="px-4 py-3">
                    <Link to={`/runs/${run.id}`} className="font-medium hover:underline">
                      {run.prompt}
                    </Link>
                    <p className="mt-1 font-mono text-[11px] text-muted sm:hidden">{run.environmentName}</p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <Link to={`/env/${run.environmentName}`} className="hover:underline">
                      {run.environmentName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{formatTime(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
