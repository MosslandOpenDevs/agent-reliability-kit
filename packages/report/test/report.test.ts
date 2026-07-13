import assert from "node:assert/strict";
import test from "node:test";

import type { Classification, PolicyDecision } from "@ark/core";
import { buildIncidentReport, formatHumanSummary } from "../src/index.ts";

const rateLimit: Classification = {
  incidentReason: "rate_limit",
  riskTier: "low",
  confidence: 0.9,
  signals: ["http_status:429"],
};

const retryDecision: PolicyDecision = {
  action: "retry",
  reason: "rate_limit — retry with exponential backoff",
  retry: { attempt: 1, maxRetries: 3, delayMs: 500 },
  trace: [{ rule: "retry_with_backoff", matched: true }],
};

test("produces a stable machine-readable artifact (snapshot)", () => {
  const report = buildIncidentReport(rateLimit, retryDecision);
  assert.deepEqual(report, {
    incidentReason: "rate_limit",
    riskTier: "low",
    confidence: 0.9,
    recommendedActions: ["Retry the request using the provided backoff delay."],
    summary: "[low] rate_limit — retry with backoff (attempt 1/3, 500ms)",
    action: "retry",
    schemaVersion: "2.0.0",
  });
});

test("field naming is the documented, backward-compatible set", () => {
  const report = buildIncidentReport(rateLimit, retryDecision);
  assert.deepEqual(Object.keys(report).sort(), [
    "action",
    "confidence",
    "incidentReason",
    "recommendedActions",
    "riskTier",
    "schemaVersion",
    "summary",
  ]);
});

test("generatedAt is injected only when provided (snapshot-stable by default)", () => {
  const without = buildIncidentReport(rateLimit, retryDecision);
  assert.equal("generatedAt" in without, false);

  const withTs = buildIncidentReport(rateLimit, retryDecision, {
    generatedAt: "2026-07-13T00:00:00.000Z",
  });
  assert.equal(withTs.generatedAt, "2026-07-13T00:00:00.000Z");
});

test("recommended actions are reason-specific for fail-fast incidents", () => {
  const auth: Classification = {
    incidentReason: "auth_error",
    riskTier: "high",
    confidence: 0.9,
    signals: [],
  };
  const failFast: PolicyDecision = {
    action: "fail_fast",
    reason: "auth_error is not recoverable automatically",
    trace: [],
  };
  const report = buildIncidentReport(auth, failFast);
  assert.deepEqual(report.recommendedActions, [
    "Verify and rotate provider API credentials.",
    "Halt retries until credentials are fixed.",
  ]);
});

test("formatHumanSummary renders a one-line operator string", () => {
  const report = buildIncidentReport(rateLimit, retryDecision);
  assert.equal(
    formatHumanSummary(report),
    "[low] rate_limit — retry with backoff (attempt 1/3, 500ms) · confidence 90%",
  );
});

test("reporting is deterministic", () => {
  assert.deepEqual(
    buildIncidentReport(rateLimit, retryDecision),
    buildIncidentReport(rateLimit, retryDecision),
  );
});
