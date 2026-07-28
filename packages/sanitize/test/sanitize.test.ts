import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPreflightGuards,
  mergeAdjacentTextBlocks,
  normalizeContentBlocks,
  registerPreflightGuard,
  removeEmptyTextBlocks,
  runPreflightGuards,
  sanitizeMessages,
  summarizePayloadImpact,
  summarizeSanitizeImpact,
} from "../src/index.ts";

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
      content: [{ type: "text", text: "  " }, "Need a safer fallback plan"],
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

  assert.deepEqual(openaiMessages, [{ role: "user", content: [{ type: "text", text: "hello" }] }]);

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

  assert.deepEqual(messages, [{ role: "user", content: [{ type: "input_text", text: "hello" }] }]);
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
      content: [{ type: "text", text: "   " }, "hello"],
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
      messages: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
    },
    { provider: "openai" },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "hello" }]);
  assert.deepEqual(result.messages, [{ role: "user", content: [{ type: "text", text: "hello" }] }]);
});

test("runPreflightGuards keeps original provider block types when profileMode is off", () => {
  clearPreflightGuards();

  const result = runPreflightGuards(
    {
      content: [{ type: "input_text", text: "hello" }],
      messages: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
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
      messages: [{ role: "user", content: ["left", "right"] }],
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
      messages: [{ role: "user", content: ["  left", "right  "] }],
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
      messages: [{ role: "user", content: ["left   ", "   right"] }],
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
      messages: [{ role: "user", content: ["1234567"] }],
    },
    { maxTextLength: 4 },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "abcd" }]);
  assert.deepEqual(result.messages, [{ role: "user", content: [{ type: "text", text: "1234" }] }]);
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

  assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "one" }] }]);
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
    {
      role: "user",
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    },
  ]);
});

test("sanitizeMessages caps the raw message prefix before normalization without backfilling", () => {
  const input = [
    { role: "empty", content: ["   "] },
    { role: "first", content: ["abc"] },
    { role: "second", content: [{ type: "tool_result", data: { ok: true } }] },
  ];

  assert.deepEqual(sanitizeMessages(input, { maxMessageCount: 1 }), []);
  assert.deepEqual(sanitizeMessages(input, { maxMessageCount: 2 }), [
    { role: "first", content: [{ type: "text", text: "abc" }] },
  ]);

  assert.deepEqual(
    sanitizeMessages(input, {
      maxMessageCount: 2,
      maxTotalTextChars: 0,
    }),
    [],
    "the second sanitized message must not backfill a prefixed message emptied by the budget",
  );
});

test("aggregate input gates stop before reading content or messages beyond their limits", () => {
  const content: unknown[] = ["one", "two", "unreachable"];
  Object.defineProperty(content, 2, {
    get: () => {
      throw new Error("content beyond maxTotalBlockCount was read");
    },
  });

  assert.deepEqual(sanitizeMessages([{ role: "user", content }], { maxTotalBlockCount: 2 }), [
    {
      role: "user",
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    },
  ]);

  const messages: unknown[] = [{ role: "user", content: ["first"] }, "unreachable"];
  Object.defineProperty(messages, 1, {
    get: () => {
      throw new Error("message beyond maxMessageCount was read");
    },
  });

  assert.deepEqual(sanitizeMessages(messages, { maxMessageCount: 1 }), [
    { role: "user", content: [{ type: "text", text: "first" }] },
  ]);
});

test("includeImpact summarizes only the bounded input prefix", () => {
  const content: unknown[] = ["one", "two", "unreachable"];
  Object.defineProperty(content, 2, {
    get: () => {
      throw new Error("impact accounting read beyond maxTotalBlockCount");
    },
  });

  const result = runPreflightGuards({ content }, { maxTotalBlockCount: 2, includeImpact: true });
  const impact = result.sanitizeImpact as {
    inputContentBlocks: number;
    inputMetricsTruncated?: boolean;
  };

  assert.equal(impact.inputContentBlocks, 2);
  assert.equal(impact.inputMetricsTruncated, true);
});

test("sanitizeMessages enforces a total block budget across messages", () => {
  const result = sanitizeMessages(
    [
      {
        role: "first",
        content: ["alpha", { type: "tool_result", data: { ok: true } }],
      },
      { role: "second", content: ["beta"] },
    ],
    { maxTotalBlockCount: 2 },
  );

  assert.deepEqual(result, [
    {
      role: "first",
      content: [
        { type: "text", text: "alpha" },
        { type: "tool_result", data: { ok: true } },
      ],
    },
  ]);
});

test("sanitizeMessages enforces a total UTF-16 text budget in traversal order", () => {
  const result = sanitizeMessages(
    [
      { role: "first", content: ["abc"] },
      { role: "second", content: ["def"] },
    ],
    { maxTotalTextChars: 4 },
  );

  assert.deepEqual(result, [
    { role: "first", content: [{ type: "text", text: "abc" }] },
    { role: "second", content: [{ type: "text", text: "d" }] },
  ]);
});

test("aggregate caps compose with merge, per-block text, and per-list block caps", () => {
  const result = sanitizeMessages(
    [
      {
        role: "user",
        content: ["ab", "cd", { type: "tool_result", data: { ok: true } }],
      },
    ],
    {
      mergeAdjacentText: true,
      maxTextLength: 3,
      maxBlockCount: 1,
      maxTotalTextChars: 2,
    },
  );

  assert.deepEqual(result, [
    {
      role: "user",
      content: [{ type: "text", text: "ab" }],
    },
  ]);
});

test("merge construction shares the total text budget across payload content and messages", () => {
  const result = runPreflightGuards(
    {
      content: ["a", "b"],
      messages: [{ role: "user", content: ["c", "d"] }],
    },
    {
      mergeAdjacentText: true,
      mergeSeparator: "x".repeat(100_000),
      maxTotalTextChars: 8,
    },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "axxxxxxx" }]);
  assert.deepEqual(result.messages, []);
});

test("aggregate zero limits are valid and text exhaustion still permits non-text blocks", () => {
  const input = [
    {
      role: "user",
      content: [
        "text",
        { type: "tool_result", data: { ok: true } },
        "tail",
        { type: "image", url: "https://example.com/x.png" },
      ],
    },
  ];

  assert.deepEqual(sanitizeMessages(input, { maxMessageCount: 0 }), []);
  assert.deepEqual(sanitizeMessages(input, { maxTotalBlockCount: 0 }), []);
  assert.deepEqual(sanitizeMessages(input, { maxTotalTextChars: 0 }), [
    {
      role: "user",
      content: [
        { type: "tool_result", data: { ok: true } },
        { type: "image", url: "https://example.com/x.png" },
      ],
    },
  ]);
});

test("aggregate text truncation never emits a lone surrogate", () => {
  const result = sanitizeMessages(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "😀tail" },
          { type: "tool_result", data: { ok: true } },
        ],
      },
    ],
    { maxTotalTextChars: 1 },
  );

  assert.deepEqual(result, [
    {
      role: "user",
      content: [{ type: "tool_result", data: { ok: true } }],
    },
  ]);
});

test("aggregate text budgets include provider-specific blocks with a string text field", () => {
  const result = sanitizeMessages(
    [
      {
        role: "user",
        content: [
          { type: "input_text", text: "abcdef" },
          { type: "tool_result", data: { ok: true } },
        ],
      },
    ],
    { profileMode: "off", maxTotalTextChars: 3 },
  );

  assert.deepEqual(result, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "abc" },
        { type: "tool_result", data: { ok: true } },
      ],
    },
  ]);
});

test("aggregate caps preserve emptied messages only when requested", () => {
  const input = [
    { role: "first", content: ["abc"] },
    { role: "second", content: [{ type: "tool_result", data: { ok: true } }] },
  ];

  assert.deepEqual(sanitizeMessages(input, { maxTotalBlockCount: 0, keepEmptyMessages: true }), [
    { role: "first", content: [] },
    { role: "second", content: [] },
  ]);
  assert.deepEqual(sanitizeMessages(input, { maxTotalBlockCount: 0 }), []);
});

test("runPreflightGuards shares aggregate budgets from top-level content into messages", () => {
  const result = runPreflightGuards(
    {
      content: ["abcd", { type: "image", url: "https://example.com/top.png" }],
      messages: [
        {
          role: "user",
          content: ["1234", { type: "tool_result", data: { ok: true } }],
        },
        { role: "assistant", content: ["later"] },
      ],
    },
    {
      maxMessageCount: 2,
      maxTotalBlockCount: 4,
      maxTotalTextChars: 6,
    },
  );

  assert.deepEqual(result.content, [
    { type: "text", text: "abcd" },
    { type: "image", url: "https://example.com/top.png" },
  ]);
  assert.deepEqual(result.messages, [
    {
      role: "user",
      content: [
        { type: "text", text: "12" },
        { type: "tool_result", data: { ok: true } },
      ],
    },
  ]);
});

test("invalid aggregate limits are unlimited and omitted options preserve output", () => {
  const input = [
    { role: "first", content: ["alpha", { type: "tool_result", data: { ok: true } }] },
    { role: "second", content: ["beta"] },
  ];
  const baseline = sanitizeMessages(input);

  assert.deepEqual(
    sanitizeMessages(input, {
      maxMessageCount: -1,
      maxTotalBlockCount: 1.5,
      maxTotalTextChars: Number.NaN,
    }),
    baseline,
  );
  assert.deepEqual(sanitizeMessages(input, {}), baseline);
});

test("runPreflightGuards reapplies aggregate limits after every accepted hook", (t) => {
  clearPreflightGuards();
  t.after(clearPreflightGuards);
  let blocksSeenBySecondHook = -1;

  registerPreflightGuard("*", ({ payload }) => ({
    ...payload,
    content: [
      { type: "text", text: "abcdef" },
      { type: "tool_result", data: { source: "hook" } },
    ],
    messages: [
      {
        role: "first",
        content: [
          { type: "text", text: "ghij" },
          { type: "tool_result", data: { ok: true } },
        ],
      },
      { role: "second", content: [{ type: "image", url: "https://example.com/x.png" }] },
    ],
  }));
  registerPreflightGuard("*", ({ payload }) => {
    blocksSeenBySecondHook =
      payload.content.length +
      (payload.messages ?? []).reduce((sum, message) => sum + message.content.length, 0);
  });

  const result = runPreflightGuards(
    { content: ["initial"], messages: [{ role: "initial", content: ["message"] }] },
    {
      maxMessageCount: 1,
      maxTotalBlockCount: 3,
      maxTotalTextChars: 5,
    },
  );

  assert.equal(blocksSeenBySecondHook, 3);
  assert.deepEqual(result.content, [
    { type: "text", text: "abcde" },
    { type: "tool_result", data: { source: "hook" } },
  ]);
  assert.deepEqual(result.messages, [
    {
      role: "first",
      content: [{ type: "tool_result", data: { ok: true } }],
    },
  ]);
});

test("runPreflightGuards caps in-place hook mutations before the next hook", (t) => {
  clearPreflightGuards();
  t.after(clearPreflightGuards);
  let blocksSeenByProviderHook = -1;

  registerPreflightGuard("*", ({ payload }) => {
    payload.content.push({ type: "text", text: "inflated" });
    payload.messages?.push({
      role: "hook",
      content: [{ type: "tool_result", data: { source: "hook" } }],
    });
  });
  registerPreflightGuard("openai", ({ payload }) => {
    blocksSeenByProviderHook =
      payload.content.length +
      (payload.messages ?? []).reduce((sum, message) => sum + message.content.length, 0);
  });

  const result = runPreflightGuards(
    { content: ["a"], messages: [{ role: "user", content: ["b"] }] },
    { provider: "openai", maxTotalBlockCount: 1 },
  );

  assert.equal(blocksSeenByProviderHook, 1);
  assert.deepEqual(result.content, [{ type: "text", text: "a" }]);
  assert.deepEqual(result.messages, []);
});

test("runPreflightGuards normalizes non-array hook messages when a resource cap is active", (t) => {
  clearPreflightGuards();
  t.after(clearPreflightGuards);

  registerPreflightGuard(
    "*",
    ({ payload }) =>
      ({
        ...payload,
        messages: "not-an-array",
      }) as unknown as typeof payload,
  );

  const result = runPreflightGuards(
    { content: ["safe"], messages: [{ role: "user", content: ["message"] }] },
    { maxMessageCount: 1 },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "safe" }]);
  assert.deepEqual(result.messages, []);
});

test("runPreflightGuards computes impact from the final capped hook output", (t) => {
  clearPreflightGuards();
  t.after(clearPreflightGuards);

  registerPreflightGuard("*", ({ payload }) => ({
    ...payload,
    content: [...payload.content, { type: "tool_result", data: { source: "hook" } }],
  }));

  const result = runPreflightGuards(
    {
      content: ["abcd"],
      messages: [{ role: "user", content: ["efgh"] }],
    },
    {
      maxTotalBlockCount: 2,
      maxTotalTextChars: 5,
      includeImpact: true,
    },
  );

  assert.deepEqual(result.content, [
    { type: "text", text: "abcd" },
    { type: "tool_result", data: { source: "hook" } },
  ]);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(
    {
      outputMessages: (result.sanitizeImpact as { outputMessages: number }).outputMessages,
      outputBlocks: (result.sanitizeImpact as { outputBlocks: number }).outputBlocks,
      outputContentBlocks: (result.sanitizeImpact as { outputContentBlocks: number })
        .outputContentBlocks,
      outputTotalBlocks: (result.sanitizeImpact as { outputTotalBlocks: number }).outputTotalBlocks,
      outputTotalTextChars: (result.sanitizeImpact as { outputTotalTextChars: number })
        .outputTotalTextChars,
    },
    {
      outputMessages: 0,
      outputBlocks: 0,
      outputContentBlocks: 2,
      outputTotalBlocks: 2,
      outputTotalTextChars: 4,
    },
  );
});

test("sanitizeMessages handles large message arrays deterministically", () => {
  const messages = Array.from({ length: 1000 }, (_, idx) => ({
    role: "user",
    content:
      idx % 2 === 0
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

  assert.deepEqual(basic, [{ role: "user", content: [{ type: "text", text: "hello" }] }]);

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
    inputTextChars: 8,
    outputTextChars: 5,
    removedTextChars: 3,
    removedTextCharRatio: 0.375,
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
    inputTextChars: 8,
    outputTextChars: 5,
    removedTextChars: 3,
    removedTextCharRatio: 0.375,
    inputRoles: { assistant: 1, user: 1 },
    outputRoles: { user: 1 },
    removedRoles: ["assistant"],
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
    inputTotalTextChars: 16,
    outputTotalTextChars: 10,
    removedTotalTextChars: 6,
    removedTotalTextCharRatio: 0.375,
  });
});

test("sanitizeMessages can strip control characters when enabled", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "user",
        content: [{ type: "text", text: "hello\u0000\u0007world" }],
      },
    ],
    { stripControlChars: true },
  );

  assert.deepEqual(messages, [
    {
      role: "user",
      content: [{ type: "text", text: "helloworld" }],
    },
  ]);
});

test("runPreflightGuards strips control characters in top-level content", () => {
  const result = runPreflightGuards(
    {
      content: [{ type: "text", text: "a\u0000b\u0007c" }],
      messages: [{ role: "user", content: ["ok"] }],
    },
    { stripControlChars: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "abc" }]);
});

test("sanitizeMessages can strip ANSI escape codes when enabled", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "assistant",
        content: [{ type: "text", text: "\u001b[31merror\u001b[0m: failed" }],
      },
    ],
    { stripAnsiEscapes: true },
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: [{ type: "text", text: "error: failed" }],
    },
  ]);
});

test("runPreflightGuards strips ANSI escape codes in top-level content", () => {
  const result = runPreflightGuards(
    {
      content: [{ type: "text", text: "\u001b[32msuccess\u001b[0m" }],
      messages: [{ role: "user", content: ["ok"] }],
    },
    { stripAnsiEscapes: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "success" }]);
});

test("sanitizeMessages can strip HTML tags when enabled", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "assistant",
        content: [{ type: "text", text: "<b>alert</b> <i>now</i>" }],
      },
    ],
    { stripHtmlTags: true },
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: [{ type: "text", text: "alert now" }],
    },
  ]);
});

test("runPreflightGuards strips HTML tags in top-level content", () => {
  const result = runPreflightGuards(
    {
      content: [{ type: "text", text: "<span>ok</span>" }],
      messages: [{ role: "user", content: ["ok"] }],
    },
    { stripHtmlTags: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "ok" }]);
});

test("sanitizeMessages can strip markdown links when enabled", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "assistant",
        content: [{ type: "text", text: "See [docs](https://example.com/docs) now" }],
      },
    ],
    { stripMarkdownLinks: true },
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: [{ type: "text", text: "See docs now" }],
    },
  ]);
});

test("runPreflightGuards strips markdown links in top-level content", () => {
  const result = runPreflightGuards(
    {
      content: [{ type: "text", text: "Open [guide](https://example.com/guide)" }],
      messages: [{ role: "user", content: ["ok"] }],
    },
    { stripMarkdownLinks: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: "Open guide" }]);
});

test("sanitizeMessages can strip markdown images when enabled", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "assistant",
        content: [{ type: "text", text: "Look ![alt](https://example.com/x.png) now" }],
      },
    ],
    { stripMarkdownImages: true },
  );

  assert.deepEqual(messages, [
    {
      role: "assistant",
      content: [{ type: "text", text: "Look  now" }],
    },
  ]);
});

test("runPreflightGuards strips markdown images in top-level content", () => {
  const result = runPreflightGuards(
    {
      content: [{ type: "text", text: "![preview](https://example.com/p.png) Done" }],
      messages: [{ role: "user", content: ["ok"] }],
    },
    { stripMarkdownImages: true },
  );

  assert.deepEqual(result.content, [{ type: "text", text: " Done" }]);
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
    inputTextChars: 8,
    outputTextChars: 5,
    removedTextChars: 3,
    removedTextCharRatio: 0.375,
    inputRoles: { assistant: 1, user: 1 },
    outputRoles: { user: 1 },
    removedRoles: ["assistant"],
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
    inputTotalTextChars: 13,
    outputTotalTextChars: 7,
    removedTotalTextChars: 6,
    removedTotalTextCharRatio: 0.462,
  });
});

test("runPreflightGuards runs a global hook exactly once when no provider is set", () => {
  clearPreflightGuards();
  let calls = 0;
  registerPreflightGuard("*", ({ payload }) => {
    calls += 1;
    return payload;
  });

  runPreflightGuards({ content: ["hello"] });
  assert.equal(calls, 1);

  clearPreflightGuards();
});

test("runPreflightGuards runs global then provider hooks once each", () => {
  clearPreflightGuards();
  const order: string[] = [];
  registerPreflightGuard("*", ({ payload }) => {
    order.push("global");
    return payload;
  });
  registerPreflightGuard("openai", ({ payload }) => {
    order.push("openai");
    return payload;
  });

  runPreflightGuards({ content: ["hello"] }, { provider: "openai" });
  assert.deepEqual(order, ["global", "openai"]);

  clearPreflightGuards();
});

test("mergeAdjacentTextBlocks does not mutate the input blocks", () => {
  const input = [
    { type: "text", text: "a" },
    { type: "text", text: "b" },
  ];
  const before = structuredClone(input);

  const merged = mergeAdjacentTextBlocks(input);

  assert.deepEqual(input, before, "input array must be untouched");
  assert.deepEqual(merged, [{ type: "text", text: "a\nb" }]);
});

test("sanitizeMessages merge does not mutate the caller's message content", () => {
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: "x" },
        { type: "text", text: "y" },
      ],
    },
  ];
  const before = structuredClone(messages);

  sanitizeMessages(messages, { mergeAdjacentText: true });

  assert.deepEqual(messages, before);
});

test("stripping markdown links and images together removes images fully", () => {
  const messages = sanitizeMessages(
    [
      {
        role: "user",
        content: [{ type: "text", text: "see ![alt](http://x/y.png) and [d](http://x/d)" }],
      },
    ],
    { stripMarkdownLinks: true, stripMarkdownImages: true },
  );

  assert.deepEqual(messages, [{ role: "user", content: [{ type: "text", text: "see  and d" }] }]);
});

test("maxTextLength never splits a surrogate pair into a lone surrogate", () => {
  // The emoji is 2 code units and cannot fit in 1 → dropped, no lone surrogate.
  const dropped = sanitizeMessages(
    [{ role: "user", content: [{ type: "text", text: "😀tail" }] }],
    { maxTextLength: 1, keepEmptyMessages: true },
  );
  assert.deepEqual(dropped, [{ role: "user", content: [] }]);

  // At width 2 the whole pair fits and survives intact (not a lone surrogate).
  const kept = sanitizeMessages([{ role: "user", content: [{ type: "text", text: "😀tail" }] }], {
    maxTextLength: 2,
  });
  assert.deepEqual(kept, [{ role: "user", content: [{ type: "text", text: "😀" }] }]);
});
