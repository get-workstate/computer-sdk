import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, SUGGESTED_TASKS, api, type AdapterInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function RunForm({ initialEnv = "acme" }: { initialEnv?: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState(initialEnv);
  const [prompt, setPrompt] = useState(SUGGESTED_TASKS[0]?.prompt ?? "");
  const [model, setModel] = useState("local/scripted");
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.adapters()
      .then((payload) => {
        if (cancelled) return;
        setAdapters(payload.adapters);
        setModel(payload.defaultModel);
      })
      .catch(() => {
        if (!cancelled) setAdapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = adapters.find((adapter) => adapter.id === model);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createEnvironment(name.trim());
      const run = await api.createRun(name.trim(), prompt.trim(), model);
      navigate(`/live/${encodeURIComponent(name.trim())}?run=${encodeURIComponent(run.id)}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not start the run.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div>
        <h2 className="font-serif text-2xl">Start a run</h2>
        <p className="mt-1 text-sm text-muted">The environment keeps its files, logins, and skills after the run ends.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_TASKS.map((task) => (
          <Button
            key={task.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPrompt(task.prompt);
              setName(task.env);
            }}
          >
            {task.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="env-name">Environment</Label>
          <Input
            id="env-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            pattern={"[a-zA-Z0-9][a-zA-Z0-9._\\-]{0,63}"}
            title="Letters, numbers, dots, underscores, or hyphens. Up to 64 characters."
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Select
            id="model"
            aria-label="Model"
            value={model}
            onValueChange={setModel}
            options={
              adapters.length > 0
                ? adapters.map((adapter) => ({ value: adapter.id, label: adapter.available ? adapter.label : `${adapter.label} (key required)` }))
                : [{ value: "local/scripted", label: "Local scripted" }]
            }
          />
        </div>
      </div>
      {selected && !selected.available ? (
        <p className="text-sm text-wait">This model needs an API key. The run will fail until you set it. Local scripted works now.</p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="prompt">Task</Label>
        <Textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} required />
      </div>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Starting…" : "Run task"}
      </Button>
    </form>
  );
}
