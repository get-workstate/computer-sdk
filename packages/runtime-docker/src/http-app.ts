import { LocalRuntimeProvider } from "@workstate/runtime-local";
import type { RuntimeSession } from "@workstate/sdk";
import { Hono } from "hono";

export function createDaemonApp(): Hono {
  const app = new Hono();
  const provider = new LocalRuntimeProvider(true);
  let session: RuntimeSession | null = null;

  app.get("/healthz", (c) => c.json({ ok: true, session: Boolean(session) }));

  app.post("/rpc", async (c) => {
    const body = await c.req.json<{ method?: string; params?: Record<string, unknown> }>();
    try {
      const result = await dispatch(body.method ?? "", body.params ?? {});
      return c.json({ ok: true, result: result ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, 500);
    }
  });

  async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "session.start") {
      if (session) await session.stop().catch(() => undefined);
      session = await provider.start({
        id: "container",
        name: "container",
        headless: params.headless !== false,
        paths: {
          root: "/environment",
          files: String(params.filesDir ?? "/environment/files"),
          skills: String(params.skillsDir ?? "/environment/skills"),
          browserProfile: String(params.profileDir ?? "/environment/browser-profile"),
          runs: "/environment/runs",
        },
      });
      return { id: session.id };
    }
    if (method === "session.stop") {
      await session?.stop();
      session = null;
      return { ok: true };
    }
    if (!session) throw new Error("Runtime session has not started.");
    switch (method) {
      case "computer.open":
        return session.computer.open(String(params.url ?? ""));
      case "computer.screenshot":
        return session.computer.screenshot();
      case "computer.click":
        return session.computer.click(Number(params.x), Number(params.y), (params.button as "left" | "right" | "middle") ?? "left");
      case "computer.doubleClick":
        return session.computer.doubleClick(Number(params.x), Number(params.y));
      case "computer.move":
        return session.computer.move(Number(params.x), Number(params.y));
      case "computer.type":
        return session.computer.type(String(params.text ?? ""));
      case "computer.key":
        return session.computer.key(String(params.key ?? ""));
      case "computer.scroll":
        return session.computer.scroll(Number(params.dx ?? 0), Number(params.dy ?? 0));
      case "computer.wait":
        return session.computer.wait(Number(params.ms ?? 0));
      case "computer.back":
        return session.computer.back();
      case "computer.page":
        return session.computer.page();
      case "computer.text":
        return session.computer.text();
      case "computer.extract":
        return session.computer.extract(String(params.selector ?? ""));
      case "shell.exec":
        return session.shell.exec(String(params.command ?? ""), {
          cwd: typeof params.cwd === "string" ? params.cwd : undefined,
          timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        });
      case "files.read":
        return session.files.read(String(params.path ?? ""));
      case "files.write":
        await session.files.write(String(params.path ?? ""), String(params.content ?? ""));
        return { ok: true };
      case "files.list":
        return session.files.list(String(params.path ?? "/workspace"));
      default:
        throw new Error(`Unknown runtime method ${method}`);
    }
  }

  return app;
}
