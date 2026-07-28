/**
 * Side-effect-free MCP server factory for the Agent Reliability Kit tools.
 *
 * The JSON Schemas below are both advertised through `tools/list` and enforced
 * at runtime before an argument reaches an ARK package.
 */

import { classifyEvent } from "@ark/classify";
import { type Classification, INCIDENT_REASONS, RISK_TIERS, type RuntimeEvent } from "@ark/core";
import { evaluatePolicy, type PolicyConfig, type PolicyContext } from "@ark/policy";
import { buildIncidentReport, formatHumanSummary } from "@ark/report";
import { runPreflightGuards } from "@ark/sanitize";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import Ajv2020Module, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

import runtimeEventSchema from "../../../schemas/runtime-event.v2.json" with { type: "json" };

export interface McpSanitizeLimits {
  maxMessageCount: number;
  maxTotalBlockCount: number;
  maxTotalTextChars: number;
}

/**
 * Remote callers may lower these ceilings per call, but cannot raise them.
 * The standalone sanitize package remains opt-in and compatibility-unbounded.
 */
export const MCP_SANITIZE_LIMITS: Readonly<McpSanitizeLimits> = Object.freeze({
  maxMessageCount: 256,
  maxTotalBlockCount: 2_048,
  maxTotalTextChars: 1_000_000,
});

export const MCP_MAX_MERGE_SEPARATOR_CHARS = 1_024;

const MAX_VALIDATION_ERRORS = 1;
const MAX_VALIDATION_ERROR_TEXT_CHARS = 1_000;

type SanitizePayloadInput = Record<string, unknown>;

interface McpSanitizeOptions {
  keepEmptyMessages?: boolean;
  provider?: string;
  profileMode?: "basic" | "off";
  mergeAdjacentText?: boolean;
  mergeSeparator?: string;
  trimMergedText?: boolean;
  collapseMergedWhitespace?: boolean;
  stripControlChars?: boolean;
  stripAnsiEscapes?: boolean;
  stripHtmlTags?: boolean;
  stripMarkdownLinks?: boolean;
  stripMarkdownImages?: boolean;
  maxTextLength?: number;
  maxBlockCount?: number;
  maxMessageCount?: number;
  maxTotalBlockCount?: number;
  maxTotalTextChars?: number;
  includeImpact?: boolean;
}

interface SanitizeArguments {
  payload: SanitizePayloadInput;
  options?: McpSanitizeOptions;
}

interface ClassifyArguments {
  event: RuntimeEvent;
}

interface PolicyArguments {
  classification: Classification;
  context?: PolicyContext;
  config?: PolicyConfig;
}

interface TriageArguments {
  event: RuntimeEvent;
  context?: PolicyContext;
  config?: PolicyConfig;
}

const payloadSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const sanitizeOptionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    keepEmptyMessages: { type: "boolean" },
    provider: { type: "string" },
    profileMode: { type: "string", enum: ["basic", "off"] },
    mergeAdjacentText: { type: "boolean" },
    mergeSeparator: { type: "string", maxLength: MCP_MAX_MERGE_SEPARATOR_CHARS },
    trimMergedText: { type: "boolean" },
    collapseMergedWhitespace: { type: "boolean" },
    stripControlChars: { type: "boolean" },
    stripAnsiEscapes: { type: "boolean" },
    stripHtmlTags: { type: "boolean" },
    stripMarkdownLinks: { type: "boolean" },
    stripMarkdownImages: { type: "boolean" },
    maxTextLength: { type: "number", minimum: 0 },
    maxBlockCount: { type: "integer", minimum: 0 },
    maxMessageCount: {
      type: "integer",
      minimum: 0,
      maximum: MCP_SANITIZE_LIMITS.maxMessageCount,
    },
    maxTotalBlockCount: {
      type: "integer",
      minimum: 0,
      maximum: MCP_SANITIZE_LIMITS.maxTotalBlockCount,
    },
    maxTotalTextChars: {
      type: "integer",
      minimum: 0,
      maximum: MCP_SANITIZE_LIMITS.maxTotalTextChars,
    },
    includeImpact: { type: "boolean" },
  },
} as const;

const classificationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["incidentReason", "riskTier", "confidence", "signals"],
  properties: {
    incidentReason: {
      type: "string",
      enum: [...INCIDENT_REASONS],
    },
    riskTier: {
      type: "string",
      enum: [...RISK_TIERS],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    signals: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const policyContextSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    attempt: { type: "integer", minimum: 0 },
  },
} as const;

const policyConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    maxRetries: { type: "integer", minimum: 0 },
    baseDelayMs: { type: "number", minimum: 0 },
    backoffFactor: { type: "number", minimum: 0 },
    maxDelayMs: { type: "number", minimum: 0 },
    fallback: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        model: { type: "string" },
      },
    },
  },
} as const;

const sanitizeInputSchema: Tool["inputSchema"] = {
  type: "object",
  additionalProperties: false,
  required: ["payload"],
  properties: {
    payload: payloadSchema,
    options: sanitizeOptionsSchema,
  },
};

const classifyInputSchema: Tool["inputSchema"] = {
  type: "object",
  additionalProperties: false,
  required: ["event"],
  properties: {
    event: runtimeEventSchema,
  },
};

const policyInputSchema: Tool["inputSchema"] = {
  type: "object",
  additionalProperties: false,
  required: ["classification"],
  properties: {
    classification: classificationSchema,
    context: policyContextSchema,
    config: policyConfigSchema,
  },
};

const triageInputSchema: Tool["inputSchema"] = {
  type: "object",
  additionalProperties: false,
  required: ["event"],
  properties: {
    event: runtimeEventSchema,
    context: policyContextSchema,
    config: policyConfigSchema,
  },
};

const TOOLS: Tool[] = [
  {
    name: "ark_sanitize",
    description: "Normalize and preflight-clean a provider request payload.",
    inputSchema: sanitizeInputSchema,
  },
  {
    name: "ark_classify",
    description: "Classify a runtime event into an incident reason, risk tier, and confidence.",
    inputSchema: classifyInputSchema,
  },
  {
    name: "ark_policy",
    description: "Turn a classification into a retry/fallback/fail-fast decision.",
    inputSchema: policyInputSchema,
  },
  {
    name: "ark_triage",
    description:
      "End-to-end: classify a runtime event, decide a policy, and build an incident report.",
    inputSchema: triageInputSchema,
  },
];

function createValidator<T>(schema: object): ValidateFunction<T> {
  // The canonical runtime-event schema carries an `$id`. Separate Ajv instances
  // let classify and triage embed that exact schema without duplicate-id state.
  const Ajv2020 = Ajv2020Module.default;
  const addFormats = addFormatsModule.default;
  // Fail fast so malformed untrusted input cannot accumulate an unbounded
  // validation-error array before the response text is capped.
  const ajv = new Ajv2020({ allErrors: false, strict: true });
  addFormats(ajv);
  return ajv.compile<T>(schema);
}

const validateSanitizeArguments = createValidator<SanitizeArguments>(sanitizeInputSchema);
const validateClassifyArguments = createValidator<ClassifyArguments>(classifyInputSchema);
const validatePolicyArguments = createValidator<PolicyArguments>(policyInputSchema);
const validateTriageArguments = createValidator<TriageArguments>(triageInputSchema);

function isValid<T>(validator: ValidateFunction<T>, value: unknown): value is T {
  return validator(value);
}

function formatValidationError(error: ErrorObject): string {
  const path = error.instancePath || "/";

  if (error.keyword === "additionalProperties") {
    return `${path} contains an unsupported property`;
  }

  if (error.keyword === "required") {
    const property = String(error.params.missingProperty);
    return `${path} is missing required property ${JSON.stringify(property)}`;
  }

  return `${path} ${error.message ?? "is invalid"}`;
}

function invalidArgumentsResult(
  toolName: string,
  errors: ErrorObject[] | null | undefined,
): CallToolResult {
  const details = (errors ?? []).slice(0, MAX_VALIDATION_ERRORS).map(formatValidationError);
  const suffix = details.length > 0 ? details.join("; ") : "input does not match the tool schema";
  const message = `Invalid arguments for ${toolName}: ${suffix}`;

  return {
    content: [{ type: "text", text: message.slice(0, MAX_VALIDATION_ERROR_TEXT_CHARS) }],
    isError: true,
  };
}

function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) ?? "null" }],
  };
}

function resolveSanitizeOptions(options: McpSanitizeOptions | undefined): McpSanitizeOptions {
  return {
    ...options,
    maxMessageCount: options?.maxMessageCount ?? MCP_SANITIZE_LIMITS.maxMessageCount,
    maxTotalBlockCount: options?.maxTotalBlockCount ?? MCP_SANITIZE_LIMITS.maxTotalBlockCount,
    maxTotalTextChars: options?.maxTotalTextChars ?? MCP_SANITIZE_LIMITS.maxTotalTextChars,
  };
}

/** Create a fresh, disconnected ARK MCP server. Importing this module has no I/O side effects. */
export function createArkMcpServer(): Server {
  const server = new Server(
    { name: "ark-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const args = request.params.arguments;

    switch (request.params.name) {
      case "ark_sanitize":
        if (!isValid(validateSanitizeArguments, args)) {
          return invalidArgumentsResult(request.params.name, validateSanitizeArguments.errors);
        }
        return jsonResult(runPreflightGuards(args.payload, resolveSanitizeOptions(args.options)));

      case "ark_classify":
        if (!isValid(validateClassifyArguments, args)) {
          return invalidArgumentsResult(request.params.name, validateClassifyArguments.errors);
        }
        return jsonResult(classifyEvent(args.event));

      case "ark_policy":
        if (!isValid(validatePolicyArguments, args)) {
          return invalidArgumentsResult(request.params.name, validatePolicyArguments.errors);
        }
        return jsonResult(evaluatePolicy(args.classification, args.context, args.config));

      case "ark_triage": {
        if (!isValid(validateTriageArguments, args)) {
          return invalidArgumentsResult(request.params.name, validateTriageArguments.errors);
        }
        const classification = classifyEvent(args.event);
        const decision = evaluatePolicy(classification, args.context, args.config);
        const report = buildIncidentReport(classification, decision);
        return jsonResult({ classification, decision, report, human: formatHumanSummary(report) });
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
          isError: true,
        };
    }
  });

  return server;
}
