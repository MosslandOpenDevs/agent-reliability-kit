# Agent Reliability Kit (ARK)

[![CI](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Agent Reliability Kit (ARK)** is a reliability layer for AI agent products.
It helps teams prevent silent failures, reduce noisy alerts, and turn runtime incidents into actionable operational signals.

## Why ARK

AI agents are moving from demos to production, but reliability practices are still fragmented. Modern agent systems fail in ways that are hard to diagnose quickly:

- provider request payload mismatches
- fragile branch/skip/retry state transitions
- repeated runtime noise that looks like incidents
- poor incident taxonomy in logs and alerts
- high MTTR due to missing context at failure time

Most teams patch these ad hoc per repository. ARK centralizes the patterns into reusable primitives — aiming to be for agent reliability what structured logging and APM became for web services.

## Core Modules

- [`@ark/core`](packages/core) — shared runtime-event contracts, incident types, OpenTelemetry GenAI mapping
- [`@ark/sanitize`](packages/sanitize) — request payload normalization and preflight cleanup
- [`@ark/classify`](packages/classify) — incident reason taxonomy, risk tiering, and confidence scoring
- [`@ark/policy`](packages/policy) — retry/fallback/fail-fast policy engine
- [`@ark/report`](packages/report) — human-readable summaries + JSON artifacts

All modules are TypeScript, ESM-only, and compose independently.

## Quickstart

> **Not yet published to npm.** Until the first release, use the `@ark/*`
> packages from a checkout of this repo (they are pnpm workspaces). After the
> first release: `pnpm add @ark/classify @ark/policy @ark/report`.

```ts
import { classifyEvent } from "@ark/classify";
import { evaluatePolicy } from "@ark/policy";
import { buildIncidentReport, formatHumanSummary } from "@ark/report";

const event = {
  timestamp: new Date().toISOString(),
  app: "checkout-agent",
  phase: "error" as const,
  provider: "openai",
  error: { type: "RateLimitError", status: 429 },
};

const classification = classifyEvent(event);            // → rate_limit / low / 0.9
const decision = evaluatePolicy(classification, { attempt: 0 }); // → retry, 500ms backoff
const report = buildIncidentReport(classification, decision);

console.log(formatHumanSummary(report));
// [low] rate_limit — retry with backoff (attempt 1/3, 500ms) · confidence 90%
```

See [`examples/mcp-server`](examples/mcp-server) to expose the same pipeline as
[Model Context Protocol](docs/MCP.md) tools.

## Input Model

ARK consumes runtime events with standardized fields (see the
[runtime-event schema](schemas/runtime-event.v2.json), v2):

- session and turn metadata
- provider/model context
- request/response envelope
- error payload
- recent-window context for burst/noise detection

## Output Model

ARK produces:

- immediate runtime actions (sanitize/retry/fallback/fail-fast)
- incident classification (`incidentReason`, `riskTier`, `confidence`)
- remediation guidance
- a concise human summary plus structured JSON artifacts for automation pipelines

## Where ARK fits

ARK operates at **runtime**: it decides how a live agent recovers from a
failure and turns each incident into a structured signal. That is a different
layer from the [Agentic Assurance Profile (AAP)](https://github.com/MosslandOpenDevs/agentic-assurance-profile)
— a repository-level profile for governing whether an AI-agent-built project's
claims, invariants, and evidence still hold as the code changes. The two
compose rather than compete: you **run** ARK as a reliability substrate and
**adopt** AAP as an assurance profile — under which ARK's deterministic policies
and JSON incident artifacts can serve as runtime evidence.

## Design principles

- **Deterministic, not magic** — reliability decisions are inspectable and reproducible, built on safe defaults for sanitize, classify, and policy.
- **Fail loud, with guidance** — every hard failure carries a precise reason, risk tier, and next action.
- **Suppress noise without going blind** — low-signal events are damped while true burst behavior is surfaced early.
- **Composable and incremental** — adopt only what you need; integrate without an architecture rewrite.
- **Automation-first outputs** — machine-readable artifacts for CI/CD, monitoring, and postmortem workflows.

### Non-goals (for now)

- replacing existing APM/logging stacks
- abstracting every provider-specific edge case in v1
- acting as a full workflow orchestrator

## Initial Target Users

- AI product teams shipping agent features
- OSS maintainers handling agent-runtime bug reports
- platform/ops teams responsible for production incident hygiene

## Roadmap

### Phase 1 — Foundation ✅

- [x] event schema definition (runtime-event v2)
- [x] sanitizer primitives
- [x] baseline incident taxonomy
- [x] JSON report generator

### Phase 2 — Runtime Policies (in progress)

- [x] retry/fallback/fail-fast decision engine
- [x] risk-tier scoring rules
- [x] burst gate — _stale-noise (time-based) gate still pending_

### Phase 3 — Integrations (planned)

- [x] MCP server example
- [ ] GitHub Actions incident report formatter
- [ ] dashboard-ready summary exports
- [ ] trend comparison between release windows

### Under exploration — Runtime Failure Conformance

A complementary direction: treat ARK as a local, deterministic **conformance
kit** that verifies, from portable traces and injected failures, that an agent
runtime honors retry, idempotency, deadline, tool-result, and privacy contracts.
This would add a cross-span **rules** layer (evidence-based invariants) and an
`ark probe` fault injector (429 + `Retry-After`, timeouts, stream aborts, ACK
loss, duplicate tool calls) on top of the current primitives. Tracked as a
research track, not yet committed scope.

## Success Metrics

ARK should create measurable outcomes:

- lower provider 4xx repeat rates
- lower false-positive alert volume
- faster incident triage (MTTR reduction)
- higher reproducibility of bug reports across teams

## Repository layout

```text
packages/     core, sanitize, classify, policy, report (see Core Modules)
schemas/      runtime-event JSON Schema (+ examples, validated in CI)
examples/     runnable integrations (MCP server)
docs/         architecture and integration notes
```

## Development

TypeScript, ESM-only, [pnpm](https://pnpm.io) workspaces. Built with
[tsdown](https://tsdown.dev), linted/formatted with [Biome](https://biomejs.dev),
tested with the built-in `node:test` runner, released with
[Changesets](https://github.com/changesets/changesets).

```bash
pnpm install
pnpm check      # typecheck + lint + schema:validate + test
```

Requires Node.js ≥ 22 (24 LTS recommended). See [CONTRIBUTING.md](./CONTRIBUTING.md)
and the [architecture notes](docs/ARCHITECTURE.md).
