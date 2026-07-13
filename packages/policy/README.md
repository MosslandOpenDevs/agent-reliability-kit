# @ark/policy

Deterministic recovery policy engine. Converts a `Classification` into a concrete
runtime `PolicyDecision` — retry, fallback, sanitize, fail-fast, or noop — with a
full decision trace for observability.

## API

### `evaluatePolicy(classification, context?, config?) => PolicyDecision`

```ts
import { evaluatePolicy } from "@ark/policy";

const decision = evaluatePolicy(
  { incidentReason: "rate_limit", riskTier: "low", confidence: 0.9, signals: [] },
  { attempt: 0 },
  { maxRetries: 3, baseDelayMs: 500, backoffFactor: 2, fallback: { provider: "anthropic" } },
);
// → { action: "retry", retry: { attempt: 1, maxRetries: 3, delayMs: 500 }, reason: "...", trace: [...] }
```

### Config (`PolicyConfig`)

| Option          | Default | Meaning                                   |
| --------------- | ------- | ----------------------------------------- |
| `maxRetries`    | `3`     | Attempts before escalating                |
| `baseDelayMs`   | `500`   | Base backoff delay                        |
| `backoffFactor` | `2`     | Exponential multiplier                    |
| `maxDelayMs`    | `30000` | Cap on any single delay                   |
| `fallback`      | —       | `{ provider?, model? }` route when exhausted |

### Context (`PolicyContext`)

- `attempt` — attempts already made (`0` = first try just failed).

## Decision rules

1. `auth_error` / `state_drift` → **fail_fast** (non-recoverable).
2. risk tier `none` → **noop** (suppressed noise).
3. `payload_invalid` → **sanitize** (re-sanitize + retry) while attempts remain, else **fail_fast**.
4. `rate_limit` / `runtime_noise` / `unknown` → **retry** with exponential backoff
   (`unknown` retries at most once), then **fallback** if configured, else **fail_fast**.

Backoff is `min(maxDelayMs, baseDelayMs × backoffFactor^attempt)` — pure and
deterministic, so decisions are fully reproducible and test-covered. Every
decision includes an ordered `trace` of the rules evaluated.
