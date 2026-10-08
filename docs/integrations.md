# Integrations

Everything on this page is in the tree. Each integration reads its key from the Workstate server's environment variables. Anchor is the recommended default: when `ANCHOR_API_KEY` is present and an environment does not explicitly choose a runtime or model, Workstate uses Anchor. Without that key it falls back to local Chromium and `local/scripted`. Explicitly selected, unconfigured integrations still fail with the variables to set. Nothing is mocked.

`workstate integrations` (or the **Integrations** page in the console, or `GET /api/integrations`) prints the same table live, with a `configured` flag per entry.

Status column: **verified** means it ran end to end on a developer machine. **untested** means the code path is complete and typed against the provider's documented API but has not been executed with a real key. Reports welcome.

## Selecting an integration

Integrations are chosen per environment through its `config`, except models, which are chosen per run (with an optional per-environment default).

```bash
# At creation
workstate env create billing --runtime anchor --credentials op://Ops/Northwind \
  --mailbox new --payments agentcard --model gemini/gemini-3.8-flash

# Later. --no-<flag> clears a setting.
workstate env set billing --runtime local --no-payments

# Per run
workstate run --env billing --model openai/computer-use-preview "Download the latest invoice"
```

Over HTTP: `POST /api/environments { name, config }` and `PATCH /api/environments/:name { config }`. In the SDK: `ws.environment("billing")` then `env.configure({ runtime: "anchor" })`. In the console: **New environment** or **Edit setup** on the environment page.

Changing `runtime` stops the current session; the next run starts on the new one. The environment's files and skills are unaffected, because they live in the environment directory, not the session.

### Config keys

| Key | Meaning |
|---|---|
| `runtime` | `anchor` automatically when configured, otherwise `local`; or explicitly `docker`, `browserbase`, `steel`, `kernel`, `e2b`, `daytona` |
| `model` | Default model id for runs on this environment |
| `credentials` | 1Password reference to a Login item, `op://Vault/Item` |
| `mailbox` | AgentMail inbox id or address, or `new` to create one on first use |
| `payments` | `agentcard` |
| `anchorProfile` | Anchor Browser profile name (persists logins) |
| `anchorIdentityId` | Anchor managed identity used for authentication and native task runs |
| `anchorIdentitySkipValidation` | `false` validates and reauthenticates the identity when a session starts |
| `anchorTasks` | Managed by Workstate after demonstrations compile into Anchor Automation Tasks |
| `browserbaseContextId` | Browserbase context id (persists cookies) |
| `kernelProfile` | Kernel profile name (persists logins) |
| `e2bTemplate` | E2B template name (default `workstate-runtime`) |
| `daytonaImage` | Image for Daytona sandboxes (default `workstate/runtime:0.1`) |
| `daytonaSnapshot` | Daytona snapshot name, used instead of `daytonaImage` |

## Runtimes

A runtime provider implements `start(environment) → session` where a session has `computer`, `shell`, `files`, `stop()`, and optionally `cdpUrl` and `liveViewUrl`. Two shapes ship:

- **Hosted browser** (`CdpBrowserRuntimeProvider` in `runtime-local`): the provider opens a cloud Chromium and Workstate attaches with Playwright over CDP. Shell and files stay on the Workstate host, in the environment directory. Anchor, Browserbase, Steel, and Kernel use this.
- **Full sandbox** (`runtime-docker`'s remote session): the Workstate runtime image runs inside the sandbox and Workstate talks to its daemon on port 4790. Browser, shell, and files all live in the sandbox. Docker, E2B, and Daytona use this.

| Runtime | Env vars | Persistence | Status |
|---|---|---|---|
| `local` | none (`WORKSTATE_HEADLESS=0` shows the window) | Chromium profile on disk | verified |
| `docker` | `WORKSTATE_RUNTIME_IMAGE` (default `workstate/runtime:0.1`) | environment directory mounted | untested |
| `anchor` | `ANCHOR_API_KEY`; optional `WORKSTATE_ANCHOR_PROFILE`, `config.anchorProfile`, or `config.anchorIdentityId` | managed identity, named profile, Automation Tasks | verified |
| `browserbase` | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`; optional `WORKSTATE_BROWSERBASE_CONTEXT_ID` or `config.browserbaseContextId` | context id | untested |
| `steel` | `STEEL_API_KEY`; `STEEL_API_URL` for self-hosted | none | untested |
| `kernel` | `KERNEL_API_KEY`; optional `WORKSTATE_KERNEL_PROFILE` or `config.kernelProfile` | named profile | untested |
| `e2b` | `E2B_API_KEY`; `WORKSTATE_E2B_TEMPLATE` or `config.e2bTemplate` | none between sessions | untested |
| `daytona` | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `WORKSTATE_DAYTONA_IMAGE`, `WORKSTATE_DAYTONA_SNAPSHOT` | none between sessions | untested |

Hosted browsers expose `cdpUrl` and, where the provider has one, `liveViewUrl` (shown on the environment page). The Workstate live view works on every runtime because it streams screenshots through the `computer` interface.

### Anchor: authentication, demonstrations, and task memory

`ANCHOR_API_KEY` makes Anchor both the automatic browser runtime and `anchor/agent` the automatic model. The adapter runs Anchor's native web agent in the same session. If a later prompt matches a task learned from a demonstration, it calls that Automation Task instead.

```ts
const env = await ws.environment("billing", {
  anchorIdentityId: "identity-id", // optional managed login
});

const demo = await env.startAnchorDemonstration({
  name: "Download monthly invoice",
  description: "Open Billing and download the latest invoice PDF",
  startUrl: "https://vendor.example.com/billing",
});

// Give demo.share_url to the operator. Poll until completed:
const status = await env.getAnchorDemonstration(demo.session_id);
// status.learnedTask is saved to config.anchorTasks when ready.
```

The demonstration link is generated by Anchor and expires. It can start already authenticated when the environment has `anchorIdentityId`. `env.reauthenticateAnchorIdentity()` validates and refreshes that identity. The equivalent HTTP routes are:

- `POST /api/environments/:ref/anchor/demonstrations`
- `GET /api/environments/:ref/anchor/demonstrations/:id`
- `POST /api/environments/:ref/anchor/reauthenticate`

When Anchor is absent, persistent local Chromium remains the runtime. `local/scripted` writes deterministic skills, while `browser-harness/<provider>/<model>` is instructed to save successful browser code with `skills_write` and replay it with `skills_list`. Those local skills and files stay under the Workstate environment.

Sandbox runtimes need the runtime image available to the provider:

```bash
docker build -f packages/runtime-docker/Dockerfile -t workstate/runtime:0.1 .
# E2B: build a template from that Dockerfile and name it workstate-runtime (or set config.e2bTemplate)
# Daytona: push the image somewhere Daytona can pull it, or create a snapshot and set config.daytonaSnapshot
```

The E2B and Daytona SDKs are optional peer dependencies. Install the one you use: `pnpm add e2b` or `pnpm add @daytona/sdk` in `packages/integrations`. Without it, the runtime fails with an install hint.

Known gaps: sessions on `docker`, `e2b`, and `daytona` do not expose `cdpUrl` yet, so the Stagehand and browser-harness adapters cannot attach to them. Use `local` or one of the hosted browsers for those two.

## Models and harnesses

A model adapter is `{ name, available(), run(input) }`. `input` carries `computer`, `shell`, `files`, `human`, `skills`, plus `cdpUrl` when the runtime has one and `integrations` (credentials, mail, payments) when the environment has them. Model ids are `<adapter>/<model>`.

| Model id | Needs | How it drives the computer | Status |
|---|---|---|---|
| `local/scripted` | nothing | three built-in recipes (demo shop invoice, Hacker News, open a URL) and saved skills | verified |
| `anchor/agent` | `ANCHOR_API_KEY` and Anchor runtime | Anchor native web agent; matching learned Automation Tasks run in the current Anchor session | verified |
| `openai/computer-use-preview` | `OPENAI_API_KEY` | Responses API `computer_use_preview` tool, screenshots in, actions out; safety checks go to a human approval | untested |
| `anthropic/claude-sonnet-4-5` | `ANTHROPIC_API_KEY` | Messages API `computer_20250124` tool | untested |
| `gemini/gemini-3.8-flash` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Gemini API `computerUse` tool; `safety_decision` goes to a human approval | untested |
| `stagehand/<provider>/<model>` | the provider's key, plus `pnpm add @browserbasehq/stagehand` | Stagehand agent attached to the session's `cdpUrl`; `stagehand-dom/` and `stagehand-hybrid/` prefixes pick the agent mode | untested |
| `browser-use/cloud` | `BROWSER_USE_API_KEY` | Browser Use Cloud task API; the transcript is saved to `/workspace/browser-use/<id>.md` | untested |
| `browser-harness/<provider>/<model>` | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, plus `browser-harness` on `PATH` (`uv tool install --python 3.12 browser-harness`) or `WORKSTATE_BROWSER_HARNESS_BIN` | a text model writes Python snippets that the harness CLI runs against the session's `cdpUrl` | untested |

The OpenAI, Anthropic, Gemini, and browser-harness adapters expose the same extra tools when the environment has them: `credentials_fill` and `credentials_fill_otp` (1Password), `mail_address`, `mail_list`, and `mail_wait_for_code` (AgentMail), `card_create`, `card_details`, and `card_close` (Agentcard). Stagehand and browser-use run their own loops and do not get these tools. `WORKSTATE_MAX_STEPS` caps the loop (default 40).

The browser-use and Stagehand entries are integrations with those projects' agent loops, not reimplementations. browser-use runs in its own cloud browser, so files it produces are not in the environment; the adapter writes the transcript into `/workspace` so the run has an artifact.

## Secrets: 1Password

`config.credentials = "op://Vault/Item"` attaches a 1Password Login item to the environment. Two backends, chosen by which variables are set:

| Backend | Env vars | Needs |
|---|---|---|
| Service account (official SDK) | `OP_SERVICE_ACCOUNT_TOKEN` | `pnpm add @1password/sdk` in `packages/integrations` |
| Connect server (REST) | `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN` | nothing extra |

The model never receives the secret. `credentials_fill` locates the username and password fields (a heuristic selector, or ones the model passes), fills them through the `computer` interface, presses Enter, and returns only the selectors it used and whether a one-time code exists. `credentials_fill_otp` does the same for a TOTP field when the item has one. The scripted adapter uses the same path before asking a person to log in, so a saved login turns the demo's human step into a no-op.

## Mail: AgentMail

`config.mailbox` points the environment at an AgentMail inbox: an inbox id, an address, or `new` to create one on first use. Needs `AGENTMAIL_API_KEY` (optional `AGENTMAIL_API_URL`). Tools: `mail_address` returns the inbox address for sign-up forms; `mail_wait_for_code` polls for up to two minutes for a new message and extracts a verification code (4 to 8 digits, or a 6 to 8 character alphanumeric code near the word "code"); `mail_list` returns recent subjects and senders.

## Payments: Agentcard

`config.payments = "agentcard"` lets the agent request a single-use virtual card. Needs `AGENTCARD_CLIENT_ID`, `AGENTCARD_CLIENT_SECRET`, and `AGENTCARD_CARDHOLDER_ID`. Every `card_create` call first raises a `human.request({ kind: "approval" })` with the amount and memo; the card is only issued after a person approves in the live panel. A decline returns `{ approved: false }` to the model and the run continues. `card_details` returns the number, expiry, and CVV for the agent to type at checkout; `card_close` releases the funds.

## Adding one

- Runtime: implement `RuntimeProvider` (or wrap `CdpBrowserRuntimeProvider` with an `openBrowser` function) in `packages/integrations/src/runtimes`, add the id to `RUNTIME_IDS` and a descriptor in `registry.ts`.
- Model: implement `CuaAdapter` in `packages/model-adapters/src`, add it to `builtIn` and `MODEL_META` in `index.ts`.
- Service: implement `SecretsProvider`, `Mailbox`, or `Payments` from `@workstate/sdk`, and wire it in `integrationsForEnvironment`.

Setup failures should throw `IntegrationSetupError` (`status: 400`, `code: "integration_not_configured"`, `envVars`) so a failed run's error names the variables to set and any synchronous API path answers 400 instead of 500.
