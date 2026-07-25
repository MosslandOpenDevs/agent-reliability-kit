/**
 * Runnable end-to-end example for the Agent Reliability Kit.
 *
 * One runtime failure walked through the whole pipeline:
 *
 *   sanitize -> classify -> policy -> report
 *
 * Everything here is deterministic (fixed timestamps, no clock reads), so the
 * output is stable across runs. From the repo root:
 *
 *   pnpm install
 *   pnpm demo
 */

import { classifyEvent } from "@ark/classify";
import type { RuntimeEvent } from "@ark/core";
import { evaluatePolicy } from "@ark/policy";
import { buildIncidentReport, formatHumanSummary } from "@ark/report";
import { runPreflightGuards } from "@ark/sanitize";

// 1. sanitize — clean a messy request payload before it leaves the process:
//    HTML tags stripped, extra whitespace collapsed, the empty message dropped.
const sanitized = runPreflightGuards(
  {
    messages: [
      { role: "user", content: "  Refund <b>order #1234</b>   please   " },
      { role: "user", content: "   " },
    ],
  },
  { provider: "openai", stripHtmlTags: true, collapseMergedWhitespace: true },
);
console.log("1) sanitize  →", JSON.stringify(sanitized.messages));

// 2. classify — map a runtime failure onto the incident taxonomy (deterministic).
const event: RuntimeEvent = {
  timestamp: "2026-07-25T00:00:00.000Z",
  app: "checkout-agent",
  phase: "error",
  provider: "openai",
  error: { type: "RateLimitError", status: 429 },
};
const classification = classifyEvent(event);
console.log(
  "2) classify  →",
  `${classification.incidentReason} / ${classification.riskTier} / ${classification.confidence}`,
);

// 3. policy — turn the classification into a concrete recovery action.
const decision = evaluatePolicy(classification, { attempt: 0 });
console.log("3) policy    →", `${decision.action} ${JSON.stringify(decision.retry)}`);

// 4. report — one-line human summary plus a stable JSON artifact for automation.
const report = buildIncidentReport(classification, decision, { generatedAt: event.timestamp });
console.log("4) report    →", formatHumanSummary(report));
console.log(`\nJSON artifact:\n${JSON.stringify(report, null, 2)}`);
