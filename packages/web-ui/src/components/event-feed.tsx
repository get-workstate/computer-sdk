import type { RunEvent } from "@/lib/api";
import { formatTime } from "@/lib/format";

export function EventFeed({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No events yet. They show up as soon as the run leaves the queue.</p>;
  }
  return (
    <ol className="max-h-96 space-y-2 overflow-auto pr-1">
      {events.map((event) => (
        <li key={event.id} className="grid grid-cols-[7.5rem_1fr] gap-3 text-sm">
          <time className="font-mono text-[11px] text-muted">{formatTime(event.createdAt)}</time>
          <p>
            <span className="mr-2 font-mono text-[11px] uppercase tracking-wide text-muted">{event.kind}</span>
            {event.message}
          </p>
        </li>
      ))}
    </ol>
  );
}
