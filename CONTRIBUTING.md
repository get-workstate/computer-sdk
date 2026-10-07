# Contributing

Workstate is early. The useful changes are the ones that make the loop real in more places: an agent drives a browser, a person can take over, and the next run remembers.

## Before you open a pull request

```bash
pnpm install
pnpm test
pnpm typecheck
```

`pnpm test` rebuilds the libraries first. Tests import `dist/`.

## What helps

- Running an included model adapter or hosted runtime with a real key, and writing down what happened. Flip `status` to `verified` in `packages/integrations/src/registry.ts` or `MODEL_META` only after that run.
- Building `packages/runtime-docker/Dockerfile` and trying `config.runtime = "docker"`.
- A new `CuaAdapter` or `RuntimeProvider`. Missing keys should throw `IntegrationSetupError`, not pretend the call worked.
- Skill replay for model-driven runs. Today only `local/scripted` replays `/workstate/skills`.
- An example that does a job someone actually has.

## What to leave out

Do not add control-plane authentication, a hosted backend, or a claim in the README about customers, downloads, or a provider that is not wired up in `packages/integrations`. The README lists only what is in the tree, and it says when that code has not been executed.

Keep the server on localhost. There is no auth.
