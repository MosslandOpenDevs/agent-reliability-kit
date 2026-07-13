/**
 * @ark/policy — turn a {@link Classification} into a concrete runtime action.
 *
 * Decisions are deterministic (no wall-clock, no randomness): exponential
 * backoff is computed purely from the attempt count and config. Every decision
 * carries a `trace` of the rules evaluated, for observability.
 */

import type {
  Classification,
  FallbackDirective,
  PolicyDecision,
  PolicyTraceEntry,
  RetryDirective,
} from "@ark/core";

/** Tunable retry/fallback configuration. */
export interface PolicyConfig {
  /** Maximum retry attempts before escalating. Default `3`. */
  maxRetries?: number;
  /** Base backoff delay in milliseconds. Default `500`. */
  baseDelayMs?: number;
  /** Exponential backoff multiplier. Default `2`. */
  backoffFactor?: number;
  /** Upper bound on any single backoff delay. Default `30000`. */
  maxDelayMs?: number;
  /** Provider/model to route to once retries are exhausted. */
  fallback?: FallbackDirective;
}

/** Per-evaluation runtime context. */
export interface PolicyContext {
  /** Attempts already made (0 = the first try just failed). Default `0`. */
  attempt?: number;
}

interface ResolvedConfig {
  maxRetries: number;
  baseDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  fallback: FallbackDirective | undefined;
}

const DEFAULTS: Omit<ResolvedConfig, "fallback"> = {
  maxRetries: 3,
  baseDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 30_000,
};

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveConfig(config: PolicyConfig): ResolvedConfig {
  return {
    maxRetries: Math.trunc(positiveNumber(config.maxRetries, DEFAULTS.maxRetries)),
    baseDelayMs: positiveNumber(config.baseDelayMs, DEFAULTS.baseDelayMs),
    backoffFactor: positiveNumber(config.backoffFactor, DEFAULTS.backoffFactor),
    maxDelayMs: positiveNumber(config.maxDelayMs, DEFAULTS.maxDelayMs),
    fallback: config.fallback,
  };
}

function retryDirective(attempt: number, maxRetries: number, cfg: ResolvedConfig): RetryDirective {
  // Guard the `0 * Infinity = NaN` case: when baseDelayMs is 0 the delay is 0
  // regardless of the (possibly overflowing) backoff term.
  const raw = cfg.baseDelayMs === 0 ? 0 : cfg.baseDelayMs * cfg.backoffFactor ** attempt;
  const delayMs = Math.round(Math.min(cfg.maxDelayMs, raw));
  return { attempt: attempt + 1, maxRetries, delayMs };
}

function failFast(reason: string, trace: PolicyTraceEntry[]): PolicyDecision {
  return { action: "fail_fast", reason, trace };
}

/**
 * Evaluate the recovery policy for a classification.
 *
 * Rule order:
 * 1. `auth_error` / `state_drift` → `fail_fast` (non-recoverable).
 * 2. risk tier `none` → `noop` (suppressed noise, nothing actionable).
 * 3. `payload_invalid` → `sanitize` (re-sanitize and retry) while attempts remain.
 * 4. `rate_limit` / `runtime_noise` / `unknown` → `retry` with backoff, then
 *    `fallback` (if configured), else `fail_fast`.
 */
export function evaluatePolicy(
  classification: Classification,
  context: PolicyContext = {},
  config: PolicyConfig = {},
): PolicyDecision {
  const cfg = resolveConfig(config);
  const attempt = Math.max(0, Math.trunc(positiveNumber(context.attempt, 0)));
  const reason = classification.incidentReason;
  const trace: PolicyTraceEntry[] = [];

  // 1. Non-recoverable incidents.
  if (reason === "auth_error" || reason === "state_drift") {
    trace.push({ rule: "non_recoverable", matched: true, detail: reason });
    return failFast(`${reason} is not recoverable automatically`, trace);
  }
  trace.push({ rule: "non_recoverable", matched: false });

  // 2. Nothing actionable.
  if (classification.riskTier === "none") {
    trace.push({ rule: "risk_none_noop", matched: true });
    return { action: "noop", reason: "risk tier none — no action required", trace };
  }
  trace.push({ rule: "risk_none_noop", matched: false });

  // 3. Invalid payloads: re-sanitize and retry.
  if (reason === "payload_invalid") {
    if (attempt < cfg.maxRetries) {
      trace.push({
        rule: "payload_invalid_sanitize",
        matched: true,
        detail: `attempt ${attempt + 1}`,
      });
      return {
        action: "sanitize",
        reason: "payload_invalid — re-sanitize payload and retry",
        retry: retryDirective(attempt, cfg.maxRetries, cfg),
        trace,
      };
    }
    trace.push({ rule: "payload_invalid_sanitize", matched: false, detail: "retries exhausted" });
    return failFast("payload_invalid persisted after retries", trace);
  }

  // 4. Transient / unknown: retry with backoff, then fallback, then fail fast.
  if (reason === "rate_limit" || reason === "runtime_noise" || reason === "unknown") {
    const cap = reason === "unknown" ? Math.min(1, cfg.maxRetries) : cfg.maxRetries;
    if (attempt < cap) {
      trace.push({
        rule: "retry_with_backoff",
        matched: true,
        detail: `attempt ${attempt + 1}/${cap}`,
      });
      return {
        action: "retry",
        reason: `${reason} — retry with exponential backoff`,
        retry: retryDirective(attempt, cap, cfg),
        trace,
      };
    }
    trace.push({ rule: "retry_with_backoff", matched: false, detail: "retries exhausted" });

    if (cfg.fallback) {
      trace.push({ rule: "fallback_route", matched: true });
      return {
        action: "fallback",
        reason: `${reason} — retries exhausted, routing to fallback`,
        fallback: cfg.fallback,
        trace,
      };
    }
    trace.push({ rule: "fallback_route", matched: false, detail: "no fallback configured" });
    return failFast(`${reason} unrecoverable after ${cap} retries`, trace);
  }

  // 5. Default (should be unreachable given the exhaustive taxonomy).
  trace.push({ rule: "default_noop", matched: true });
  return { action: "noop", reason: "no policy rule matched", trace };
}
