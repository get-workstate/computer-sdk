# Secure auth with computer-use

<p>
  <a href="../../assets/cap-auth.mp4"><img src="../../assets/cap-auth.gif" alt="A browser sign-in page, with a password typed in and the orders screen opening after" width="480" /></a>
</p>

A coworker can get through a sign-in that a model should not invent: a password, a one-time code, SSO, or an MFA prompt. The run pauses, a person finishes that step on the live screen, and the agent continues on the same browser.

The clip is the bundled demo shop. The password `workstate` is typed on the Northwind sign-in page, and the next frame is the orders list.

## When to hand off

The agent asks a person when it reaches a wall it cannot pass alone:

| Request | The person does | The agent receives |
| --- | --- | --- |
| `login` | Signs in, then returns control | control returned |
| `approval` | Approves or declines | the decision |
| `input` | Types a fact only they know | the answer |
| `takeover` | Drives the browser, then returns control | control returned |

While the run is `waiting_for_human`, its `errorCode` is `needs_human`. Open `/live/<environment>` from a desktop browser or a phone. Clicks and keystrokes on that view go to the same Chromium the agent is using. **Return to agent** resumes the run. **Decline** fails it.

## Credentials the model never sees

Two ways to avoid typing the password by hand every time:

- Set `config.credentials` to a 1Password reference such as `op://Vault/Item`. The fill stays inside the browser. The model gets back the selectors that were used, not the secret.
- With Anchor, set `config.anchorIdentityId`. New sessions start from that managed identity. `env.reauthenticateAnchorIdentity()` refreshes a login that has gone stale, including a saved MFA method when the identity has one.

If neither path can sign in, the run still falls through to the person. It does not guess a password.

## What to call

```ts
await env.run("Download the latest invoice from the demo shop", {
  onStatus(status) {
    if (status === "waiting_for_human") {
      // Send the operator to /live/<environment>
    }
  },
});
```

Over HTTP, answer the pause with `POST /api/environments/<name>/human` and `{ "action": "return", "requestId": "..." }`.

More of the state machine is in [Human handoff](../hitl.md).
