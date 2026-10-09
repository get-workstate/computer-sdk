# Learn from human demonstration

<p>
  <a href="../../assets/cap-learn.mp4"><img src="../../assets/cap-learn.gif" alt="A person signs in on a browser page and opens an invoice" width="480" /></a>
</p>

A person can show a workflow once, on the live browser, and the coworker keeps that demonstration. The clip is that handoff on the demo shop: a person signs in and opens invoice `INV-1042`.

Use this when the steps are too specific to describe well, or when the login and the task belong to someone who is not the developer.

## On the Workstate live view

`human.request({ kind: "takeover" })` pauses the agent and gives the person the mouse. They click, type, and scroll on `/live/<environment>`, including from a phone. **Return to agent** hands the same page back. The profile, cookies, and files are still the environment's.

That capture is enough for a person to unblock a run. Turning it into a replayable procedure depends on the runtime.

## On Anchor

Anchor is the path that compiles a demonstration into a reusable Automation Task.

```ts
const demo = await env.startAnchorDemonstration({
  name: "Download monthly invoice",
  description: "Open Billing and download the latest invoice PDF",
  startUrl: "https://vendor.example.com/billing",
});
```

`demo.share_url` is a link for the person who knows the workflow. They do not need an Anchor account. When they finish, poll `env.getAnchorDemonstration(demo.session_id)`. A `completed` demonstration is stored on the environment as `config.anchorTasks`, with the task id Anchor generated.

Pass `anchorIdentityId` when the demonstration should start already signed in. If that login needs a person anyway, they can still sign in during the demonstration.

## On a local browser

Without Anchor, the person still drives the live view. The agent, or `local/scripted`, then writes a skill under `/workstate/skills` so the next matching prompt can replay the steps. The procedure is a JSON list of browser steps, not a video.

The difference: Anchor stores the demonstration as a hosted task. Local stores a procedure next to the environment's other files.

See [Human handoff](../hitl.md) for the pause and resume states, and [Memorize trajectories](../skill-replay/README.md) for what happens on the next run.
