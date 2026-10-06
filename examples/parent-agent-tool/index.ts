import { Workstate } from "@workstate/sdk";

const ws = new Workstate();
const acme = await ws.environment("acme");
const tool = acme.asTool();

console.log("OpenAI tool");
console.log(JSON.stringify(tool.openai, null, 2));
console.log("Anthropic tool");
console.log(JSON.stringify(tool.anthropic, null, 2));

if (process.argv.includes("--run")) {
  const result = await tool.execute({ prompt: "Download the latest invoice from the demo shop" });
  console.log(result.status, result.result?.text ?? result.error);
}
