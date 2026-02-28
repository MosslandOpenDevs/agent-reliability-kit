import test from "node:test";
import assert from "node:assert/strict";

import {
  removeEmptyTextBlocks,
  normalizeContentBlocks,
  runPreflightGuards,
  registerPreflightGuard,
  clearPreflightGuards,
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
    },
    { provider: "openai" },
  );

  assert.deepEqual(result, {
    content: [{ type: "text", text: "hello" }],
    globalApplied: true,
    providerApplied: true,
  });

  clearPreflightGuards();
});
