import type { RunStatus } from "./api";

const LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting_for_human: "Waiting for you",
  human_controlling: "You're in control",
  resumed: "Resuming",
  success: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return LABELS[status as RunStatus] ?? status;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function isActiveStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_human" || status === "human_controlling" || status === "resumed";
}
