/** Compact OpenAPI 3 description of the routes a non-TypeScript client needs. */
export function openApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "Workstate",
      version: "0.1.0",
      description:
        "Control plane for a digital coworker's computer. Create an environment, start a run, and long-poll until it finishes or asks a person.",
    },
    paths: {
      "/api/health": {
        get: {
          summary: "Process health, version, and the model used when a run omits one.",
          responses: { "200": { description: "{ ok, version, defaultModel }" } },
        },
      },
      "/api/recipes": {
        get: {
          summary: "local/scripted recipes and how prompts match them.",
          responses: { "200": { description: "{ model, precedence, modelPrecedence, recipes }" } },
        },
      },
      "/api/adapters": {
        get: {
          summary: "Model catalog and whether each adapter has its credentials.",
          responses: { "200": { description: "{ defaultModel, adapters }" } },
        },
      },
      "/api/integrations": {
        get: {
          summary: "Runtimes, services, and model adapters, with config keys.",
          responses: { "200": { description: "{ integrations, configKeys }" } },
        },
      },
      "/api/environments": {
        get: { summary: "List environments.", responses: { "200": { description: "EnvironmentRecord[]" } } },
        post: {
          summary: "Get or create an environment by name.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, config: { type: "object" } } } } } },
          responses: { "201": { description: "EnvironmentRecord" } },
        },
      },
      "/api/environments/{ref}": {
        get: { summary: "Environment, skills, session, and current run.", responses: { "200": { description: "Environment detail" } } },
        patch: {
          summary: "Merge config. Null removes a key. runtime, model, credentialRef, mailbox, payments.",
          responses: { "200": { description: "EnvironmentRecord" } },
        },
      },
      "/api/environments/{ref}/runs": {
        post: {
          summary: "Queue a run. model overrides config.model. recipe forces a local/scripted recipe id.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt"],
                  properties: {
                    prompt: { type: "string" },
                    model: { type: "string" },
                    recipe: { type: "string", enum: ["download-latest-invoice", "summarize-hacker-news", "open-url"] },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "RunRecord, usually status queued" } },
        },
      },
      "/api/runs/{id}": {
        get: {
          summary: "Run plus events. wait=1 long-polls. after is the last event id you have.",
          parameters: [
            { name: "wait", in: "query", schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "{ run, events }. run.errorCode is set on failure and while a person is needed." } },
        },
      },
      "/api/runs/{id}/cancel": {
        post: { summary: "Cancel a queued or active run.", responses: { "200": { description: "RunRecord" } } },
      },
      "/api/environments/{ref}/human": {
        post: {
          summary: "Answer the active human request: return, approve, decline, answer, take_control, or stop.",
          responses: { "200": { description: "RunRecord" } },
        },
      },
      "/api/environments/{ref}/files": {
        get: { summary: "List a virtual directory. path defaults to /workspace.", responses: { "200": { description: "{ path, entries }" } } },
      },
      "/api/environments/{ref}/files/content": {
        get: { summary: "Read a virtual file.", responses: { "200": { description: "{ path, content, truncated }" } } },
      },
      "/api/environments/{ref}/exec": {
        post: { summary: "Run a shell command in the environment workspace.", responses: { "200": { description: "{ stdout, stderr, exitCode }" } } },
      },
    },
  };
}
