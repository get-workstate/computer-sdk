import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { VERSION, type Config } from "./config.js";
import { LiveHub } from "./live.js";

export interface ServerHandle {
  url: string;
  port: number;
  host: string;
  version: string;
  close: () => Promise<void>;
}

export async function startServer(overrides?: Partial<Config>): Promise<ServerHandle> {
  const { app, ctx, dispose } = createApp(overrides);
  const server = serve({
    fetch: app.fetch,
    hostname: ctx.config.host,
    port: ctx.config.port,
  }) as HttpServer;
  const wss = new WebSocketServer({ server, perMessageDeflate: false });
  const hub = new LiveHub(ctx);
  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/ws\/live\/([^/]+)$/);
    if (!match?.[1]) {
      socket.close(1008, "Unknown socket");
      return;
    }
    hub.connect(socket, decodeURIComponent(match[1]));
  });

  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("listening", () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  const handle: ServerHandle = {
    url: ctx.config.publicUrl,
    port: ctx.config.port,
    host: ctx.config.host,
    version: VERSION,
    close: async () => {
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await dispose();
    },
  };

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(`Workstate ${VERSION} listening on ${handle.url}`);
  console.log(`Home ${ctx.config.home}`);
  console.log(`Runtime ${process.env.WORKSTATE_RUNTIME ?? "local"}`);
  return handle;
}
