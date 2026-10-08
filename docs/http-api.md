# HTTP API

TypeScript clients should use `@workstate/sdk`. Every other language uses these routes. The same document is served at [http://127.0.0.1:4780/openapi.json](http://127.0.0.1:4780/openapi.json) and `/api/openapi.json`.

`GET /api/health` returns `{ ok, version, defaultModel }`. `GET /healthz` is the process check.

## Model and recipe

A run's `model` overrides the environment's `config.model`, which overrides the server default from `GET /api/health`. With no provider key, the default is `local/scripted`.

`GET /api/recipes` lists the three keyless recipes. Matching order:

1. A `recipe` id on the run skips keyword matching.
2. Otherwise a saved skill whose tags overlap the prompt still wins.
3. An explicit `http(s)` URL selects `open-url`, even if the sentence also says "demo shop".
4. A prompt that asks to download an invoice still selects `download-latest-invoice`.
5. Hacker News wording selects `summarize-hacker-news`.

`open-url` does not ask a person and does not save a skill. The invoice recipe does both.

## Create, wait, read

```bash
curl -s -X POST http://127.0.0.1:4780/api/environments \
  -H 'content-type: application/json' \
  -d '{"name":"acme","config":{"model":"local/scripted"}}'

curl -s -X POST http://127.0.0.1:4780/api/environments/acme/runs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Open http://127.0.0.1:4780/demo/shop","model":"local/scripted"}'
```

Poll with the run id from that response. `after` is the last event id you have already handled. `wait=1` holds the request until something changes, or about 20 seconds.

```bash
curl -s "http://127.0.0.1:4780/api/runs/RUN_ID?wait=1&after=0"
```

The body is `{ run, events }`. Stop when `run.status` is `success`, `failed`, or `cancelled`.

`run.error` is the human-readable failure. `run.errorCode` is the stable reason:

| code | when |
| --- | --- |
| `needs_human` | status is `waiting_for_human` |
| `no_recipe` | `local/scripted` has no matching recipe |
| `invalid_recipe` | the recipe id does not apply, usually `open-url` with no URL |
| `declined` | a person declined the request |
| `integration_not_configured` | a runtime or service was selected without its key |
| `run_failed` | anything else |

A `plan` event carries `{ source: "skill" \| "recipe", name }`.

## Human handoff

While `errorCode` is `needs_human`, open `run` live view at `/live/<environment>` or answer on the API:

```bash
curl -s -X POST http://127.0.0.1:4780/api/environments/acme/human \
  -H 'content-type: application/json' \
  -d '{"action":"return","requestId":"REQUEST_ID"}'
```

`decline` fails the run. `stop` cancels it. `POST /api/runs/<id>/cancel` cancels from the run id.

## Files and shell

```bash
curl -s "http://127.0.0.1:4780/api/environments/acme/files?path=/workspace"
curl -s "http://127.0.0.1:4780/api/environments/acme/files/content?path=/workspace/pages/page.txt"
curl -s -X POST http://127.0.0.1:4780/api/environments/acme/exec \
  -H 'content-type: application/json' \
  -d '{"command":"ls invoices"}'
```

Paths are virtual: `/workspace` and `/workstate`.
