# @ark/core

Shared contracts for the Agent Reliability Kit: the runtime-event input model,
the incident taxonomy, policy/report types, and an OpenTelemetry GenAI attribute
mapper. Every other `@ark/*` package depends on these types so the pipeline
(`sanitize → classify → policy → report`) speaks one vocabulary.

This package is runtime-light: types, a few frozen constants, small type guards,
and one mapping function. No I/O, no side effects.

## Exports

### Types
`RuntimeEvent`, `IncidentPhase`, `GenAiOperation`, `RuntimeError`, `TokenUsage`,
`SessionRef`, `RecentEvent`, `Classification`, `IncidentReason`, `RiskTier`,
`PolicyAction`, `PolicyDecision`, `RetryDirective`, `FallbackDirective`,
`PolicyTraceEntry`, `IncidentReport`.

### Constants
- `SCHEMA_VERSION` — current runtime-event schema version (`"2.0.0"`).
- `INCIDENT_REASONS`, `RISK_TIERS`, `POLICY_ACTIONS` — frozen enumerations.

### Functions
- `isIncidentReason(value)` / `isRiskTier(value)` — type guards.
- `riskTierRank(tier)` — numeric severity rank for comparisons.
- `clampConfidence(value)` — clamp a number into `[0, 1]`.
- `toGenAIAttributes(event)` — project a `RuntimeEvent` onto OpenTelemetry
  GenAI span attributes.

## OpenTelemetry GenAI alignment

`toGenAIAttributes` follows the OpenTelemetry GenAI semantic conventions
(Development stability as of mid-2026):

| RuntimeEvent field   | OTel attribute              |
| -------------------- | --------------------------- |
| `provider`           | `gen_ai.provider.name`      |
| `operation`          | `gen_ai.operation.name`     |
| `model`              | `gen_ai.request.model`      |
| `responseModel`      | `gen_ai.response.model`     |
| `usage.inputTokens`  | `gen_ai.usage.input_tokens` |
| `usage.outputTokens` | `gen_ai.usage.output_tokens`|
| `error.type`         | `error.type`                |

The deprecated `gen_ai.system` attribute is never emitted, and prompt/response
content is intentionally left out (content capture is opt-in and privacy
sensitive).

## Example

```ts
import { toGenAIAttributes, type RuntimeEvent } from "@ark/core";

const event: RuntimeEvent = {
  timestamp: new Date().toISOString(),
  app: "checkout-agent",
  phase: "error",
  provider: "anthropic",
  operation: "chat",
  model: "claude-sonnet-5",
  error: { type: "RateLimitError", status: 429 },
};

const attributes = toGenAIAttributes(event);
// → { "gen_ai.provider.name": "anthropic", "gen_ai.operation.name": "chat", ... }
```
