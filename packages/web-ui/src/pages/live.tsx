import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api, type RunRecord } from "@/lib/api";
import { isActiveStatus, statusLabel } from "@/lib/format";
import { useLive } from "@/lib/use-live";

export function LivePage() {
  const { name = "" } = useParams();
  const [params] = useSearchParams();
  const preferred = params.get("run");
  const live = useLive(name);
  const [tracked, setTracked] = useState<RunRecord | null>(null);
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef(live.send);
  sendRef.current = live.send;

  const shown = tracked ?? live.run;

  useEffect(() => {
    if (!preferred) return;
    let stop = false;
    async function poll() {
      try {
        const snapshot = await api.run(preferred!);
        if (!stop) setTracked(snapshot.run);
        if (!isActiveStatus(snapshot.run.status)) stop = true;
      } catch {
        // The frame stream still shows the session if this poll misses.
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (!stop) void poll();
    }, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [preferred]);

  useEffect(() => {
    if (!editingAddress && live.frame?.url) setAddress(live.frame.url);
  }, [editingAddress, live.frame?.url]);

  useEffect(() => {
    const element = wellRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      sendRef.current({ type: "input", action: "scroll", dx: event.deltaX, dy: event.deltaY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  function coords(event: MouseEvent) {
    const image = imgRef.current;
    const width = live.frame?.width ?? 1280;
    const height = live.frame?.height ?? 800;
    if (!image) return { x: 0, y: 0 };
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * height),
    };
  }

  function forwardKey(event: KeyboardEvent) {
    if (event.target !== wellRef.current) return;
    event.preventDefault();
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      live.send({ type: "input", action: "type", text: event.key });
      return;
    }
    live.send({ type: "input", action: "key", key: event.key === " " ? "Space" : event.key });
  }

  async function act(action: string, text?: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api.respond(name, { action, requestId: shown?.humanRequest?.id, text });
      if (preferred) {
        const snapshot = await api.run(preferred);
        setTracked(snapshot.run);
      }
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "That action didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = shown?.status === "waiting_for_human" || shown?.status === "human_controlling";
  const kind = shown?.humanRequest?.kind;

  const panel = (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">This run</h2>
        {shown ? <StatusBadge status={shown.status} /> : <span className="text-xs text-muted">{live.connected ? "Connected" : "Reconnecting"}</span>}
      </div>
      {shown ? <p className="text-sm">{shown.prompt}</p> : <p className="text-sm text-muted">No run is attached. The browser is still yours to drive.</p>}
      {shown?.humanRequest ? (
        <div className="rounded-xl bg-wait/10 p-3 text-sm text-wait">
          <p className="font-medium">Needs you</p>
          <p className="mt-1">{shown.humanRequest.message}</p>
        </div>
      ) : null}
      {shown?.error ? <p className="text-sm text-bad">{shown.error}</p> : null}
      {shown?.result?.text ? <p className="text-sm">{shown.result.text}</p> : null}
      {actionError ? <p className="text-sm text-bad">{actionError}</p> : null}
      <div className="flex flex-wrap gap-2">
        {waiting && kind === "approval" ? (
          <>
            <Button type="button" disabled={busy} onClick={() => void act("approve")}>
              Approve
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void act("decline")}>
              Decline
            </Button>
          </>
        ) : null}
        {waiting && shown?.status === "waiting_for_human" && kind !== "approval" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void act("take_control")}>
            Take control
          </Button>
        ) : null}
        {waiting && kind !== "approval" ? (
          <Button type="button" disabled={busy} onClick={() => void act("return")}>
            Return to agent
          </Button>
        ) : null}
        {shown && isActiveStatus(shown.status) ? (
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void act("stop")}>
            Stop run
          </Button>
        ) : null}
      </div>
      {waiting && kind === "input" ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act("answer", answer);
          }}
        >
          <Input aria-label="Answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
          <Button type="submit" disabled={busy}>
            Send answer
          </Button>
        </form>
      ) : null}
      {shown ? (
        <Link className="inline-block text-sm text-accent hover:underline" to={`/runs/${shown.id}`}>
          Run details
        </Link>
      ) : null}
      {live.error ? <p className="text-sm text-bad">{live.error}</p> : null}
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3">
        <form
          aria-label="Address"
          className="flex gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            live.send({ type: "input", action: "navigate", url: address });
            setEditingAddress(false);
          }}
        >
          <Input
            aria-label="Address"
            value={address}
            onFocus={() => setEditingAddress(true)}
            onBlur={() => setEditingAddress(false)}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://"
          />
          <Button type="submit" variant="outline">
            Go
          </Button>
          <Button type="button" variant="ghost" onClick={() => live.send({ type: "input", action: "back" })}>
            Back
          </Button>
        </form>
        <div
          ref={wellRef}
          tabIndex={0}
          onKeyDown={forwardKey}
          onMouseDown={() => wellRef.current?.focus()}
          className="relative overflow-hidden rounded-2xl bg-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {live.frame ? (
            <img
              ref={imgRef}
              src={live.frame.src}
              alt={live.frame.title ? `Live browser: ${live.frame.title}` : "Live browser"}
              data-testid="live-frame"
              draggable={false}
              className="block w-full select-none"
              onClick={(event) => live.send({ type: "input", action: "click", ...coords(event), button: "left" })}
              onDoubleClick={(event) => live.send({ type: "input", action: "dblclick", ...coords(event) })}
              onContextMenu={(event) => {
                event.preventDefault();
                live.send({ type: "input", action: "contextmenu", ...coords(event) });
              }}
            />
          ) : (
            <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-paper/80">
              {live.connected ? "Starting the browser…" : "Reconnecting to the live session…"}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap gap-2 p-3">
            <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-white">{live.connected ? "Live" : "Reconnecting"}</span>
            {shown ? <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-white">{statusLabel(shown.status)}</span> : null}
            <span className="rounded-full bg-black/70 px-2.5 py-1 text-xs text-white">Click the screen to interact</span>
          </div>
        </div>
        <div className="lg:hidden">{panel}</div>
        <form
          aria-label="Keyboard"
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!typed) return;
            live.send({ type: "input", action: "type", text: typed });
            setTyped("");
          }}
        >
          <Input aria-label="Text to type" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Type for the remote page" className="min-w-40 flex-1" />
          <Button type="submit" variant="outline">
            Type
          </Button>
          <Button type="button" variant="outline" onClick={() => live.send({ type: "input", action: "key", key: "Enter" })}>
            Enter
          </Button>
          <Button type="button" variant="outline" onClick={() => live.send({ type: "input", action: "key", key: "Tab" })}>
            Tab
          </Button>
        </form>
      </div>
      <div className="hidden lg:block">{panel}</div>
    </div>
  );
}
