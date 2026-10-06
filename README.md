# Workstate

Workstate is a self-hosted computer for AI agents. An environment keeps a browser profile, a workspace, and skills. A run borrows that computer, and when a login wall or an approval shows up, a person takes the mouse and hands it back.

No account is required to try the loop. With no model API key, the local scripted adapter drives a bundled demo shop, summarizes Hacker News, or opens a URL you name.

## Quick start

Requires Node.js 22.13 or newer and pnpm 10.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm build
pnpm start
```

The console and API listen on [http://127.0.0.1:4780](http://127.0.0.1:4780). For hot reload of the UI, `pnpm dev` also starts Vite on port 4781 and proxies the API.

Try the hero flow:

```bash
node packages/cli/dist/bin.js run --env acme "Download the latest invoice from the demo shop"
```

The agent opens the demo shop, stops on the sign-in page, and waits. In the live view, sign in with `demo@workstate.dev` / `workstate`, then choose **Return to agent**. The invoice lands at `/workspace/invoices/INV-1042.txt`, and the environment saves a `download-latest-invoice` skill so the next run does not ask again.

## CLI

```bash
workstate start --host 0.0.0.0 --port 4780 --no-open
workstate run --env acme "Summarize the front page of Hacker News"
workstate env create research-bot
workstate env list
workstate env open acme
workstate live acme
workstate skills list --env acme
workstate setup
```

`run`, `env`, and `skills` start an embedded server when nothing is listening. Pass `--url` to target one that is already up. `--json` prints records instead of text.

## SDK

```ts
import { Workstate } from "@workstate/sdk";

const ws = new Workstate(); // http://127.0.0.1:4780
const acme = await ws.environment("acme");
const run = await acme.run("Download the latest invoice from the demo shop", {
  onStatus: (status) => console.log(status),
});
```

`environment.asTool()` returns a tool definition for a parent agent, with OpenAI and Anthropic shapes plus an `execute` function. See `examples/parent-agent-tool`.

## Models

| Model id | When it runs |
| --- | --- |
| `local/scripted` | Default. No key. Demo shop, Hacker News, explicit URLs. |
| `openai/computer-use-preview` | `OPENAI_API_KEY` is set. Untested in this tree. |
| `anthropic/claude-sonnet-4-5` | `ANTHROPIC_API_KEY` is set. Untested in this tree. |

`WORKSTATE_DEFAULT_MODEL` wins. Otherwise a set Anthropic key is preferred over OpenAI, and the scripted adapter is the fallback.

## Concepts

An **environment** is durable: files (`/workspace`), skills (`/workstate/skills`), and a Chromium profile. A **session** is the live browser and shell, started lazily, one per environment. A **run** moves `queued → running → waiting_for_human → human_controlling → resumed → success | failed | cancelled`.

The scripted and model adapters share one computer, shell, files, human, and skills interface. See `docs/concepts.md`, `docs/hitl.md`, and `docs/skills.md`.

## Runtimes

The default runtime is Playwright in this process (`packages/runtime-local`). Logins persist in the environment's browser profile. Set `WORKSTATE_HEADLESS=0` to show the window.

`WORKSTATE_RUNTIME=docker` starts `workstate/runtime:0.1` and proxies the same computer API to a daemon on port 4790 inside the container. Build it from the repo root:

```bash
docker build -f packages/runtime-docker/Dockerfile -t workstate/runtime:0.1 .
```

That path is implemented and untested here; this machine has no Docker daemon. Use the local runtime.

## Develop

```bash
pnpm build:libs    # sdk, adapters, runtimes, server, cli
pnpm --filter @workstate/web-ui dev
pnpm test
pnpm typecheck
```

Workspace packages resolve to `dist/`, so library edits need `pnpm build:libs` before the server or tests see them. State lives in `WORKSTATE_HOME` (default `~/.workstate`) as SQLite plus one directory per environment.

The demo shop is served by the control plane at `/demo/shop`.

## Layout

```
packages/sdk              client, Environment, asTool()
packages/server           Hono API, SQLite, run state, live WebSocket, demo shop
packages/runtime-local    Playwright, sandboxed files, bash
packages/runtime-docker   container daemon and remote session
packages/model-adapters   scripted, OpenAI, Anthropic, custom
packages/cli              workstate command
packages/web-ui           React console
examples                  OpenAI, Anthropic, parent-agent tool
docs                      concepts, architecture, handoff, skills
```

## License

MIT. See [LICENSE](LICENSE).
