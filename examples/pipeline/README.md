# Example: end-to-end pipeline

Runs one runtime failure through the whole Agent Reliability Kit pipeline —
`sanitize → classify → policy → report` — and prints the human summary plus the
JSON incident artifact. Everything is deterministic (fixed timestamps, no clock
reads), so the output is stable across runs.

## Run it

From the repository root:

```bash
pnpm install
pnpm demo
```

`pnpm demo` builds the `@ark/*` packages and then runs
[`src/index.ts`](src/index.ts) with Node's built-in TypeScript support.

## Expected output

```text
1) sanitize  → [{"role":"user","content":[{"type":"text","text":"Refund order #1234 please"}]}]
2) classify  → rate_limit / low / 0.9
3) policy    → retry {"attempt":1,"maxRetries":3,"delayMs":500}
4) report    → [low] rate_limit — retry with backoff (attempt 1/3, 500ms) · confidence 90%

JSON artifact:
{
  "incidentReason": "rate_limit",
  "riskTier": "low",
  "confidence": 0.9,
  "recommendedActions": [
    "Retry the request using the provided backoff delay."
  ],
  "summary": "[low] rate_limit — retry with backoff (attempt 1/3, 500ms)",
  "action": "retry",
  "schemaVersion": "2.0.0",
  "generatedAt": "2026-07-25T00:00:00.000Z"
}
```
