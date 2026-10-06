# Concepts

Workstate splits a computer-use agent into durable state and a short-lived run.

## Environment

An environment is a named folder of state:

- `files/` is the workspace. Agents and the shell see it as `/workspace`.
- `skills/` holds procedures the agent wrote. Agents see them as `/workstate/skills`.
- `browser-profile/` is the Chromium user-data directory, so logins survive runs.
- `runs/` stores `run.json` for each attempt.

Creating an environment does not launch a browser. The first run or live viewer does.

Names are 1–64 characters: letters, numbers, `.`, `_`, or `-`.

## Session

A session is the running browser, shell, and file bridge for one environment. The server keeps at most one. A second caller waits for the same startup instead of launching a second Chromium. Stopping the session closes the browser; the profile stays on disk.

## Run

A run is one prompt against an environment.

| Status | Meaning |
| --- | --- |
| `queued` | Waiting for the environment's previous run to finish. |
| `running` | The adapter is driving the computer. |
| `waiting_for_human` | The adapter asked a person and is blocked. |
| `human_controlling` | A person took the pointer while the agent waits. |
| `resumed` | The person handed control back. The next computer call returns the run to `running`. |
| `success` | The adapter returned a result. |
| `failed` | The adapter threw, or a person declined a standalone request. |
| `cancelled` | A person stopped the run. |

Runs on the same environment are strictly ordered. Two environments run independently.

## Computer, shell, files, human, skills

Adapters do not talk to Playwright directly. They receive:

- `Computer` — open, screenshot, click, type, key, scroll, extract, text, back.
- `Shell` — `bash -lc`, with `/workspace` and `/workstate/skills` rewritten to real directories.
- `Files` — read, write, and list, confined to those two roots.
- `Human` — `request({ kind, message })` blocks until the console answers.
- `Skills` — list and write procedures that later runs can replay.

A path outside those roots fails with HTTP 400 and code `path_outside_environment`.
