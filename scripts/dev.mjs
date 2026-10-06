import { spawn } from "node:child_process";

const env = {
  ...process.env,
  WORKSTATE_HOST: process.env.WORKSTATE_HOST ?? "0.0.0.0",
  WORKSTATE_PORT: process.env.WORKSTATE_PORT ?? "4780",
};

const server = spawn("node", ["packages/cli/dist/bin.js", "start", "--no-open"], {
  env,
  stdio: "inherit",
});
const web = spawn("pnpm", ["--filter", "@workstate/web-ui", "dev"], {
  env,
  stdio: "inherit",
});

function shutdown() {
  server.kill("SIGTERM");
  web.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("exit", (code) => {
  web.kill("SIGTERM");
  if (code) process.exit(code);
});
web.on("exit", (code) => {
  server.kill("SIGTERM");
  if (code) process.exit(code);
});
