import type { WebSocket } from "ws";
import type { EnvironmentRecord, RunRecord } from "@workstate/sdk";
import type { AppContext } from "./app.js";

export const FRAME_INTERVAL_MS = 400;

interface LiveSocket extends WebSocket {
  envName?: string;
}

export class LiveHub {
  private readonly rooms = new Map<string, Set<LiveSocket>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly busy = new Set<string>();

  constructor(private readonly ctx: AppContext) {}

  connect(socket: LiveSocket, envName: string): void {
    const env = this.ctx.environments.resolve(envName);
    if (!env) {
      this.send(socket, { type: "error", message: `No environment named ${envName}.` });
      socket.close(1008, "Unknown environment");
      return;
    }
    socket.envName = env.name;
    const room = this.rooms.get(env.name) ?? new Set<LiveSocket>();
    room.add(socket);
    this.rooms.set(env.name, room);
    this.ensureLoop(env.name);
    this.send(socket, {
      type: "status",
      session: this.ctx.sessions.snapshot(env.id)?.status ?? "idle",
      run: this.ctx.runs.currentForEnvironment(env.id),
    });
    void this.ctx.sessions.ensure(env).catch((error: unknown) => {
      this.send(socket, { type: "error", message: error instanceof Error ? error.message : "Could not start the browser." });
    });

    socket.on("message", (raw) => {
      void this.onMessage(env, socket, raw.toString());
    });
    socket.on("close", () => {
      room.delete(socket);
      this.stopLoop(env.name);
    });
  }

  private ensureLoop(name: string): void {
    if (this.timers.has(name)) return;
    const timer = setInterval(() => {
      void this.tick(name);
    }, FRAME_INTERVAL_MS);
    this.timers.set(name, timer);
  }

  private stopLoop(name: string): void {
    const room = this.rooms.get(name);
    if (room && room.size > 0) return;
    const timer = this.timers.get(name);
    if (timer) clearInterval(timer);
    this.timers.delete(name);
    this.rooms.delete(name);
  }

  private async tick(name: string): Promise<void> {
    if (this.busy.has(name)) return;
    const env = this.ctx.environments.getByName(name);
    const room = this.rooms.get(name);
    if (!env || !room || room.size === 0) return;
    this.busy.add(name);
    try {
      const runtime = this.ctx.sessions.getRuntime(env.id);
      const run = this.ctx.runs.currentForEnvironment(env.id);
      if (!runtime) {
        this.broadcast(name, { type: "status", session: this.ctx.sessions.snapshot(env.id)?.status ?? "starting", run });
        return;
      }
      const frame = await runtime.computer.screenshot();
      const page = await runtime.computer.page();
      this.broadcast(name, {
        type: "frame",
        data: frame.data,
        width: frame.width,
        height: frame.height,
        url: page.url,
        title: page.title,
        run,
      });
    } catch (error) {
      this.broadcast(name, { type: "error", message: error instanceof Error ? error.message : "Could not capture the browser." });
    } finally {
      this.busy.delete(name);
    }
  }

  private async onMessage(env: EnvironmentRecord, socket: LiveSocket, raw: string): Promise<void> {
    let message: { type?: string; action?: string; x?: number; y?: number; button?: "left" | "right" | "middle"; key?: string; text?: string; dx?: number; dy?: number; url?: string };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      this.send(socket, { type: "error", message: "Ignored a malformed live message." });
      return;
    }
    if (message.type !== "input") return;
    try {
      if (message.action === "start-session") {
        await this.ctx.sessions.ensure(env);
        return;
      }
      if (message.action === "take-control") {
        this.ctx.runs.markHumanControlling(env);
        return;
      }
      const runtime = this.ctx.sessions.getRuntime(env.id);
      if (!runtime) {
        this.send(socket, { type: "error", message: "The browser is still starting." });
        return;
      }
      const computer = runtime.computer;
      switch (message.action) {
        case "click":
          await computer.click(number(message.x), number(message.y), message.button ?? "left");
          break;
        case "dblclick":
          await computer.doubleClick(number(message.x), number(message.y));
          break;
        case "contextmenu":
          await computer.click(number(message.x), number(message.y), "right");
          break;
        case "move":
          await computer.move(number(message.x), number(message.y));
          break;
        case "type":
          await computer.type(String(message.text ?? ""));
          break;
        case "key":
          await computer.key(String(message.key ?? "Enter"));
          break;
        case "scroll":
          await computer.scroll(number(message.dx ?? 0), number(message.dy ?? 0));
          break;
        case "navigate":
          await computer.open(normalizeNav(String(message.url ?? ""), this.ctx.config.publicUrl));
          break;
        case "back":
          await computer.back();
          break;
        default:
          this.send(socket, { type: "error", message: "Unknown live action." });
      }
    } catch (error) {
      this.send(socket, { type: "error", message: error instanceof Error ? error.message : "Live input failed." });
    }
  }

  private send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(name: string, message: { type: string; run?: RunRecord | null } & Record<string, unknown>): void {
    const room = this.rooms.get(name);
    if (!room) return;
    const payload = JSON.stringify(message);
    for (const socket of room) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

function number(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Expected a numeric coordinate.");
  return parsed;
}

function normalizeNav(url: string, publicUrl: string): string {
  if (url.startsWith("/")) return `${publicUrl.replace(/\/$/, "")}${url}`;
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}
