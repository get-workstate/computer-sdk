import { serve } from "@hono/node-server";
import { createDaemonApp } from "./http-app.js";

const port = Number(process.env.WORKSTATE_DAEMON_PORT ?? 4790);
const app = createDaemonApp();
serve({ fetch: app.fetch, hostname: "0.0.0.0", port });
console.log(`Workstate runtime daemon listening on ${port}`);
