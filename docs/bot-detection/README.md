# Bot-detection bypass

<p>
  <a href="../../assets/cap-bot.mp4"><img src="../../assets/cap-bot.gif" alt="A browser scrolling the Hacker News front page" width="480" /></a>
</p>

A coworker has to open the sites your users already use, including ones that refuse a datacenter browser, a shared fingerprint, or a solved-looking captcha. The browser in this clip is the same one the agent drives. It is scrolling the Hacker News front page.

Workstate does not ship its own captcha solver or fingerprint spoofer. That work belongs to the browser runtime. Anchor is the recommended one: set `ANCHOR_API_KEY`, and environments that do not pick a runtime start on Anchor. Anchor's session is a hosted Chromium with its own proxy, fingerprint, and captcha handling. Workstate attaches over CDP and keeps the files, shell, and skills on the environment.

Without an Anchor key, the same environment runs on local Chromium. That is the right fallback for development. It is a normal browser profile, not a stealth network.

## What stays yours

The site can change its checks without changing the coworker:

- The environment name, `/workspace` files, and saved skills stay where they are.
- `config.runtime` can move that environment to Anchor, or back to `local`, without copying those files.
- The live view is still Workstate's. A person can take over if a check needs a human, then return control.

## What to call

```ts
const env = await ws.environment("research");
// ANCHOR_API_KEY on the server selects Anchor when runtime is unset.
await env.run("Summarize the front page of Hacker News");
```

To force it for one environment:

```ts
await env.configure({ runtime: "anchor" });
```

`runtime: "local"` keeps that environment on the machine even when an Anchor key is set. Other hosted browsers (Browserbase, Steel, Kernel) are selectable the same way. Their stealth behavior is theirs, not Workstate's.

See [Integrations](../integrations.md) for the runtime keys.
