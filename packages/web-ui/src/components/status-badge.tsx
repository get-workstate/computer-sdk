import { cn } from "@/lib/utils";
import { statusLabel } from "@/lib/format";

const TONE: Record<string, string> = {
  queued: "bg-paper text-muted",
  running: "bg-accent/10 text-accent",
  waiting_for_human: "bg-wait/10 text-wait",
  human_controlling: "bg-wait/15 text-wait",
  resumed: "bg-accent/10 text-accent",
  success: "bg-good/10 text-good",
  failed: "bg-bad/10 text-bad",
  cancelled: "bg-paper text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", TONE[status] ?? "bg-paper text-muted")}>
      <span className={cn("size-1.5 rounded-full", status === "running" || status === "resumed" ? "bg-accent" : status === "success" ? "bg-good" : status === "failed" ? "bg-bad" : status === "waiting_for_human" || status === "human_controlling" ? "bg-wait" : "bg-muted")} />
      {statusLabel(status)}
    </span>
  );
}
