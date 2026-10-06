# Human handoff

The adapter calls `human.request` when it cannot continue alone. The run becomes `waiting_for_human` and the live view shows the message.

| Kind | What the person does | What the agent receives |
| --- | --- | --- |
| `login` | Signs in on the live screen, then **Return to agent**. | `{ action: "returned" }` |
| `approval` | **Approve** or **Decline**. | `{ action: "approve" }` or `{ action: "decline" }` |
| `input` | Types an answer and sends it. | `{ action: "answer", answers }` |
| `takeover` | Drives the browser, then returns control. | `{ action: "returned" }` |

**Take control** moves `waiting_for_human` to `human_controlling`. The agent stays blocked. **Return to agent** sets `resumed` and resolves the request. The next computer call flips the status back to `running`, which is what the event "Agent resumed" records.

**Stop run** cancels the run and rejects the waiting request.

You can also create a request with no agent attached:

```bash
curl -s -X POST http://127.0.0.1:4780/api/environments/acme/human-requests \
  -H 'content-type: application/json' \
  -d '{"kind":"approval","message":"Ship it?"}'
```

Approve, decline, answer, or return it with `POST /api/environments/acme/human`. A decline with nobody waiting fails the run. An approval completes it.

Live input (click, type, scroll, address bar) works during the wait. The touch keyboard under the frame is there for phones, where a hardware keyboard is not.
