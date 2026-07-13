---
"@ark/core": minor
"@ark/sanitize": minor
"@ark/classify": minor
"@ark/policy": minor
"@ark/report": minor
---

Modernize the toolchain and implement the full reliability pipeline.

- Migrate to a TypeScript, ESM-only pnpm monorepo (tsdown builds, Biome
  lint/format, Changesets releases, Node 22/24/26 CI).
- Add `@ark/core` with the runtime-event contract, incident taxonomy, and an
  OpenTelemetry GenAI attribute mapper (`toGenAIAttributes`).
- Port `@ark/sanitize` to TypeScript with no behavior change.
- Implement `@ark/classify` (deterministic incident taxonomy, risk tiers,
  confidence), `@ark/policy` (retry/fallback/fail-fast engine with decision
  traces), and `@ark/report` (human summary + machine-readable artifact).
- Publish runtime-event schema v2 aligned with the OpenTelemetry GenAI semantic
  conventions, plus a CI schema-validation gate.

Bug fixes in `@ark/sanitize` (carried over from the pre-TypeScript implementation):

- Global (`*`) preflight hooks no longer run twice when no provider is set.
- Transforms no longer mutate caller-supplied blocks (merge is now copy-on-write).
- Combining markdown link + image stripping now removes images fully (was `!alt`).
- `maxTextLength` truncates on UTF-16 boundaries and never emits a lone surrogate.

And in `@ark/policy`: `retryDirective` no longer yields `NaN` when `baseDelayMs`
is `0` and the backoff term overflows.
