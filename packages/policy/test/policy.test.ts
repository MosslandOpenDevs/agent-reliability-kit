import assert from "node:assert/strict";
import test from "node:test";

import type { Classification, IncidentReason, RiskTier } from "@ark/core";
import { evaluatePolicy } from "../src/index.ts";

function classification(
  incidentReason: IncidentReason,
  riskTier: RiskTier,
  confidence = 0.9,
): Classification {
  return { incidentReason, riskTier, confidence, signals: [] };
}

test("non-recoverable incidents fail fast without a retry directive", () => {
  for (const reason of ["auth_error", "state_drift"] as const) {
    const decision = evaluatePolicy(classification(reason, "high"));
    assert.equal(decision.action, "fail_fast");
    assert.equal(decision.retry, undefined);
    assert.ok(decision.trace.some((t) => t.rule === "non_recoverable" && t.matched));
  }
});

test("risk tier none is a noop", () => {
  const decision = evaluatePolicy(classification("runtime_noise", "none"));
  assert.equal(decision.action, "noop");
});

test("payload_invalid recommends sanitize while retries remain, then fails fast", () => {
  const first = evaluatePolicy(classification("payload_invalid", "moderate"), { attempt: 0 });
  assert.equal(first.action, "sanitize");
  assert.equal(first.retry?.attempt, 1);

  const exhausted = evaluatePolicy(classification("payload_invalid", "moderate"), { attempt: 3 });
  assert.equal(exhausted.action, "fail_fast");
});

test("rate_limit retries with deterministic exponential backoff", () => {
  const cfg = { maxRetries: 3, baseDelayMs: 500, backoffFactor: 2 };
  const delays = [0, 1, 2].map(
    (attempt) =>
      evaluatePolicy(classification("rate_limit", "low"), { attempt }, cfg).retry?.delayMs,
  );
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test("backoff is capped at maxDelayMs", () => {
  const decision = evaluatePolicy(
    classification("rate_limit", "low"),
    { attempt: 10 },
    { maxRetries: 20, baseDelayMs: 1000, backoffFactor: 2, maxDelayMs: 5000 },
  );
  assert.equal(decision.retry?.delayMs, 5000);
});

test("exhausted retries route to fallback when configured, else fail fast", () => {
  const withFallback = evaluatePolicy(
    classification("rate_limit", "low"),
    { attempt: 3 },
    { maxRetries: 3, fallback: { provider: "anthropic", model: "claude-haiku-4-5" } },
  );
  assert.equal(withFallback.action, "fallback");
  assert.deepEqual(withFallback.fallback, { provider: "anthropic", model: "claude-haiku-4-5" });

  const withoutFallback = evaluatePolicy(
    classification("rate_limit", "low"),
    { attempt: 3 },
    { maxRetries: 3 },
  );
  assert.equal(withoutFallback.action, "fail_fast");
});

test("unknown incidents retry at most once", () => {
  const first = evaluatePolicy(classification("unknown", "moderate"), { attempt: 0 });
  assert.equal(first.action, "retry");

  const second = evaluatePolicy(classification("unknown", "moderate"), { attempt: 1 });
  assert.equal(second.action, "fail_fast");
});

test("every decision carries an ordered trace and is deterministic", () => {
  const input = classification("rate_limit", "low");
  const a = evaluatePolicy(input, { attempt: 0 });
  const b = evaluatePolicy(input, { attempt: 0 });
  assert.deepEqual(a, b);
  assert.ok(Array.isArray(a.trace) && a.trace.length > 0);
});

test("retryDirective never yields NaN when baseDelayMs is 0 and backoff overflows", () => {
  const decision = evaluatePolicy(
    classification("rate_limit", "low"),
    { attempt: 2 },
    { baseDelayMs: 0, backoffFactor: 1e300, maxRetries: 5 },
  );
  assert.equal(decision.action, "retry");
  assert.equal(decision.retry?.delayMs, 0);
  assert.equal(Number.isNaN(decision.retry?.delayMs), false);
});
