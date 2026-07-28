# @ark/classify

Deterministic incident classification for AI agent runtime failures. Maps a
`RuntimeEvent` onto a stable taxonomy, a risk tier, and a confidence score.

## API

### `classifyEvent(event, options?) => Classification`

```ts
import { classifyEvent } from "@ark/classify";

const classification = classifyEvent({
  timestamp: new Date().toISOString(),
  app: "checkout-agent",
  phase: "error",
  error: { type: "RateLimitError", status: 429 },
});
// → { incidentReason: "rate_limit", riskTier: "low", confidence: 0.9, signals: ["http_status:429"] }
```

`options.burstThreshold` (default `3`) controls how many recent error events in
`event.recentWindow` are needed before repeated `runtime_noise` is escalated
from suppressed (`none`) to a real emerging incident (`moderate`).

## Output contract

```jsonc
{
  "incidentReason": "payload_invalid | auth_error | rate_limit | runtime_noise | state_drift | unknown",
  "riskTier": "none | low | moderate | high",
  "confidence": 0.0, // number in [0, 1]
  "signals": ["http_status:429"] // human-readable reasons the classifier fired
}
```

## Taxonomy & mapping

| Reason            | Triggers (status / keywords)                                   | Base risk |
| ----------------- | -------------------------------------------------------------- | --------- |
| `auth_error`      | 401, 403 / `unauthorized`, `api key`, `permission denied`      | high      |
| `payload_invalid` | 400, 422 / `invalid`, `validation`, `schema`, `unprocessable`  | moderate  |
| `rate_limit`      | 429 / `rate limit`, `throttled`, `quota`, `overloaded`         | low       |
| `state_drift`     | 409 / `conflict`, `drift`, `out of sync`, `version mismatch`   | high      |
| `runtime_noise`   | 5xx / `timeout`, `ECONNRESET`, `service unavailable`           | none¹     |
| `unknown`         | no match (safe default)                                        | moderate² |

¹ `runtime_noise` escalates to `moderate` when a burst is detected.
² `unknown` with no error payload is `none` for non-error phases. An explicit
`error` phase without details remains `unknown` / `moderate`.

Confidence is `0.9` for an unambiguous HTTP status, `0.6` for a keyword match,
and `0.2` for the `unknown` fallback. Classification is fully deterministic — no
randomness and no wall-clock reads.
