# Memorize trajectories

<p>
  <a href="../../assets/cap-fast.mp4"><img src="../../assets/cap-fast.gif" alt="The browser jumps from a web page straight to a saved invoice" width="480" /></a>
</p>

The second time a coworker does a job, it should reuse the path that already worked. The clip is that second pass: the browser leaves a generic page and lands on the invoice that was saved the first time, without asking a person to sign in again.

The environment keeps three things across runs: the Chromium profile, the files in `/workspace`, and the learned procedure. Replaying the procedure is what skips the search.

## Anchor tasks

When a prompt shares at least two tags with a task learned from an Anchor demonstration, the run plans `source: "anchor_task"` and calls that Automation Task inside the current Anchor session. It does not start a fresh web agent and it does not delete the session when the task returns.

```ts
const status = await env.getAnchorDemonstration(sessionId);
// status.learnedTask is now on the environment.
await env.run("Download the latest invoice");
```

A prompt that does not match a saved task still goes to Anchor's web agent (`source: "anchor_agent"`).

## Local skills

Without Anchor, `local/scripted` writes `/workstate/skills/<name>.json` after the demo-shop invoice recipe and the Hacker News recipe. The next prompt that overlaps at least two of that skill's tags replays the steps. A login wall that the profile already passed does not ask again.

`browser-harness/<provider>/<model>` is told to do the same thing in its own words: read `skills_list` before repeating a job, and `skills_write` after one succeeds. The procedure can be the harness code that worked.

Opening a one-off URL does not become a skill. Otherwise every later "open" prompt would replay that page.

A `plan` event on the run says which memory was used:

| `source` | What ran |
| --- | --- |
| `anchor_task` | An Anchor Automation Task learned from a demonstration |
| `anchor_agent` | Anchor's web agent, because no saved task matched |
| `skill` | A local procedure under `/workstate/skills` |
| `recipe` | A built-in `local/scripted` recipe, which may then be saved |

The step language for local skills is in [Skills](../skills.md). How a demonstration becomes an Anchor task is in [Learn from human demonstration](../takeover-capture/README.md).
