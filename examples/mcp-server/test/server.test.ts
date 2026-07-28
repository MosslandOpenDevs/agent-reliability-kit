import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createArkMcpServer,
  MCP_MAX_MERGE_SEPARATOR_CHARS,
  MCP_SANITIZE_LIMITS,
} from "../src/server.ts";

async function connectClient(t: TestContext): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createArkMcpServer();
  const client = new Client({ name: "ark-mcp-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  t.after(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });

  return client;
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function textContent(result: unknown): string {
  const resultObject = asRecord(result);
  assert.ok(Array.isArray(resultObject.content), "tool result must contain content");
  const first = resultObject.content[0] as unknown;
  const firstObject = asRecord(first);
  assert.ok(first, "tool result must contain a content block");
  assert.equal(firstObject.type, "text");
  const text = firstObject.text;
  assert.equal(typeof text, "string");
  if (typeof text !== "string") {
    throw new TypeError("expected text content");
  }
  return text;
}

function jsonContent<T>(result: unknown): T {
  assert.notEqual(asRecord(result).isError, true, textContent(result));
  return JSON.parse(textContent(result)) as T;
}

function assertToolError(result: unknown, toolName: string): void {
  assert.equal(asRecord(result).isError, true);
  assert.match(textContent(result), new RegExp(`^Invalid arguments for ${toolName}:`));
}

test("tools/list advertises four strict, bounded tool schemas", async (t) => {
  const client = await connectClient(t);
  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["ark_sanitize", "ark_classify", "ark_policy", "ark_triage"],
  );

  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const sanitize = tools.find((tool) => tool.name === "ark_sanitize");
  assert.ok(sanitize);
  const inputProperties = asRecord(sanitize.inputSchema.properties);
  const options = asRecord(inputProperties.options);
  const properties = asRecord(options.properties);

  assert.deepEqual(properties.maxMessageCount, {
    type: "integer",
    minimum: 0,
    maximum: MCP_SANITIZE_LIMITS.maxMessageCount,
  });
  assert.deepEqual(properties.maxTotalBlockCount, {
    type: "integer",
    minimum: 0,
    maximum: MCP_SANITIZE_LIMITS.maxTotalBlockCount,
  });
  assert.deepEqual(properties.maxTotalTextChars, {
    type: "integer",
    minimum: 0,
    maximum: MCP_SANITIZE_LIMITS.maxTotalTextChars,
  });
  assert.deepEqual(properties.mergeSeparator, {
    type: "string",
    maxLength: MCP_MAX_MERGE_SEPARATOR_CHARS,
  });
});

test("all four tools execute over a real MCP in-memory connection", async (t) => {
  const client = await connectClient(t);

  const sanitized = jsonContent<{
    content: Array<{ type: string; text?: string }>;
    messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
  }>(
    await client.callTool({
      name: "ark_sanitize",
      arguments: {
        payload: {
          content: ["hello", { type: "text", text: "   " }],
          messages: [{ role: "user", content: ["ship safely"] }],
        },
      },
    }),
  );
  assert.deepEqual(sanitized.content, [{ type: "text", text: "hello" }]);
  assert.deepEqual(sanitized.messages, [
    { role: "user", content: [{ type: "text", text: "ship safely" }] },
  ]);

  const event = {
    timestamp: "2026-07-28T00:00:00Z",
    app: "mcp-test",
    phase: "error",
    provider: "openai",
    error: { type: "RateLimitError", status: 429 },
  };
  const classification = jsonContent<{
    incidentReason: string;
    riskTier: string;
    confidence: number;
    signals: string[];
  }>(
    await client.callTool({
      name: "ark_classify",
      arguments: { event },
    }),
  );
  assert.equal(classification.incidentReason, "rate_limit");
  assert.equal(classification.riskTier, "low");

  const decision = jsonContent<{ action: string; retry?: { attempt: number; delayMs: number } }>(
    await client.callTool({
      name: "ark_policy",
      arguments: {
        classification,
        context: { attempt: 0 },
        config: { baseDelayMs: 100 },
      },
    }),
  );
  assert.equal(decision.action, "retry");
  assert.deepEqual(decision.retry, { attempt: 1, maxRetries: 3, delayMs: 100 });

  const triage = jsonContent<{
    classification: { incidentReason: string };
    decision: { action: string };
    report: { incidentReason: string; action: string };
    human: string;
  }>(
    await client.callTool({
      name: "ark_triage",
      arguments: { event },
    }),
  );
  assert.equal(triage.classification.incidentReason, "rate_limit");
  assert.equal(triage.decision.action, "retry");
  assert.equal(triage.report.incidentReason, "rate_limit");
  assert.match(triage.human, /rate_limit/);
});

test("invalid arguments return visible tool errors and leave the connection usable", async (t) => {
  const client = await connectClient(t);

  const invalidCalls = [
    {
      toolName: "ark_sanitize",
      arguments: {},
    },
    {
      toolName: "ark_sanitize",
      arguments: { payload: [], options: { unknownOption: true } },
    },
    {
      toolName: "ark_classify",
      arguments: {
        event: { app: "missing-timestamp", phase: "error", extra: true },
      },
    },
    {
      toolName: "ark_classify",
      arguments: {
        event: { timestamp: "not-a-date", app: "bad-timestamp", phase: "error" },
      },
    },
    {
      toolName: "ark_policy",
      arguments: {
        classification: {
          incidentReason: "not-a-reason",
          riskTier: "low",
          confidence: 2,
          signals: [42],
        },
      },
    },
    {
      toolName: "ark_policy",
      arguments: {
        classification: {
          incidentReason: "unknown",
          riskTier: "moderate",
          confidence: 0.2,
          signals: ["no_match"],
        },
        context: { attempt: -1, extra: true },
        config: { maxRetries: -1, fallback: { provider: "safe", extra: true } },
      },
    },
    {
      toolName: "ark_triage",
      arguments: {
        event: {
          timestamp: "2026-07-28T00:00:00Z",
          app: "bad-phase",
          phase: "during_request",
        },
      },
    },
  ] as const;

  for (const invalid of invalidCalls) {
    const result = await client.callTool({
      name: invalid.toolName,
      arguments: invalid.arguments,
    });
    assertToolError(result, invalid.toolName);
  }

  const secretProperty = `secret-${"x".repeat(2_000)}`;
  const boundedError = await client.callTool({
    name: "ark_sanitize",
    arguments: {
      payload: {},
      options: { [secretProperty]: true },
    },
  });
  assertToolError(boundedError, "ark_sanitize");
  assert.ok(textContent(boundedError).length <= 1_000);
  assert.ok(!textContent(boundedError).includes(secretProperty));

  const recovery = jsonContent<{ incidentReason: string }>(
    await client.callTool({
      name: "ark_classify",
      arguments: {
        event: {
          timestamp: "2026-07-28T00:00:00Z",
          app: "still-connected",
          phase: "post_response",
        },
      },
    }),
  );
  assert.equal(recovery.incidentReason, "unknown");
});

test("remote sanitize limits default securely, can be lowered, and cannot be raised", async (t) => {
  const client = await connectClient(t);

  const defaultLimited = jsonContent<{
    messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  }>(
    await client.callTool({
      name: "ark_sanitize",
      arguments: {
        payload: {
          messages: Array.from({ length: MCP_SANITIZE_LIMITS.maxMessageCount + 1 }, (_, index) => ({
            role: "user",
            content: [`message-${index}`],
          })),
        },
      },
    }),
  );
  assert.equal(defaultLimited.messages.length, MCP_SANITIZE_LIMITS.maxMessageCount);
  assert.equal(defaultLimited.messages.at(-1)?.content[0]?.text, "message-255");

  const lowered = jsonContent<{
    content: Array<{ type: string; text?: string }>;
    messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
  }>(
    await client.callTool({
      name: "ark_sanitize",
      arguments: {
        payload: {
          content: [
            { type: "input_text", text: "abcd" },
            { type: "image", url: "https://example.com/x.png" },
          ],
          messages: [
            { role: "user", content: ["efgh", { type: "tool_result", data: { ok: true } }] },
            { role: "assistant", content: ["ignored"] },
          ],
        },
        options: {
          profileMode: "off",
          maxMessageCount: 1,
          maxTotalBlockCount: 3,
          maxTotalTextChars: 6,
        },
      },
    }),
  );
  assert.deepEqual(lowered.content, [
    { type: "input_text", text: "abcd" },
    { type: "image", url: "https://example.com/x.png" },
  ]);
  assert.deepEqual(lowered.messages, [{ role: "user", content: [{ type: "text", text: "ef" }] }]);

  const raised = await client.callTool({
    name: "ark_sanitize",
    arguments: {
      payload: {},
      options: {
        maxMessageCount: MCP_SANITIZE_LIMITS.maxMessageCount + 1,
        maxTotalBlockCount: MCP_SANITIZE_LIMITS.maxTotalBlockCount + 1,
        maxTotalTextChars: MCP_SANITIZE_LIMITS.maxTotalTextChars + 1,
      },
    },
  });
  assertToolError(raised, "ark_sanitize");

  const oversizedSeparator = await client.callTool({
    name: "ark_sanitize",
    arguments: {
      payload: {},
      options: {
        mergeSeparator: "x".repeat(MCP_MAX_MERGE_SEPARATOR_CHARS + 1),
      },
    },
  });
  assertToolError(oversizedSeparator, "ark_sanitize");
});

test("error-phase event without error details remains actionable end to end", async (t) => {
  const client = await connectClient(t);

  const triage = jsonContent<{
    classification: { incidentReason: string; riskTier: string; signals: string[] };
    decision: { action: string };
  }>(
    await client.callTool({
      name: "ark_triage",
      arguments: {
        event: {
          timestamp: "2026-07-28T00:00:00Z",
          app: "error-without-details",
          phase: "error",
        },
      },
    }),
  );

  assert.deepEqual(triage.classification, {
    incidentReason: "unknown",
    riskTier: "moderate",
    confidence: 0.2,
    signals: ["no_match", "phase:error"],
  });
  assert.notEqual(triage.decision.action, "noop");
  assert.equal(triage.decision.action, "retry");
});
