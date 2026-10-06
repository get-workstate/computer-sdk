# Workstate strategy

Context for the next session. No secrets.

## What this is

Self-hosted computer-use control plane. Persistent environment (files, Chromium profile, skills) → lazy session → run state machine. Default adapter is keyless and scripted so the hero flow runs without OpenAI or Anthropic keys. The web console, API, WebSocket live view, and demo shop share port 4780.

## How to run

```bash
pnpm install
pnpm exec playwright install chromium
pnpm build
WORKSTATE_HOST=0.0.0.0 WORKSTATE_PORT=4780 node packages/cli/dist/bin.js start --no-open
```

`pnpm dev` is that server plus Vite on 4781. State: `WORKSTATE_HOME` (default `~/.workstate`). Demo shop: `demo@workstate.dev` / `workstate` at `/demo/shop`. Node ≥ 22.13 (`node:sqlite`). pnpm 10. Workspace imports resolve to `dist/` — rebuild libs after editing them.

## Layout

`packages/sdk`, `server`, `runtime-local`, `runtime-docker`, `model-adapters`, `cli` (`workstate`), `web-ui`. Docs in `docs/`. Examples in `examples/`. Tests import `dist/` and run with `node --experimental-strip-types --test`.

## Decisions

- In-process Playwright is the default runtime. Docker (`WORKSTATE_RUNTIME=docker`, image `workstate/runtime:0.1`, daemon port 4790) is implemented and untested; do not block on it.
- Live view is JPEG frames over WebSocket every 400ms plus input forwarding, not VNC.
- `local/scripted` recipes: demo shop invoice, Hacker News front page, explicit URL. Skills persist only for the first two. Match requires ≥2 overlapping tags.
- OpenAI (`computer_use_preview`) and Anthropic (`computer-use-2025-01-24`) adapters call the real APIs and have not been executed here.
- No auth and no external database. Do not expose the port publicly.
- Human handoff: `waiting_for_human` → optional `human_controlling` → `resumed` → next computer call sets `running`.

## Lessons

- Path sandbox errors must carry `status: 400` and `code: "path_outside_environment"` or the API turns them into 500s.
- Demo shop Hono app needs `{ strict: false }` or `/demo/shop/` 404s.
- Do not put a session in the active map until the runtime exists. Use a separate `startingInfo` map.
- Playwright's page object cannot be exposed as a `page` getter; `Computer.page()` is the method and `currentPage` is the getter.
- `runtime-local` tsconfig needs the DOM lib for `extract` page functions.
- Do not log `skill_created` from both the adapter and the server wrapper.
- Filter the `node:sqlite` ExperimentalWarning in `quiet.ts`, and `require("node:sqlite")` inside `openDatabase()` rather than a static import. A static import runs before `quiet.ts` and the warning still prints.
- The environment-name `pattern` attribute uses the `v` flag. A trailing hyphen is invalid, and a doubled backslash is too. The DOM value needs one backslash: `[a-zA-Z0-9._\-]`. In JSX that is `{"[a-zA-Z0-9][a-zA-Z0-9._\\-]{0,63}"}`.
- Mobile live view needs a touch keyboard (`aria-label="Keyboard"` / `"Text to type"`). Clicks are viewport coordinates on the screenshot image.
- Do not `pkill -f` the server command; it can kill the shell that issued it. Use the tmux session `workstate-server`.
- `server.closeAllConnections()` before `server.close()`, or a CLI `run` hangs on keep-alive sockets.
- The live WebSocket sends `run: null` when nothing is active. The client must apply that null. Ignoring a falsy `run` leaves the panel stuck on "Needs you" after the run succeeds.

## Verified

On this machine, 2026-10-06:

- 14 unit tests passed (`pnpm test`).
- Desktop 1366×900: started "Download the latest invoice" on `desk-acme` from the console, live view reached `waiting_for_human`, clicked the password field on the JPEG, typed `workstate`, signed in, returned control. Result saved `/workspace/invoices/INV-1042.txt` and skill `download-latest-invoice`. A second run on the same environment succeeded with no human step.
- Mobile 390×844: the same handoff on `mobile-acme`. Orders showed in the frame, Return to agent and the touch keyboard were visible, and the panel ended on Succeeded with the invoice path.
- Environment name pattern accepts `desk-acme` and rejects `bad name` with no console error.
- OpenAI, Anthropic, and the Docker runtime were not executed (no keys, no Docker).

## README

Written as the public pitch ("a computer that remembers"). Keep it to what the code does. The "What's in the box" table marks OpenAI, Anthropic, and Docker as included but not yet run; update it when they are verified. Screenshots in `docs/assets/` are real captures from the invoice QA pass. There is no Python SDK, MCP server, or control-plane auth yet; they sit under Roadmap → Next.

## Next

- Run the OpenAI and Anthropic adapters against real keys.
- Build and smoke the Docker runtime somewhere Docker exists.
- Skill matching is tag overlap; a model-written skill is free-form and only the scripted adapter replays the step language.
