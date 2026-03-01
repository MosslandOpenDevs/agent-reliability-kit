import test from "node:test";
import assert from "node:assert/strict";

import {
  removeEmptyTextBlocks,
  normalizeContentBlocks,
  runPreflightGuards,
  registerPreflightGuard,
  clearPreflightGuards,
  sanitizeMessages,
} from "../src/index.js";

test("removeEmptyTextBlocks strips empty and whitespace-only text blocks", () => {
  const blocks = [
    { type: "text", text: "" },
    { type: "text", text: "   \n\t  " },
    { type: "text", text: "Hello" },
    { type: "image", url: "https://example.com/cat.png" },
  ];

  assert.deepEqual(removeEmptyTextBlocks(blocks), [
    { type: "text", text: "Hello" },
    { type: "image", url: "https://example.com/cat.png" },
  ]);
});

test("normalizeContentBlocks normalizes strings and mixed content arrays", () => {
  const normalized = normalizeContentBlocks([
    "hello",
    { type: "text", content: "world" },
    { type: "tool_result", data: { ok: true } },
    null,
  ]);

  assert.deepEqual(normalized, [
    { type: "text", text: "hello" },
    { type: "text", content: "world", text: "world" },
    { type: "tool_result", data: { ok: true } },
  ]);
});

test("normalizeContentBlocks keeps already-valid payload blocks unchanged", () => {
  const validBlocks = [
    { type: "text", text: "stable" },
    { type: "image", url: "https://example.com/x.png" },
  ];

  const normalized = normalizeContentBlocks(validBlocks);

  assert.deepEqual(normalized, validBlocks);
  assert.equal(normalized[0], validBlocks[0]);
  assert.equal(normalized[1], validBlocks[1]);
});

test("sanitizeMessages normalizes message content and removes empty messages", () => {
  const messages = sanitizeMessages([
    {
      role: "user",
      content: [
        { type: "text", text: "  " },
        "Need a safer fallback plan",
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "\n\t" }],
    },
    {
      role: "system",
      content: [{ type: "tool_result", data: { ok: true } }],
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [{ type: "text", text: "Need a safer fallback plan" }],
    },
    {
      role: "system",
      content: [{ type: "tool_result", data: { ok: true } }],
    },
  ]);
});

test("sanitizeMessages can keep empty messages when requested", () => {
  const messages = sanitizeMessages(
    [
      { role: "assistant", content: [{ type: "text", text: "   " }] },
      { role: "user", content: ["ship safely"] },
    ],
    { keepEmptyMessages: true },
  );

  assert.deepEqual(messages, [
    { role: "assistant", content: [] },
    { role: "user", content: [{ type: "text", text: "ship safely" }] },
  ]);
});

test("runPreflightGuards applies global and provider-specific hooks", () => {
  clearPreflightGuards();

  registerPreflightGuard("*", ({ payload }) => ({
    ...payload,
    globalApplied: true,
  }));

  registerPreflightGuard("openai", ({ payload }) => ({
    ...payload,
    providerApplied: true,
  }));

  const result = runPreflightGuards(
    {
      content: [
        { type: "text", text: "   " },
        "hello",
      ],
      messages: [
        { role: "assistant", content: [{ type: "text", text: "   " }] },
        { role: "user", content: ["deploy with canary"] },
      ],
    },
    { provider: "openai", keepEmptyMessages: true },
  );

  assert.deepEqual(result, {
    content: [{ type: "text", text: "hello" }],
    messages: [
      { role: "assistant", content: [] },
      { role: "user", content: [{ type: "text", text: "deploy with canary" }] },
    ],
    globalApplied: true,
    providerApplied: true,
  });

  clearPreflightGuards();
});
