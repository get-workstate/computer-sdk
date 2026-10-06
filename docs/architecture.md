# Architecture

```
browser console  --HTTP/WS-->  server (Hono + ws + node:sqlite)
                                    |
                                    +--> RunManager  --> CuaAdapter
                                    |
                                    +--> SessionManager --> RuntimeProvider (per environment config)
                                                              |
                        local Playwright · hosted Chromium over CDP · runtime daemon in Docker / E2B / Daytona
```

The server, the scripted adapter, and the Playwright runtime share one Node process by default. The web UI is a static build served from the same port. Vite on 4781 is only for UI development and proxies `/api`, `/demo`, and `/ws`.

## Packages

`@workstate/sdk` is the client. `waitForRun` long-polls `GET /api/runs/:id?wait=1`. `RemoteHuman` posts to `/api/environments/:id/human`, which accepts either the environment id or its name.

`@workstate/server` owns SQLite (`environments`, `sessions`, `runs`, `run_events`), the per-environment queue, and the live frame loop. Frames are JPEG at quality 60, sent every 400ms while at least one viewer is connected. Input messages on the same socket become Playwright mouse, keyboard, and navigation calls.

`@workstate/model-adapters` resolves a model id by its `<adapter>/` prefix: `local/scripted`, OpenAI `computer_use_preview`, Anthropic `computer_20250124`, Gemini `computerUse`, Stagehand, browser-use cloud, and browser-harness. Only the scripted adapter has been executed in this tree; the others are real HTTP or SDK clients that have not been run with live keys. `createCustomAdapter` registers another implementation in process.

`@workstate/runtime-docker` is optional. The host provider runs `workstate/runtime:0.1`, which executes `packages/runtime-docker/dist/daemon.js` and exposes the same computer methods over `POST /rpc`. The same `RemoteRuntimeSession` is what the E2B and Daytona runtimes attach to inside their sandboxes.

`@workstate/integrations` holds the hosted-browser runtimes (Anchor, Browserbase, Steel, Kernel; each opens a cloud Chromium and hands the CDP URL to `CdpBrowserRuntimeProvider` in `runtime-local`), the sandbox runtimes (E2B, Daytona), the 1Password, AgentMail, and Agentcard clients, and the registry the server uses to resolve `config.runtime` and describe `GET /api/integrations`. Missing keys raise `IntegrationSetupError` (`status: 400`, `code: integration_not_configured`); a run that hits one is marked failed with that message.

The server picks the runtime per environment: `config.runtime`, then `WORKSTATE_RUNTIME`, then `local`. Changing `config.runtime` stops the environment's session. See [integrations.md](./integrations.md).

## Demo shop

`/demo/shop` is a small billing portal inside the server so the hero flow needs no network. Sign in with `demo@workstate.dev` / `workstate`. The cookie lives in the environment's browser profile. The latest order is `INV-1042`.

## Process model

`workstate start` listens until SIGINT. `workstate run` starts an embedded server only when `/healthz` fails, waits for the run, and closes it. Restarting the server marks in-flight runs failed with "Interrupted because the Workstate server restarted." Their files and browser profile remain.
