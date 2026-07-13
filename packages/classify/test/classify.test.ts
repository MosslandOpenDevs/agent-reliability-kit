import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeEvent } from "@ark/core";
import { classifyEvent } from "../src/index.ts";

function eventWith(error: RuntimeEvent["error"], extra: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    timestamp: "2026-07-13T00:00:00.000Z",
    app: "test-agent",
    phase: "error",
    error,
    ...extra,
  };
}

test("maps unambiguous HTTP status codes to reasons with strong confidence", () => {
  const cases: Array<[number, string]> = [
    [401, "auth_error"],
    [403, "auth_error"],
    [400, "payload_invalid"],
    [422, "payload_invalid"],
    [429, "rate_limit"],
    [409, "state_drift"],
    [500, "runtime_noise"],
    [503, "runtime_noise"],
  ];

  for (const [status, reason] of cases) {
    const result = classifyEvent(eventWith({ status }));
    assert.equal(result.incidentReason, reason, `status ${status}`);
    assert.ok(result.confidence > 0, `status ${status} confidence`);
  }
});

test("falls back to keyword heuristics when no status is present", () => {
  assert.equal(
    classifyEvent(eventWith({ message: "Invalid API key provided" })).incidentReason,
    "auth_error",
  );
  assert.equal(
    classifyEvent(eventWith({ message: "You are being rate limited" })).incidentReason,
    "rate_limit",
  );
  assert.equal(
    classifyEvent(eventWith({ message: "schema validation failed" })).incidentReason,
    "payload_invalid",
  );
  assert.equal(
    classifyEvent(eventWith({ code: "version_mismatch" })).incidentReason,
    "state_drift",
  );
  assert.equal(classifyEvent(eventWith({ type: "ETIMEDOUT" })).incidentReason, "runtime_noise");
});

test("unknown errors fall back to the safe default classification", () => {
  const result = classifyEvent(eventWith({ message: "something entirely novel" }));
  assert.equal(result.incidentReason, "unknown");
  assert.equal(result.riskTier, "moderate");
  assert.ok(result.confidence <= 0.3);
});

test("healthy non-error observations are not incidents", () => {
  const result = classifyEvent({
    timestamp: "2026-07-13T00:00:00.000Z",
    app: "test-agent",
    phase: "post_response",
  });
  assert.equal(result.incidentReason, "unknown");
  assert.equal(result.riskTier, "none");
});

test("runtime noise is suppressed unless a burst is detected", () => {
  const single = classifyEvent(eventWith({ status: 503 }));
  assert.equal(single.riskTier, "none");
  assert.ok(single.signals.includes("suppressed_noise"));

  const burst = classifyEvent(
    eventWith(
      { status: 503 },
      {
        recentWindow: [
          { timestamp: "t1", phase: "error", error: { status: 503 } },
          { timestamp: "t2", phase: "error", error: { status: 503 } },
          { timestamp: "t3", phase: "error", error: { status: 503 } },
        ],
      },
    ),
  );
  assert.equal(burst.riskTier, "moderate");
  assert.ok(burst.signals.some((s) => s.startsWith("burst:")));
});

test("classification is deterministic across repeated calls", () => {
  const event = eventWith({ status: 429, code: "rate_limit_exceeded" });
  assert.deepEqual(classifyEvent(event), classifyEvent(event));
});

test("output contract shape is stable", () => {
  const result = classifyEvent(eventWith({ status: 401 }));
  assert.deepEqual(result, {
    incidentReason: "auth_error",
    riskTier: "high",
    confidence: 0.9,
    signals: ["http_status:401"],
  });
});
