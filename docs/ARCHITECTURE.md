# ARK Architecture

ARK is a small set of composable, ESM-only TypeScript packages. Teams adopt only
what they need; every package agrees on one vocabulary defined in `@ark/core`.

## Modules

| Package         | Responsibility                                             | Depends on |
| --------------- | ---------------------------------------------------------- | ---------- |
| `@ark/core`     | shared types, taxonomy, OTel GenAI mapping (no runtime I/O) | —          |
| `@ark/sanitize` | payload normalization + preflight guards                   | —          |
| `@ark/classify` | runtime event → incident reason, risk tier, confidence     | `@ark/core`|
| `@ark/policy`   | classification → retry/fallback/fail-fast decision          | `@ark/core`|
| `@ark/report`   | classification + decision → human + JSON incident artifact  | `@ark/core`|

`sanitize` is deliberately standalone (it operates on provider payloads, not
runtime events). `classify`, `policy`, and `report` share `@ark/core` types but
have **no runtime dependency on each other** — `report` consumes the *outputs*
of the other two, not their code, so each module composes independently.

## Data flow

```
Runtime Event ─▶ sanitize ─▶ classify ─▶ policy ─▶ report
                (payload)   (incident)  (action)  (human + JSON)
```

1. **sanitize** — normalize/clean the request payload before it leaves the process.
2. **classify** — map a `RuntimeEvent` to `{ incidentReason, riskTier, confidence, signals }`.
3. **policy** — convert the classification into a `PolicyDecision` with a decision trace.
4. **report** — emit a one-line human summary plus a stable JSON artifact for automation.

## Design invariants

- **Determinism over magic.** No wall-clock reads or randomness in core logic;
  timestamps/ids are injected. Every output is reproducible and snapshot-testable.
- **Fail loud, with guidance.** Decisions and reports carry a precise reason and a
  next action (`recommendedActions`, policy `trace`).
- **Noise suppression without blindness.** `runtime_noise` is suppressed to `none`
  risk unless the recent window shows a burst, which is surfaced early.
- **Human + machine symmetry.** Every incident has both a concise human summary and
  structured JSON.

## Contracts

- The runtime-event input model is specified in [`schemas/`](../schemas) and
  validated in CI. See [`schemas/README.md`](../schemas/README.md) for the
  versioning rule.
- Field names align with the OpenTelemetry GenAI semantic conventions; see
  [`@ark/core`](../packages/core/README.md) `toGenAIAttributes` for the mapping.

## Integrations

- **MCP** — expose ARK as Model Context Protocol tools, or intercept MCP transport
  traffic for observability. See [`MCP.md`](./MCP.md).
- **OpenTelemetry** — project events onto GenAI span attributes via `@ark/core`.

## Toolchain

pnpm workspaces · TypeScript (ESM-only, erasable syntax) · tsdown (Rolldown)
builds · Biome lint/format · `node:test` · Changesets + npm OIDC trusted
publishing. CI runs typecheck, lint, the schema gate, and the test matrix on
Node 22/24/26.
