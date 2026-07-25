# Agent Reliability Kit (ARK)

[![CI](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Agent Reliability Kit (ARK)** is a reliability layer for AI agent runtimes.
It helps teams prevent silent failures, reduce noisy alerts, and turn runtime incidents into actionable operational signals.

> **Status — reference implementation / idea repo.** The full pipeline is
> implemented and test-backed, meant to be read, run, and adapted. It is *not*
> a maintained product: it is not published to npm, and product-scale work
> (framework adapters, dashboards, a release cadence) is deliberately
> [out of scope](#status--scope).

## Why ARK

AI agents are moving from demos to production, but reliability practices are still fragmented. Modern agent systems fail in ways that are hard to diagnose quickly:

- provider request payload mismatches
- fragile branch/skip/retry state transitions
- repeated runtime noise that looks like incidents
- poor incident taxonomy in logs and alerts
- high MTTR due to missing context at failure time

Most teams patch these ad hoc per repository. ARK centralizes the patterns into reusable primitives — a sketch of what a reliability layer for agent runtimes could look like, the way structured logging and APM did for web services.

## Core Modules

- [`@ark/core`](packages/core) — shared runtime-event contracts, incident types, OpenTelemetry GenAI mapping
- [`@ark/sanitize`](packages/sanitize) — request payload normalization and preflight cleanup
- [`@ark/classify`](packages/classify) — incident reason taxonomy, risk tiering, and confidence scoring
- [`@ark/policy`](packages/policy) — retry/fallback/fail-fast policy engine
- [`@ark/report`](packages/report) — human-readable summaries + JSON artifacts

All modules are TypeScript, ESM-only, and compose independently.

## Quickstart

> **Not published to npm** — this is a reference implementation. Use the
> `@ark/*` packages from a checkout of this repo (they are pnpm workspaces).
> For a version you can run as-is, see the [runnable example](examples/pipeline).

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

[`examples/pipeline`](examples/pipeline) runs this exact flow end-to-end from a
checkout (`sanitize → classify → policy → report`). See
[`examples/mcp-server`](examples/mcp-server) to expose the same pipeline as
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

### Non-goals

- replacing existing APM/logging stacks
- abstracting every provider-specific edge case
- acting as a full workflow orchestrator

## Who might find it useful

- AI product teams shipping agent features
- OSS maintainers handling agent-runtime bug reports
- platform/ops teams responsible for production incident hygiene

## Status & scope

A **reference implementation**: the reliability pipeline is complete and
test-backed, meant to be read, run, and adapted rather than shipped as a product.

**Implemented (concept-complete):**

- runtime-event schema v2, aligned with the OpenTelemetry GenAI conventions
- `@ark/sanitize` — payload normalization + preflight guards
- `@ark/classify` — deterministic incident taxonomy, risk tiers, confidence, and the burst gate
- `@ark/policy` — retry/fallback/fail-fast engine with decision traces
- `@ark/report` — human summary + JSON incident artifact
- a runnable end-to-end example and an MCP integration example

**The ideas it means to demonstrate:**

- suppressing false-positive alert volume and repeated provider-4xx noise
- faster incident triage (MTTR) and more reproducible bug reports across teams

**Out of scope — deliberately, to keep this a focused idea repo:**

- publishing to npm or maintaining a release cadence
- adapters for specific agent frameworks, dashboards, or trend analytics
- a time-based stale-noise gate (the burst gate already demonstrates the idea)
- a runtime-failure **conformance** kit (`ark probe`, evidence-based rules) — the
  assurance direction lives in the sibling [Agentic Assurance Profile](https://github.com/MosslandOpenDevs/agentic-assurance-profile)

## Repository layout

```text
packages/     core, sanitize, classify, policy, report (see Core Modules)
schemas/      runtime-event JSON Schema (+ examples, validated in CI)
examples/     runnable examples (end-to-end pipeline, MCP server)
docs/         architecture and integration notes
```

## Development

TypeScript, ESM-only, [pnpm](https://pnpm.io) workspaces. Built with
[tsdown](https://tsdown.dev), linted/formatted with [Biome](https://biomejs.dev),
tested with the built-in `node:test` runner, versioned with
[Changesets](https://github.com/changesets/changesets).

```bash
pnpm install
pnpm check      # typecheck + lint + schema:validate + test
```

Requires Node.js ≥ 22 (24 LTS recommended). See [CONTRIBUTING.md](./CONTRIBUTING.md)
and the [architecture notes](docs/ARCHITECTURE.md).
