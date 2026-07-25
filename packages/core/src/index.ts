/**
 * @ark/core — shared contracts for the Agent Reliability Kit.
 *
 * This package is intentionally runtime-light: mostly types, a few frozen
 * constants, small type guards, and an OpenTelemetry GenAI attribute mapper.
 * Every other `@ark/*` module consumes these contracts so that sanitize,
 * classify, policy, and report agree on a single event/incident vocabulary.
 */

/** Current runtime-event schema version. See `schemas/runtime-event.v2.json`. */
export const SCHEMA_VERSION = "2.0.0" as const;

// ---------------------------------------------------------------------------
// Runtime event (input model)
// ---------------------------------------------------------------------------

/** Lifecycle phase at which an event was captured. */
export type IncidentPhase = "pre_request" | "post_response" | "error";

/**
 * GenAI operation kind. Values mirror the OpenTelemetry GenAI semantic
 * convention `gen_ai.operation.name` (Development stability, mid-2026).
 */
export type GenAiOperation =
  | "chat"
  | "text_completion"
  | "generate_content"
  | "embeddings"
  | "create_agent"
  | "invoke_agent"
  | "execute_tool";

/** Token accounting for a request/response pair. */
export interface TokenUsage {
  /** Maps to `gen_ai.usage.input_tokens`. */
  readonly inputTokens?: number;
  /** Maps to `gen_ai.usage.output_tokens`. */
  readonly outputTokens?: number;
}

/** Session/turn correlation metadata. */
export interface SessionRef {
  readonly id?: string;
  readonly turn?: number;
}

/**
 * Normalized error payload. `type` deliberately reuses the standard
 * OpenTelemetry `error.type` attribute rather than a GenAI-specific field.
 */
export interface RuntimeError {
  /** Exception class name or HTTP-style code — maps to `error.type`. */
  readonly type?: string;
  readonly message?: string;
  /** Provider HTTP status, when the failure is an API error. */
  readonly status?: number;
  /** Provider-specific error code, e.g. `"rate_limit_exceeded"`. */
  readonly code?: string;
  /** Provider hint that the request may be safely retried. */
  readonly retryable?: boolean;
}

/**
 * Compact prior event used for burst detection. The `timestamp` is carried for
 * correlation and is reserved for a future stale-noise gate (not yet used by
 * {@link classifyEvent}).
 */
export interface RecentEvent {
  readonly timestamp: string;
  readonly phase: IncidentPhase;
  readonly error?: RuntimeError;
}

/**
 * A single runtime event consumed by ARK. Field names map to the
 * OpenTelemetry GenAI semantic conventions where one exists (see
 * {@link toGenAIAttributes}).
 */
export interface RuntimeEvent {
  readonly schemaVersion?: string;
  /** ISO-8601 date-time. */
  readonly timestamp: string;
  /** Logical application/service name. */
  readonly app: string;
  readonly phase: IncidentPhase;
  /** Maps to `gen_ai.provider.name` (e.g. `"openai"`, `"anthropic"`). */
  readonly provider?: string;
  /** Maps to `gen_ai.request.model`. */
  readonly model?: string;
  /** Maps to `gen_ai.response.model`. */
  readonly responseModel?: string;
  /** Maps to `gen_ai.operation.name`. */
  readonly operation?: GenAiOperation;
  readonly session?: SessionRef;
  readonly usage?: TokenUsage;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly error?: RuntimeError;
  /** Recent same-app events, newest last, for burst/noise gates. */
  readonly recentWindow?: readonly RecentEvent[];
}

// ---------------------------------------------------------------------------
// Classification (output of @ark/classify)
// ---------------------------------------------------------------------------

/**
 * Base incident taxonomy. `unknown` is the safe default for errors that do not
 * match any known reason.
 */
export type IncidentReason =
  | "payload_invalid"
  | "auth_error"
  | "rate_limit"
  | "runtime_noise"
  | "state_drift"
  | "unknown";

/** Operational risk tier for an incident. */
export type RiskTier = "none" | "low" | "moderate" | "high";

/** Result of classifying a runtime event. */
export interface Classification {
  readonly incidentReason: IncidentReason;
  readonly riskTier: RiskTier;
  /** Confidence in `[0, 1]`. */
  readonly confidence: number;
  /** Human-readable signals that drove the classification. */
  readonly signals: readonly string[];
}

// ---------------------------------------------------------------------------
// Policy (output of @ark/policy)
// ---------------------------------------------------------------------------

/** Runtime action a policy can recommend. */
export type PolicyAction = "retry" | "fallback" | "fail_fast" | "sanitize" | "noop";

/** Concrete retry instruction. */
export interface RetryDirective {
  /** 1-based index of the next attempt. */
  readonly attempt: number;
  readonly maxRetries: number;
  /** Backoff delay before the next attempt, in milliseconds. */
  readonly delayMs: number;
}

/** Concrete fallback routing instruction. */
export interface FallbackDirective {
  readonly provider?: string;
  readonly model?: string;
}

/** One evaluated rule in a policy decision, for observability. */
export interface PolicyTraceEntry {
  readonly rule: string;
  readonly matched: boolean;
  readonly detail?: string;
}

/** Result of evaluating a policy against a classification. */
export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly reason: string;
  readonly retry?: RetryDirective;
  readonly fallback?: FallbackDirective;
  /** Ordered trace of rules evaluated to reach `action`. */
  readonly trace: readonly PolicyTraceEntry[];
}

// ---------------------------------------------------------------------------
// Report (output of @ark/report)
// ---------------------------------------------------------------------------

/** Machine-readable incident artifact plus a one-line human summary. */
export interface IncidentReport {
  readonly incidentReason: IncidentReason;
  readonly riskTier: RiskTier;
  readonly confidence: number;
  readonly recommendedActions: readonly string[];
  /** One-line human reason + action hint. */
  readonly summary: string;
  readonly action: PolicyAction;
  readonly schemaVersion: string;
  readonly generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Frozen enumerations
// ---------------------------------------------------------------------------

/** All incident reasons, ordered from most to least specific. */
export const INCIDENT_REASONS: readonly IncidentReason[] = [
  "payload_invalid",
  "auth_error",
  "rate_limit",
  "state_drift",
  "runtime_noise",
  "unknown",
] as const;

/** All risk tiers, ordered from lowest to highest severity. */
export const RISK_TIERS: readonly RiskTier[] = ["none", "low", "moderate", "high"] as const;

/** All policy actions. */
export const POLICY_ACTIONS: readonly PolicyAction[] = [
  "retry",
  "fallback",
  "fail_fast",
  "sanitize",
  "noop",
] as const;

/** Numeric rank for a risk tier, useful for comparisons and escalation. */
export function riskTierRank(tier: RiskTier): number {
  return RISK_TIERS.indexOf(tier);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Narrow an unknown value to a known {@link IncidentReason}. */
export function isIncidentReason(value: unknown): value is IncidentReason {
  return typeof value === "string" && (INCIDENT_REASONS as readonly string[]).includes(value);
}

/** Narrow an unknown value to a known {@link RiskTier}. */
export function isRiskTier(value: unknown): value is RiskTier {
  return typeof value === "string" && (RISK_TIERS as readonly string[]).includes(value);
}

/** Clamp a number into the `[0, 1]` confidence range. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// OpenTelemetry GenAI mapping
// ---------------------------------------------------------------------------

/**
 * Project a {@link RuntimeEvent} onto OpenTelemetry GenAI semantic-convention
 * span attributes (Development stability as of mid-2026).
 *
 * Notes:
 * - uses `gen_ai.provider.name` (the deprecated `gen_ai.system` is not emitted);
 * - reuses the standard `error.type` attribute for failures;
 * - message/prompt content is intentionally NOT emitted here — content capture
 *   is opt-in and privacy-sensitive.
 */
export function toGenAIAttributes(event: RuntimeEvent): Record<string, string | number> {
  const attributes: Record<string, string | number> = {};

  if (event.provider) {
    attributes["gen_ai.provider.name"] = event.provider;
  }
  if (event.operation) {
    attributes["gen_ai.operation.name"] = event.operation;
  }
  if (event.model) {
    attributes["gen_ai.request.model"] = event.model;
  }
  if (event.responseModel) {
    attributes["gen_ai.response.model"] = event.responseModel;
  }
  if (typeof event.usage?.inputTokens === "number") {
    attributes["gen_ai.usage.input_tokens"] = event.usage.inputTokens;
  }
  if (typeof event.usage?.outputTokens === "number") {
    attributes["gen_ai.usage.output_tokens"] = event.usage.outputTokens;
  }
  if (event.error?.type) {
    attributes["error.type"] = event.error.type;
  }

  return attributes;
}
