import { Workstate } from "@workstate/sdk";

const ws = new Workstate();
const acme = await ws.environment("acme");
const run = await acme.run(
  {
    prompt: "Download the latest invoice from the demo shop",
    model: process.env.WORKSTATE_MODEL ?? "anthropic/claude-sonnet-4-5",
  },
  { onStatus: (status) => console.log(status) },
);
console.log(run.status === "success" ? run.result?.text : run.error);
if (run.status !== "success") process.exitCode = 1;
