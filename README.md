# Agent Reliability Kit (ARK)

[![CI](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/MosslandOpenDevs/agent-reliability-kit/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-ESM-blue)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Agent Reliability Kit (ARK)** is a reliability layer for AI agent products.
It helps teams prevent silent failures, reduce noisy alerts, and turn runtime incidents into actionable operational signals.

## Vision

AI agents are moving from demos to production systems, but reliability practices are still fragmented.
ARK exists to make agent reliability **predictable, observable, and automatable**.

Our long-term vision is to become the standard reliability substrate for agent applications, similar to what structured logging and APM did for web services.

## Problem Statement

Modern agent systems fail in ways that are hard to diagnose quickly:

- provider request payload mismatches
- fragile branch/skip/retry state transitions
- repeated runtime noise that looks like incidents
- poor incident taxonomy in logs and alerts
- high MTTR due to missing context at failure time

Most teams currently patch these problems ad hoc per repository.
ARK centralizes those patterns into reusable primitives.

## Goals

### Primary goals

1. **Reliability by default**  
   Provide safe defaults for sanitization, classification, and policy-driven recovery.

2. **Operational clarity**  
   Convert raw runtime events into clear incident reasons, risk tiers, and remediation hints.

3. **Automation-first outputs**  
   Emit machine-readable artifacts for CI/CD, monitoring, and postmortem workflows.

4. **Low-friction adoption**  
   Integrate incrementally with existing agent products without forcing architecture rewrites.

### Non-goals (for now)

- replacing existing APM/logging stacks
- abstracting every provider-specific edge case in v1
- acting as a full workflow orchestrator

## Product Philosophy

ARK follows five strict principles:

1. **Determinism over magic**  
   Reliability decisions must be inspectable and reproducible.

2. **Fail loud, but with guidance**  
   Every hard failure should include precise reason and next action.

3. **Noise suppression without blindness**  
   Stale and low-signal events are filtered, but true burst behavior is surfaced early.

4. **Composable by design**  
   Teams can adopt only what they need: sanitize, classify, policy, report.

5. **Human + machine symmetry**  
   Every incident has both concise human summary and structured JSON output.

## Core Modules

- [`@ark/core`](packages/core) — shared runtime-event contracts, incident types, OpenTelemetry GenAI mapping
- [`@ark/sanitize`](packages/sanitize) — request payload normalization and preflight cleanup
- [`@ark/classify`](packages/classify) — incident reason taxonomy, risk tiering, and confidence scoring
- [`@ark/policy`](packages/policy) — retry/fallback/fail-fast policy engine
- [`@ark/report`](packages/report) — human-readable summaries + JSON artifacts

All modules are TypeScript, ESM-only, and compose independently.

## Quickstart

```bash
pnpm add @ark/classify @ark/policy @ark/report
```

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

## Input Model (v1)

ARK consumes runtime events with standardized fields:

- session and turn metadata
- provider/model context
- request/response envelope
- error payload and stack hints
- recent-window context for burst/noise detection

## Output Model (v1)

ARK produces:

- immediate runtime actions (sanitize/retry/fallback/fail-fast)
- incident classification (`incidentReason`, `riskTier`, `confidence`)
- remediation guidance
- JSON artifacts for automation pipelines

## Initial Target Users

- AI product teams shipping agent features
- OSS maintainers handling agent-runtime bug reports
- platform/ops teams responsible for production incident hygiene

## Roadmap

### Phase 1 — Foundation

- event schema definition
- sanitizer primitives
- baseline incident taxonomy
- JSON report generator

### Phase 2 — Runtime Policies

- retry/fallback policy DSL
- burst and stale-noise gates
- risk-tier scoring rules

### Phase 3 — Integrations

- GitHub Actions incident report formatter
- dashboard-ready summary exports
- trend comparison between release windows

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

```
packages/
  core/       shared types, taxonomy, OTel GenAI mapping
  sanitize/   payload normalization + preflight
  classify/   incident classification
  policy/     recovery decision engine
  report/     human + machine incident artifacts
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

Requires Node.js ≥ 22 (24 LTS recommended). See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Status

Phase 1 (foundation) and the core reliability pipeline are implemented:
`@ark/core`, `@ark/sanitize`, `@ark/classify`, `@ark/policy`, `@ark/report`, the
runtime-event schema v2, and an MCP integration example. See the
[roadmap](#roadmap) for what's next.

---

If you are building agent products and want reliability to be a product capability (not an afterthought), ARK is for you.
