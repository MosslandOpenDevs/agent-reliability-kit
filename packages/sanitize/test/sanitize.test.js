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

test("sanitizeMessages applies provider profile normalization", () => {
  const openaiMessages = sanitizeMessages(
    [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    { provider: "openai" },
  );

  assert.deepEqual(openaiMessages, [
    { role: "user", content: [{ type: "text", text: "hello" }] },
  ]);

  const anthropicMessages = sanitizeMessages(
    [{ role: "user", content: [{ type: "image_url", image_url: "https://example.com/a.png" }] }],
    { provider: "anthropic" },
  );

  assert.deepEqual(anthropicMessages, [
    {
      role: "user",
      content: [{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }],
    },
  ]);
});

test("sanitizeMessages can disable provider profile normalization", () => {
  const messages = sanitizeMessages(
    [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    { provider: "openai", profileMode: "off" },
  );

  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
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

test("runPreflightGuards applies profile normalization to top-level content by default", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: [{ type: "input_text", text: "hello" }],
      messages: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    },
    { provider: "openai" },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "hello" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "hello" }] },
  ]);
});

test("runPreflightGuards keeps original provider block types when profileMode is off", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: [{ type: "input_text", text: "hello" }],
      messages: [
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    },
    { provider: "openai", profileMode: "off" },
  );

  assert.deepEqual(result.content, [{ type: "input_text", text: "hello" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
  ]);
});

test("sanitizeMessages handles large message arrays deterministically", () => {
  const messages = Array.from({ length: 1000 }, (_, idx) => ({
    role: "user",
    content: idx % 2 === 0
      ? [{ type: "text", text: "   " }]
      : [{ type: "input_text", text: `message-${idx}` }],
  }));

  const sanitized = sanitizeMessages(messages, { provider: "openai" });

  assert.equal(sanitized.length, 500);
  assert.deepEqual(sanitized[0], {
    role: "user",
    content: [{ type: "text", text: "message-1" }],
  });
  assert.deepEqual(sanitized.at(-1), {
    role: "user",
    content: [{ type: "text", text: "message-999" }],
  });
});

test("sanitizeMessages option matrix stays deterministic", () => {
  const input = [
    { role: "assistant", content: [{ type: "text", text: "   " }] },
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
  ];

  const basic = sanitizeMessages(input, { provider: "openai" });
  const keepEmpty = sanitizeMessages(input, { provider: "openai", keepEmptyMessages: true });
  const profileOff = sanitizeMessages(input, { provider: "openai", profileMode: "off" });

  assert.deepEqual(basic, [
    { role: "user", content: [{ type: "text", text: "hello" }] },
  ]);

  assert.deepEqual(keepEmpty, [
    { role: "assistant", content: [] },
    { role: "user", content: [{ type: "text", text: "hello" }] },
  ]);

  assert.deepEqual(profileOff, [
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
  ]);
});

test("sanitizeMessages normalizes mixed multimodal blocks by provider", () => {
  const anthropic = sanitizeMessages(
    [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: "https://example.com/x.png" },
          { type: "text", text: "look at this" },
        ],
      },
    ],
    { provider: "anthropic" },
  );

  assert.deepEqual(anthropic, [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: "https://example.com/x.png" } },
        { type: "text", text: "look at this" },
      ],
    },
  ]);
});
