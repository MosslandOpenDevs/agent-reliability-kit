/**
 * @ark/classify — map runtime events onto a stable incident taxonomy.
 *
 * The classifier is deterministic: the same event always yields the same
 * `{ incidentReason, riskTier, confidence, signals }`. Unknown or unrecognized
 * failures fall back to a safe default (`unknown`) rather than throwing.
 */

import type {
  Classification,
  IncidentReason,
  RiskTier,
  RuntimeError,
  RuntimeEvent,
} from "@ark/core";
import { clampConfidence } from "@ark/core";

/** Options for {@link classifyEvent}. */
export interface ClassifyOptions {
  /**
   * Number of recent error events at or above which repetition is treated as a
   * burst (a real incident emerging from the noise floor). Default `3`.
   */
  burstThreshold?: number;
}

interface ReasonMatch {
  reason: IncidentReason;
  confidence: number;
  signal: string;
}

/** Confidence for an unambiguous signal (e.g. an HTTP status code). */
const CONFIDENCE_STRONG = 0.9;
/** Confidence for a keyword/heuristic match. */
const CONFIDENCE_MEDIUM = 0.6;
/** Confidence for the `unknown` fallback. */
const CONFIDENCE_WEAK = 0.2;

const DEFAULT_BURST_THRESHOLD = 3;

/** Baseline risk tier per incident reason, before burst adjustment. */
const BASE_RISK: Record<IncidentReason, RiskTier> = {
  auth_error: "high",
  state_drift: "high",
  payload_invalid: "moderate",
  rate_limit: "low",
  runtime_noise: "none",
  unknown: "moderate",
};

function errorHaystack(error: RuntimeError | undefined): string {
  if (!error) {
    return "";
  }
  return (
    [error.type, error.code, error.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase()
      // Normalize snake_case / kebab-case codes so "api_key" and "version-mismatch"
      // match the same space-delimited patterns as their prose equivalents.
      .replace(/[_-]+/g, " ")
  );
}

const KEYWORD_RULES: ReadonlyArray<{ reason: IncidentReason; pattern: RegExp }> = [
  {
    reason: "auth_error",
    pattern: /(unauthori|forbidden|api ?key|permission denied|invalid token|credential)/,
  },
  { reason: "rate_limit", pattern: /(rate ?limit|throttl|quota|too many request|overloaded)/ },
  {
    reason: "payload_invalid",
    pattern:
      /(invalid|validation|malformed|unprocessable|schema|bad request|missing (required )?(field|parameter|argument))/,
  },
  {
    reason: "state_drift",
    pattern: /(conflict|drift|out of sync|inconsistent|version mismatch|mismatch|stale)/,
  },
  {
    reason: "runtime_noise",
    pattern:
      /(timeout|etimedout|econnreset|econnrefused|socket hang up|network error|temporarily unavailable|service unavailable|transient)/,
  },
];

function detectReason(event: RuntimeEvent): ReasonMatch {
  const error = event.error;
  const status = typeof error?.status === "number" ? error.status : undefined;

  // Unambiguous HTTP status codes take priority.
  if (status === 401 || status === 403) {
    return { reason: "auth_error", confidence: CONFIDENCE_STRONG, signal: `http_status:${status}` };
  }
  if (status === 400 || status === 422) {
    return {
      reason: "payload_invalid",
      confidence: CONFIDENCE_STRONG,
      signal: `http_status:${status}`,
    };
  }
  if (status === 429) {
    return { reason: "rate_limit", confidence: CONFIDENCE_STRONG, signal: "http_status:429" };
  }
  if (status === 409) {
    return { reason: "state_drift", confidence: CONFIDENCE_STRONG, signal: "http_status:409" };
  }
  if (typeof status === "number" && status >= 500) {
    return {
      reason: "runtime_noise",
      confidence: CONFIDENCE_MEDIUM,
      signal: `http_status:${status}`,
    };
  }

  // Keyword heuristics over the error text.
  const haystack = errorHaystack(error);
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(haystack)) {
      return {
        reason: rule.reason,
        confidence: CONFIDENCE_MEDIUM,
        signal: `keyword:${rule.reason}`,
      };
    }
  }

  return { reason: "unknown", confidence: CONFIDENCE_WEAK, signal: "no_match" };
}

function countBurst(event: RuntimeEvent): number {
  const window = event.recentWindow;
  if (!Array.isArray(window)) {
    return 0;
  }
  return window.filter((entry) => entry?.phase === "error" || entry?.error !== undefined).length;
}

/**
 * Classify a single runtime event.
 *
 * Determinism: no randomness or wall-clock reads; identical input yields
 * identical output. `runtime_noise` is suppressed to `none` risk unless the
 * recent window shows a burst, which escalates it to `moderate`.
 */
export function classifyEvent(event: RuntimeEvent, options: ClassifyOptions = {}): Classification {
  const burstThreshold =
    Number.isInteger(options.burstThreshold) && (options.burstThreshold as number) > 0
      ? Number(options.burstThreshold)
      : DEFAULT_BURST_THRESHOLD;

  const match = detectReason(event);
  const signals: string[] = [match.signal];

  const reason = match.reason;
  let confidence = match.confidence;
  let riskTier = BASE_RISK[reason];

  const burstCount = countBurst(event);
  const isBurst = burstCount >= burstThreshold;

  if (reason === "runtime_noise") {
    if (isBurst) {
      riskTier = "moderate";
      confidence = Math.max(confidence, 0.7);
      signals.push(`burst:${burstCount}`);
    } else {
      signals.push("suppressed_noise");
    }
  } else if (isBurst) {
    signals.push(`burst:${burstCount}`);
    confidence = confidence + 0.05;
    if (riskTier === "low") {
      riskTier = "moderate";
    }
  }

  // A non-error observation that matched nothing is healthy, not an incident.
  // An explicit error-phase event stays at the `unknown` baseline risk even
  // when the producer could not supply a normalized error payload.
  if (event.error === undefined && reason === "unknown") {
    signals.push(`phase:${event.phase}`);
    if (event.phase !== "error") {
      riskTier = "none";
    }
  }

  return {
    incidentReason: reason,
    riskTier,
    confidence: clampConfidence(confidence),
    signals,
  };
}
