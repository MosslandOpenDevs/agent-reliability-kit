# @ark/report

Dual-output reporting for operators and automation. Turns a `Classification` and
a `PolicyDecision` into a stable, machine-readable incident artifact that also
carries a one-line human summary.

## API

### `buildIncidentReport(classification, decision, options?) => IncidentReport`

```ts
import { buildIncidentReport, formatHumanSummary } from "@ark/report";

const report = buildIncidentReport(classification, decision);
// {
//   incidentReason: "rate_limit",
//   riskTier: "low",
//   confidence: 0.9,
//   recommendedActions: ["Retry the request using the provided backoff delay."],
//   summary: "[low] rate_limit — retry with backoff (attempt 1/3, 500ms)",
//   action: "retry",
//   schemaVersion: "2.0.0"
// }

console.log(formatHumanSummary(report));
// [low] rate_limit — retry with backoff (attempt 1/3, 500ms) · confidence 90%
```

`options.generatedAt` injects an ISO timestamp; when omitted it is left out of
the artifact entirely, so reports are snapshot-stable in tests and CI.

### `formatHumanSummary(report) => string`

A one-line operator string: risk tier, incident reason, action hint, confidence.

## Output contract

| Field                | Type                         | Notes                              |
| -------------------- | ---------------------------- | ---------------------------------- |
| `incidentReason`     | `IncidentReason`             | from `@ark/classify`               |
| `riskTier`           | `RiskTier`                   | `none \| low \| moderate \| high`  |
| `confidence`         | `number`                     | `[0, 1]`                           |
| `recommendedActions` | `string[]`                   | operator-facing next steps         |
| `summary`            | `string`                     | one-line human reason + hint       |
| `action`             | `PolicyAction`               | from `@ark/policy`                 |
| `schemaVersion`      | `string`                     | report contract version            |
| `generatedAt`        | `string?`                    | present only when injected         |

### Backward-compatibility rules

- Existing fields are never renamed or removed within a schema major version.
- New fields are added as optional and additive.
- `schemaVersion` is bumped when the contract changes; consumers should treat
  unknown fields as forward-compatible and ignore them.
