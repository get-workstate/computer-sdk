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

`packages/sdk`, `server`, `runtime-local`, `runtime-docker`, `integrations`, `model-adapters`, `cli` (`workstate`), `web-ui`. Docs in `docs/`. Examples in `examples/`. Tests import `dist/` and run with `node --experimental-strip-types --test`. Build order in `build:libs`: sdk → model-adapters → runtime-local → runtime-docker → integrations → server → cli.

## Integrations (added 2026-10-06)

All in the tree, none run with real keys. Full reference: `docs/integrations.md`.

- Runtimes (`config.runtime`, else `WORKSTATE_RUNTIME`, else `local`): `local`, `docker`, `anchor`, `browserbase`, `steel`, `kernel` (hosted Chromium → `CdpBrowserRuntimeProvider` in runtime-local, Playwright `connectOverCDP`; shell/files on host), `e2b`, `daytona` (runtime image inside the sandbox, `RemoteRuntimeSession` against daemon port 4790 with a `DaemonTarget { base, headers }`).
- Models (`<adapter>/<model>`): `local/scripted`, `openai/computer-use-preview`, `anthropic/claude-sonnet-4-5`, `gemini/gemini-3.8-flash`, `stagehand/<provider>/<model>` (+ `stagehand-dom/`, `stagehand-hybrid/`), `browser-use/cloud`, `browser-harness/<provider>/<model>`. Stagehand and browser-harness need `input.cdpUrl`; Docker/E2B/Daytona sessions do not expose one yet.
- Services via env config: `credentials` (op://, 1Password SDK or Connect), `mailbox` (AgentMail id/address/`new`), `payments` (`agentcard`, every card gated on `human.request({kind:"approval"})`). Exposed to model-driven adapters as tools `credentials_fill`, `credentials_fill_otp`, `mail_*`, `card_*` in `model-adapters/src/tools.ts`.
- Optional SDKs load with `loadOptional()` and fail with an install hint: `e2b`, `@daytona/sdk` (fallback `@daytonaio/sdk`), `@1password/sdk`, `@browserbasehq/stagehand`. Everything else is REST via `jsonRequest()`.
- `IntegrationSetupError` carries `status: 400`, `code: "integration_not_configured"`, `envVars`. Never fake a success.
- Registry (`integrations/src/registry.ts`): `RUNTIME_IDS`, `createRuntimeProvider`, `describeIntegrations`, `integrationsForEnvironment`, `ENVIRONMENT_CONFIG_KEYS`. `GET /api/integrations` returns descriptors plus `describeAdapters()` from model-adapters. Statuses are `verified` only for `local` runtime and `local/scripted`; keep Docker `untested` until it has been run.
- Selection surfaces: `workstate env create|set --runtime --model --credentials --mailbox --payments` (`--no-<flag>` clears), `workstate integrations`, `POST/PATCH /api/environments`, SDK `env.configure()`, console New environment dialog and Edit setup on `/env/:name`, `/integrations` page.
- Local Chromium is launched with `--remote-debugging-port=0`; the CDP URL is read from `<profileDir>/DevToolsActivePort` so Stagehand/browser-harness can attach to the local runtime. Verified in a real Chromium on this machine.
- Skipped on purpose: Modal / Fly Machines / Cloudflare sandboxes (Python-first or no fitting JS runtime slot for a browser+daemon image), the browser-use Python library (the cloud API is used instead), VNC-style desktops.

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
- base-ui `Select.Value` renders the raw value unless `items` is passed to `Select.Root`; the shared `Select` component now passes it so triggers show labels.
- `RuntimeEnvironment` requires `config`; the Docker daemon's `session.start` passes `config: {}`.
- `pnpm install --offline` fails on optional peer metadata (`@1password/sdk`); install online.
- The tmux `workstate-server` session ran node directly; `C-c` ended the session. Start it with a login shell and send the command, then `C-c` + resend to restart.

## Capability labs, round 2 (2026-10-08)

Durable copies, not in git: `/cursor/stores/self/docs/workstate-integration-lab/RESULTS-ROUND-2.md`.

Checked live on port 4780 after the API change: invoice handoff plus skill replay (`lab4-billing`), explicit URL over the words "demo shop" plus forced Hacker News (`lab5-clerk`, `lab5-hn`), `invalid_recipe` / `no_recipe` / cancel (`lab6-guard`), shell+files, live frame, and Anchor `integration_not_configured` (`lab7-ops`, `lab7-anchor`), and `asTool()` plus a 1Password miss falling through to `needs_human` (`lab8-delegate`). The live socket path is `/ws/live/:name`. `env.run()` / `asTool().execute()` block until the run is terminal, so a handoff must be answered or cancelled from another request. Long-poll responses contain only events after `after`; clients have to accumulate them to see the `plan` event.

## Anchor first-class integration (2026-10-08)

- The earlier labs only tested Anchor's missing-key failure. A real ephemeral key was obtained through Anchor's documented `/v1/agent-access` challenge and kept only in `/tmp`; never commit it.
- Real CDP smoke: created an Anchor session, attached `PlaywrightComputer`, opened `https://example.com`, and captured a 1280×800 screenshot plus provider live-view URL.
- With `ANCHOR_API_KEY`, runtime selection now defaults to `anchor` and model selection to `anchor/agent`; explicit environment/server choices still win. Without the key both fall back to local Chromium and `local/scripted`. Leave `WORKSTATE_RUNTIME` blank in `.env` to get this automatic behavior.
- Real control-plane run with empty environment config: session runtime `anchor`, plan `anchor_agent/perform-web-task`, success result `Example Domain`.
- Manual demonstration API was run for “Read example page title.” Browser QA submitted the Anchor share link and saw “Thanks! Your recording has been saved.” Polling returned `completed` and stored task `ad74b257-123e-49a5-b7af-1e4332c25ddf` in `config.anchorTasks`.
- A second Workstate run matched that memory, planned `source: anchor_task`, called Anchor's `/v2/tasks/:id/run` in the current session, and returned `{"page_title":"Example Domain"}`.
- Managed auth: `config.anchorIdentityId` is passed as `identities: [{id}]` when an Anchor session starts; `anchorIdentitySkipValidation: false` forces validation. SDK/API reauthentication calls Anchor's identity endpoint. This payload is unit-tested, but no real managed identity was available for an external login test.
- SDK: `startAnchorDemonstration`, `getAnchorDemonstration`, `reauthenticateAnchorIdentity`. HTTP routes live under `/api/environments/:ref/anchor/*`.
- Local memory fallback remains Workstate skills. The browser-harness prompt now explicitly calls `skills_list`, saves successful code/decisions with `skills_write`, and replays matching procedures.

## Verified

On this machine, 2026-10-06:

- 14 unit tests passed (`pnpm test`).
- Desktop 1366×900: started "Download the latest invoice" on `desk-acme` from the console, live view reached `waiting_for_human`, clicked the password field on the JPEG, typed `workstate`, signed in, returned control. Result saved `/workspace/invoices/INV-1042.txt` and skill `download-latest-invoice`. A second run on the same environment succeeded with no human step.
- Mobile 390×844: the same handoff on `mobile-acme`. Orders showed in the frame, Return to agent and the touch keyboard were visible, and the panel ended on Succeeded with the invoice path.
- Environment name pattern accepts `desk-acme` and rejects `bad name` with no console error.
- OpenAI, Anthropic, and the Docker runtime were not executed (no keys, no Docker).
- Integrations pass: 30 unit tests. Browser QA (desktop 1366×900 and 390×844): `/integrations` lists 18 entries with 3 configured; New environment dialog with runtime/model/credentials/mailbox/payments creates `qa-anchor` with `runtime: anchor`; Edit setup switches to local, clears credentials, sets mailbox `new`; invalid `op://` ref blocked by the input pattern; selects show labels. No console errors. No hosted provider, sandbox, model API, 1Password, AgentMail, or Agentcard call was made.

## README

2026-10-07 README edit: header is centered HTML (`h1` text "Workstate", no wordmark SVG). Tagline is `The computer SDK for developers building digital coworkers`. Large README images are `width="760"`; the video grid table is `width="520"` with `240`px gifs. Video grid is an HTML table. Removed the environment-skill image under "Remember what worked", the "One interface..." ASCII section (replaced by `assets/how-workstate-works.png`), "Built for agents that have a job", Roadmap, and the five-minute test. Sandbox heading is `Workstate compounds with any sandbox runtime`. `## Native integrations ecosystem` and `assets/native-integrations.png` (the light "Workstate native integrations" logo grid) sit immediately after `assets/how-workstate-works.png`. `## Why Workstate` is only the batteries-included checklist the user dictated (MFA/SSO, geo, VPN, credentials, HITL, WebRTC live view, mobile live view, demonstration replay, action caching, captcha/fingerprinting, token optimization, plus persistent env, shell/files, asTool, runtime swap). Several of those checks are not in the tree: live view is JPEG over WebSocket every 400ms, not WebRTC; there is no captcha solver, fingerprint spoofing, VPN, geo routing, or token optimizer. The markdown table under the sandbox heading is still what the repo implements. `assets/native-integrations.png` (a market map: many logos are not adapters in this tree; the implemented set is still `docs/integrations.md`). Both new graphics overclaim desktop and providers that are not in the repo. README order after the Rauch link (https://x.com/rauchg/status/2106848085267902815): wordmark, h1, tagline `computer environments, batteries included`, a one-sentence **tl;dr**, then `assets/sandbox-vs-workstate.png` (the "Sandbox + Workstate" graphic; compute and files are "From sandbox"), then the 2×2 gif→mp4 grid. Captions are technical, not pitch lines: Auth handoff, Bot-detection bypass, Takeover capture, Skill replay. Then a one-line fenced prompt. Quickstart is three steps: SDK pointed at the control plane (`new Workstate({ url })` + `environment(name)`), then MCP or `env.asTool()` on the agent loop, then done. MCP is still not implemented; the quickstart names it because that is the intended second surface, and the code sample is `asTool()`. The prompt must not claim bot detection, trajectory memorization, or a Python SDK. GitHub does not play `<video>`. Clip sources, all from the local console's browser on 2026-10-07, not stock footage: `cap-auth` types `workstate` on the Northwind sign-in and lands on Orders; `cap-bot` scrolls https://news.ycombinator.com/ (there is no bot-detection flow in the tree — do not describe this file as one); `cap-learn` signs in and opens INV-1042; `cap-fast` is a same-session `local/scripted` skill replay that jumps from example.com to the invoice. The prompt is one line: set `ANCHOR_API_KEY`, point `@workstate/sdk` at the control plane, then `env.asTool()` or MCP into the agent loop. It must not claim bot detection, trajectory memorization, or a Python SDK. The invoice handoff gif is still `hero-demo.gif` → `workstate-demo.mp4`. The precise markdown table under "Workstate is not another sandbox" is what the repo implements; the graphic overclaims desktop. Other assets: `workstate-wordmark.svg`, `live-handoff.png`, `environment-skill.png`, `integrations.png`. No Python SDK, no MCP, no `pip install`, no Grok, no Cloudflare/Fly, no desktop session, no Anchor-as-hosted-Workstate. License stays MIT.

## API surface added 2026-10-08

From the first three integration labs (`/cursor/stores/self/docs/workstate-integration-lab/RESULTS.md`):

- `local/scripted` treats an explicit `http(s)` URL as `open-url` unless the prompt also asks to download an invoice. `recipe` on `POST /api/environments/:ref/runs` and `env.run({ recipe })` forces `download-latest-invoice`, `summarize-hacker-news`, or `open-url` and skips skill matching.
- `GET /api/health` returns `{ ok, version, defaultModel }`. `GET /api/recipes` documents match order. `GET /openapi.json` and `/api/openapi.json` describe the HTTP surface. Docs: `docs/http-api.md`, `docs/embed-node.md`.
- `RunRecord.errorCode` is stored on the run (`needs_human`, `no_recipe`, `invalid_recipe`, `declined`, adapter/setup codes such as `integration_not_configured`, otherwise `run_failed`). Error events include `{ code }`. A `plan` event includes `{ source, name }`.
- Existing SQLite files gain `runs.error_code` via `PRAGMA table_info` + `ALTER TABLE`. New databases create the column.

The copy-paste quickstart prompt and the numbered Quickstart recommend that the customer set `ANCHOR_API_KEY`. Local Chromium remains the fallback when that key is absent.

The four README video titles are Secure auth with computer-use, Bot-detection bypass, Learn from human demonstration, and Memorize trajectories. They link to `docs/auth-handoff/README.md`, `docs/bot-detection/README.md`, `docs/takeover-capture/README.md`, and `docs/skill-replay/README.md`. The bot-detection page must not describe `cap-bot` as a captcha solve. That clip scrolls Hacker News. Stealth, captcha, and fingerprinting are Anchor's, selected by `ANCHOR_API_KEY`.

## Next

- Run each integration with a real key and flip its `status` to `verified` in `registry.ts` / `MODEL_META`.
- Expose a CDP endpoint from Docker/E2B/Daytona sessions (daemon could proxy the container's Chromium debugging port) so Stagehand and browser-harness work there.
- Build and smoke the Docker runtime somewhere Docker exists; build the E2B template and Daytona snapshot from the same Dockerfile.
- Skill matching is tag overlap; a model-written skill is free-form and only the scripted adapter replays the step language.
