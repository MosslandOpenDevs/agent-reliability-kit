/**
 * Example MCP server that exposes the Agent Reliability Kit as tools.
 *
 * Any MCP host (Claude, an agent framework, an IDE) can call `ark_sanitize`,
 * `ark_classify`, `ark_policy`, or `ark_triage` at runtime. This demonstrates
 * the "ship ARK as an MCP server" integration; a transport-level interceptor is
 * the other half (see docs/MCP.md).
 *
 * Run with: `pnpm --filter @ark/example-mcp-server build && node dist/index.mjs`
 */

import { classifyEvent } from "@ark/classify";
import type { RuntimeEvent } from "@ark/core";
import { evaluatePolicy, type PolicyConfig, type PolicyContext } from "@ark/policy";
import { buildIncidentReport, formatHumanSummary } from "@ark/report";
import { runPreflightGuards } from "@ark/sanitize";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

const objectSchema = {
  type: "object" as const,
  additionalProperties: true,
};

const TOOLS: Tool[] = [
  {
    name: "ark_sanitize",
    description: "Normalize and preflight-clean a provider request payload.",
    inputSchema: {
      type: "object",
      properties: { payload: objectSchema, options: objectSchema },
      required: ["payload"],
    },
  },
  {
    name: "ark_classify",
    description: "Classify a runtime event into an incident reason, risk tier, and confidence.",
    inputSchema: {
      type: "object",
      properties: { event: objectSchema },
      required: ["event"],
    },
  },
  {
    name: "ark_policy",
    description: "Turn a classification into a retry/fallback/fail-fast decision.",
    inputSchema: {
      type: "object",
      properties: { classification: objectSchema, context: objectSchema, config: objectSchema },
      required: ["classification"],
    },
  },
  {
    name: "ark_triage",
    description:
      "End-to-end: classify a runtime event, decide a policy, and build an incident report.",
    inputSchema: {
      type: "object",
      properties: { event: objectSchema, context: objectSchema, config: objectSchema },
      required: ["event"],
    },
  },
];

function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function getArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  return args ?? {};
}

const server = new Server(
  { name: "ark-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const args = getArgs(request.params.arguments);

  switch (request.params.name) {
    case "ark_sanitize":
      return jsonResult(runPreflightGuards(args.payload, args.options ?? {}));

    case "ark_classify":
      return jsonResult(classifyEvent(args.event as RuntimeEvent));

    case "ark_policy": {
      const classification = args.classification as Parameters<typeof evaluatePolicy>[0];
      return jsonResult(
        evaluatePolicy(classification, args.context as PolicyContext, args.config as PolicyConfig),
      );
    }

    case "ark_triage": {
      const event = args.event as RuntimeEvent;
      const classification = classifyEvent(event);
      const decision = evaluatePolicy(
        classification,
        args.context as PolicyContext,
        args.config as PolicyConfig,
      );
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ark-mcp-server listening on stdio");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
