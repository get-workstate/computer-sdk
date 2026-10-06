# Skills

A skill is a JSON procedure stored at `/workstate/skills/<name>.json` inside the environment. The scripted adapter writes one after a successful demo-shop or Hacker News recipe. The next prompt that shares at least two tags with that skill replays the procedure instead of inventing a new one.

```json
{
  "name": "download-latest-invoice",
  "description": "Download the latest invoice from the bundled demo shop and save it under /workspace/invoices.",
  "tags": ["invoice", "download", "shop", "demo", "latest"],
  "procedure": "[{\"op\":\"open\",\"url\":\"{{serverUrl}}/demo/shop/orders\"}]"
}
```

## Steps

| Op | Fields | Effect |
| --- | --- | --- |
| `open` | `url` | Navigate. `{{serverUrl}}`, `{{title}}`, `{{url}}`, `{{date}}` are filled in. |
| `ensureLoggedIn` | `message?` | If a password field or a sign-in title is present, ask the person, then reopen the last URL. |
| `extract` | `selector`, `as` | Store matching texts. Links contribute their href. |
| `openVar` | `var`, `index?` | Open `{{var[index]}}`. |
| `saveText` | `path`, `text` | Write a workspace file. `{{orderId[0]}}` picks one extracted value. |
| `wait` | `ms` | Pause. |
| `output` | `text` | The run's result text. |

Model adapters are not required to use this format. They can call `skills_write` with any procedure string they will understand later. The scripted adapter only replays the steps above.

Explicit one-off URLs are not saved as skills, so opening `https://example.com` does not become the procedure for every later "open" prompt.
