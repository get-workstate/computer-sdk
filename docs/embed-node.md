# Embed Workstate in an existing Node service

The control plane stays a separate process. Your API calls it. Do not import the server package into the service.

```bash
pnpm add @workstate/sdk
```

Until the package is published, install the built workspace package:

```bash
pnpm add @workstate/sdk@file:../path/to/workstate/packages/sdk
```

`@workstate/sdk` depends on `@workstate/protocol`. Install that the same way, or bundle both from this repo. Set `WORKSTATE_URL` to the control plane. The default is `http://127.0.0.1:4780`.

```ts
import { Workstate } from "@workstate/sdk";

const workstate = new Workstate({ url: process.env.WORKSTATE_URL });
const acme = await workstate.environment("acme");

export async function openReport(url: string) {
  const run = await acme.run(
    { prompt: `Open ${url}`, model: "local/scripted" },
    {
      onStatus(status) {
        if (status === "waiting_for_human") {
          // Tell your user. Live view: /live/acme
        }
      },
    },
  );
  if (run.status === "failed") {
    throw new Error(`${run.errorCode ?? "run_failed"}: ${run.error}`);
  }
  return run.result?.text ?? "";
}
```

`run()` long-polls until the status is terminal. It does not return while a person is still needed, so use `onStatus` to surface the live view before the call resolves.

For a model tool, `acme.asTool()` returns OpenAI, Anthropic, and raw `execute` shapes. Pass `execute` to your own loop. The tool description tells the model to call it for browser work and to stop when a person is needed.

Configure the environment once, not on every request:

```ts
await acme.configure({ model: "local/scripted", runtime: "local" });
```

`configure({ credentialRef: null })` removes a key. Unknown `runtime` values fail with `invalid_config` before a browser starts.
