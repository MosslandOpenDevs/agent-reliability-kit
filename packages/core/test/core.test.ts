import assert from "node:assert/strict";
import test from "node:test";

import {
  clampConfidence,
  INCIDENT_REASONS,
  isIncidentReason,
  isRiskTier,
  RISK_TIERS,
  type RuntimeEvent,
  riskTierRank,
  SCHEMA_VERSION,
  toGenAIAttributes,
} from "../src/index.ts";

test("enumerations expose the documented taxonomy and tiers", () => {
  assert.deepEqual([...INCIDENT_REASONS].sort(), [
    "auth_error",
    "payload_invalid",
    "rate_limit",
    "runtime_noise",
    "state_drift",
    "unknown",
  ]);
  assert.deepEqual([...RISK_TIERS], ["none", "low", "moderate", "high"]);
  assert.equal(SCHEMA_VERSION, "2.0.0");
});

test("type guards accept known values and reject the rest", () => {
  assert.equal(isIncidentReason("rate_limit"), true);
  assert.equal(isIncidentReason("nope"), false);
  assert.equal(isIncidentReason(42), false);
  assert.equal(isRiskTier("moderate"), true);
  assert.equal(isRiskTier("critical"), false);
});

test("riskTierRank orders tiers by severity", () => {
  assert.equal(riskTierRank("none"), 0);
  assert.ok(riskTierRank("high") > riskTierRank("low"));
});

test("clampConfidence keeps values within [0, 1]", () => {
  assert.equal(clampConfidence(-1), 0);
  assert.equal(clampConfidence(2), 1);
  assert.equal(clampConfidence(0.42), 0.42);
  assert.equal(clampConfidence(Number.NaN), 0);
});

test("toGenAIAttributes maps to OTel GenAI semantic conventions", () => {
  const event: RuntimeEvent = {
    timestamp: "2026-07-13T00:00:00.000Z",
    app: "checkout-agent",
    phase: "error",
    provider: "anthropic",
    operation: "chat",
    model: "claude-sonnet-5",
    responseModel: "claude-sonnet-5-20260101",
    usage: { inputTokens: 1200, outputTokens: 340 },
    error: { type: "RateLimitError", status: 429 },
  };

  assert.deepEqual(toGenAIAttributes(event), {
    "gen_ai.provider.name": "anthropic",
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": "claude-sonnet-5",
    "gen_ai.response.model": "claude-sonnet-5-20260101",
    "gen_ai.usage.input_tokens": 1200,
    "gen_ai.usage.output_tokens": 340,
    "error.type": "RateLimitError",
  });
});

test("toGenAIAttributes omits absent fields and never emits gen_ai.system", () => {
  const attributes = toGenAIAttributes({
    timestamp: "2026-07-13T00:00:00.000Z",
    app: "svc",
    phase: "pre_request",
  });

  assert.deepEqual(attributes, {});
  assert.equal("gen_ai.system" in attributes, false);
});
