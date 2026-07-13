/**
 * @ark/report — dual-output reporting for operators and automation.
 *
 * `buildIncidentReport` produces a stable machine-readable artifact; the same
 * artifact carries a one-line human `summary`. `formatHumanSummary` renders it
 * for logs/alerts. Output is deterministic (timestamps are injected, never read
 * from the clock) so it is safe to snapshot in CI.
 */

import type { Classification, FallbackDirective, IncidentReport, PolicyDecision } from "@ark/core";
import { SCHEMA_VERSION } from "@ark/core";

/** Options for {@link buildIncidentReport}. */
export interface ReportOptions {
  /**
   * ISO-8601 timestamp to stamp on the report. Omitted from output entirely
   * when not provided, keeping reports snapshot-stable by default.
   */
  generatedAt?: string;
}

function formatRoute(fallback: FallbackDirective): string {
  const provider = fallback.provider ?? "?";
  const model = fallback.model ?? "?";
  return `${provider}/${model}`;
}

function actionHint(decision: PolicyDecision): string {
  switch (decision.action) {
    case "retry":
      return decision.retry
        ? `retry with backoff (attempt ${decision.retry.attempt}/${decision.retry.maxRetries}, ${decision.retry.delayMs}ms)`
        : "retry";
    case "sanitize":
      return "re-sanitize payload and retry";
    case "fallback":
      return decision.fallback
        ? `route to fallback ${formatRoute(decision.fallback)}`
        : "route to fallback";
    case "fail_fast":
      return "fail fast — manual intervention required";
    case "noop":
      return "no action required";
    default:
      return decision.action;
  }
}

function recommendActions(classification: Classification, decision: PolicyDecision): string[] {
  switch (decision.action) {
    case "retry":
      return ["Retry the request using the provided backoff delay."];
    case "sanitize":
      return [
        "Re-run @ark/sanitize preflight on the request payload.",
        "Retry the request after sanitization.",
      ];
    case "fallback":
      return ["Route the request to the configured fallback provider/model."];
    case "noop":
      return ["No action required; the event is within the normal noise floor."];
    case "fail_fast":
      switch (classification.incidentReason) {
        case "auth_error":
          return [
            "Verify and rotate provider API credentials.",
            "Halt retries until credentials are fixed.",
          ];
        case "state_drift":
          return [
            "Reconcile agent/session state before retrying.",
            "Escalate to on-call if drift persists.",
          ];
        case "payload_invalid":
          return [
            "Fix the request payload/schema at the source.",
            "Do not retry the identical payload.",
          ];
        default:
          return ["Escalate for manual triage."];
      }
    default:
      return ["Escalate for manual triage."];
  }
}

/**
 * Build a machine-readable incident artifact (which also embeds a one-line
 * human `summary`) from a classification and a policy decision.
 */
export function buildIncidentReport(
  classification: Classification,
  decision: PolicyDecision,
  options: ReportOptions = {},
): IncidentReport {
  const summary = `[${classification.riskTier}] ${classification.incidentReason} — ${actionHint(decision)}`;

  const report: IncidentReport = {
    incidentReason: classification.incidentReason,
    riskTier: classification.riskTier,
    confidence: classification.confidence,
    recommendedActions: recommendActions(classification, decision),
    summary,
    action: decision.action,
    schemaVersion: SCHEMA_VERSION,
  };

  if (typeof options.generatedAt === "string") {
    return { ...report, generatedAt: options.generatedAt };
  }
  return report;
}

/** Render a one-line human summary (reason + action hint + confidence). */
export function formatHumanSummary(report: IncidentReport): string {
  const confidencePct = Math.round(report.confidence * 100);
  return `${report.summary} · confidence ${confidencePct}%`;
}
