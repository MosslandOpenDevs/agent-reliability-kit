import test from "node:test";
import assert from "node:assert/strict";

import {
  removeEmptyTextBlocks,
  normalizeContentBlocks,
  mergeAdjacentTextBlocks,
  runPreflightGuards,
  registerPreflightGuard,
  clearPreflightGuards,
  sanitizeMessages,
  summarizeSanitizeImpact,
  summarizePayloadImpact,
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

test("mergeAdjacentTextBlocks joins contiguous text entries", () => {
  const merged = mergeAdjacentTextBlocks([
    { type: "text", text: "first" },
    { type: "text", text: "second" },
    { type: "image", url: "https://example.com/x.png" },
    { type: "text", text: "third" },
    { type: "text", text: "fourth" },
  ]);

  assert.deepEqual(merged, [
    { type: "text", text: "first\nsecond" },
    { type: "image", url: "https://example.com/x.png" },
    { type: "text", text: "third\nfourth" },
  ]);
});

test("mergeAdjacentTextBlocks supports custom separators", () => {
  const merged = mergeAdjacentTextBlocks(
    [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ],
    " | ",
  );

  assert.deepEqual(merged, [{ type: "text", text: "first | second" }]);
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

test("sanitizeMessages can merge adjacent text blocks", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
          { type: "tool_result", data: { ok: true } },
          { type: "text", text: "tail" },
        ],
      },
    ],
    { mergeAdjacentText: true },
  );

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "hello\nworld" },
        { type: "tool_result", data: { ok: true } },
        { type: "text", text: "tail" },
      ],
    },
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

test("runPreflightGuards can merge adjacent text blocks across payload", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: ["alpha", "beta"],
      messages: [
        {
          role: "user",
          content: ["hello", "world", { type: "tool_result", data: { ok: true } }, "tail"],
        },
      ],
    },
    { mergeAdjacentText: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "alpha\nbeta" }]);
  assert.deepEqual(result.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "hello\nworld" },
        { type: "tool_result", data: { ok: true } },
        { type: "text", text: "tail" },
      ],
    },
  ]);
});

test("runPreflightGuards supports custom merge separator", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: ["alpha", "beta"],
      messages: [
        { role: "user", content: ["left", "right"] },
      ],
    },
    { mergeAdjacentText: true, mergeSeparator: " | " },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "alpha | beta" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "left | right" }] },
  ]);
});

test("runPreflightGuards can trim merged text blocks", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: ["  alpha", "beta  "],
      messages: [
        { role: "user", content: ["  left", "right  "] },
      ],
    },
    { mergeAdjacentText: true, trimMergedText: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "alpha\nbeta" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "left\nright" }] },
  ]);
});

test("runPreflightGuards can collapse merged whitespace into single spaces", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: ["alpha   ", "   beta"],
      messages: [
        { role: "user", content: ["left   ", "   right"] },
      ],
    },
    { mergeAdjacentText: true, collapseMergedWhitespace: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "alpha beta" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "left right" }] },
  ]);
});

test("sanitizeMessages can enforce maxTextLength for text blocks", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "123456789" },
          { type: "tool_result", data: { ok: true } },
        ],
      },
    ],
    { maxTextLength: 5 },
  );

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "12345" },
        { type: "tool_result", data: { ok: true } },
      ],
    },
  ]);
});

test("runPreflightGuards applies maxTextLength to top-level content and messages", () => {
  const result = runPreflightGuards(
    {
      content: ["abcdefghij"],
      messages: [
        { role: "user", content: ["1234567"] },
      ],
    },
    { maxTextLength: 4 },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "abcd" }]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "1234" }] },
  ]);
});

test("sanitizeMessages drops text blocks truncated to empty strings", () => {
  const messages = sanitizeMessages(
    [
      { role: "user", content: ["abc", { type: "tool_result", data: { ok: true } }] },
      { role: "assistant", content: ["xyz"] },
    ],
    { maxTextLength: 0, keepEmptyMessages: true },
  );

  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "tool_result", data: { ok: true } }] },
    { role: "assistant", content: [] },
  ]);
});

test("runPreflightGuards drops top-level text blocks truncated to empty strings", () => {
  const result = runPreflightGuards(
    {
      content: ["abcdef", { type: "tool_result", data: { ok: true } }],
      messages: [{ role: "user", content: ["hello"] }],
    },
    { maxTextLength: 0, keepEmptyMessages: true },
  );

  assert.deepEqual(result.content, [{ type: "tool_result", data: { ok: true } }]);
  assert.deepEqual(result.messages, [{ role: "user", content: [] }]);
});

test("sanitizeMessages can cap block count per message", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "user",
        content: ["one", "two", { type: "tool_result", data: { ok: true } }],
      },
    ],
    { maxBlockCount: 1 },
  );

  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "one" }] },
  ]);
});

test("runPreflightGuards can cap top-level and message block counts", () => {
  const result = runPreflightGuards(
    {
      content: ["alpha", "beta", { type: "tool_result", data: { ok: true } }],
      messages: [{ role: "user", content: ["one", "two", "three"] }],
    },
    { maxBlockCount: 2 },
  );

  assert.deepEqual(result.content, [
    { type: "text", text: "alpha" },
    { type: "text", text: "beta" },
  ]);
  assert.deepEqual(result.messages, [
    { role: "user", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
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

test("summarizeSanitizeImpact returns deterministic counters", () => {
  const original = [
    { role: "assistant", content: [{ type: "text", text: "   " }] },
    { role: "user", content: [{ type: "input_text", text: "hello" }] },
  ];
  const sanitized = sanitizeMessages(original, { provider: "openai" });

  assert.deepEqual(summarizeSanitizeImpact(original, sanitized), {
    inputMessages: 2,
    outputMessages: 1,
    removedMessages: 1,
    removedMessageRatio: 0.5,
    inputBlocks: 2,
    outputBlocks: 1,
    removedBlocks: 1,
    removedBlockRatio: 0.5,
    inputTextChars: 3,
    outputTextChars: 5,
    removedTextChars: 0,
    removedTextCharRatio: 0,
    inputRoles: { assistant: 1, user: 1 },
    outputRoles: { user: 1 },
  });
});

test("summarizePayloadImpact includes top-level content counters", () => {
  const original = {
    content: ["hello", { type: "text", text: "   " }],
    messages: [
      { role: "assistant", content: [{ type: "text", text: "   " }] },
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ],
  };

  const sanitizedPayload = {
    content: [{ type: "text", text: "hello" }],
    messages: sanitizeMessages(original.messages, { provider: "openai" }),
  };

  assert.deepEqual(summarizePayloadImpact(original, sanitizedPayload), {
    inputMessages: 2,
    outputMessages: 1,
    removedMessages: 1,
    removedMessageRatio: 0.5,
    inputBlocks: 2,
    outputBlocks: 1,
    removedBlocks: 1,
    removedBlockRatio: 0.5,
    inputTextChars: 3,
    outputTextChars: 5,
    removedTextChars: 0,
    removedTextCharRatio: 0,
    inputRoles: { assistant: 1, user: 1 },
    outputRoles: { user: 1 },
    removedRoles: ['assistant'],
    removedRoleCount: 1,
    inputContentBlocks: 2,
    outputContentBlocks: 1,
    removedContentBlocks: 1,
    removedContentBlockRatio: 0.5,
    inputContentTextChars: 8,
    outputContentTextChars: 5,
    removedContentTextChars: 3,
    removedContentTextCharRatio: 0.375,
    inputTotalBlocks: 4,
    outputTotalBlocks: 2,
    removedTotalBlocks: 2,
    removedTotalBlockRatio: 0.5,
    inputTotalTextChars: 11,
    outputTotalTextChars: 10,
    removedTotalTextChars: 1,
    removedTotalTextCharRatio: 0.091,
  });
});

test("runPreflightGuards can include sanitize impact in payload", () => {
  const result = runPreflightGuards(
    {
      content: ["ok", { type: "text", text: "   " }],
      messages: [
        { role: "assistant", content: [{ type: "text", text: "   " }] },
        { role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    },
    { provider: "openai", includeImpact: true },
  );

  assert.deepEqual(result.sanitizeImpact, {
    inputMessages: 2,
    outputMessages: 1,
    removedMessages: 1,
    removedMessageRatio: 0.5,
    inputBlocks: 2,
    outputBlocks: 1,
    removedBlocks: 1,
    removedBlockRatio: 0.5,
    inputTextChars: 3,
    outputTextChars: 5,
    removedTextChars: 0,
    removedTextCharRatio: 0,
    inputRoles: { assistant: 1, user: 1 },
    outputRoles: { user: 1 },
    removedRoles: ['assistant'],
    removedRoleCount: 1,
    inputContentBlocks: 2,
    outputContentBlocks: 1,
    removedContentBlocks: 1,
    removedContentBlockRatio: 0.5,
    inputContentTextChars: 5,
    outputContentTextChars: 2,
    removedContentTextChars: 3,
    removedContentTextCharRatio: 0.6,
    inputTotalBlocks: 4,
    outputTotalBlocks: 2,
    removedTotalBlocks: 2,
    removedTotalBlockRatio: 0.5,
    inputTotalTextChars: 8,
    outputTotalTextChars: 7,
    removedTotalTextChars: 1,
    removedTotalTextCharRatio: 0.125,
  });
});
