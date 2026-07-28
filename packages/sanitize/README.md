# @ark/sanitize

Sanitization module for provider payload safety.

## Scope (v0.1.0)
- Remove empty/whitespace-only text blocks
- Normalize content block arrays
- Provider-aware preflight checks
- Message-array sanitization (`messages[]`) with empty-turn pruning

## API

### `removeEmptyTextBlocks(blocks)`
Removes content blocks where `type === "text"` and `text` is empty/whitespace-only.

### `normalizeContentBlocks(content)`
Normalizes content into provider-friendly block arrays.

- `string` -> `[{ type: "text", text: string }]`
- `Array<string | object>` -> object blocks (strings become text blocks)
- unsupported values -> `[]`

### `sanitizeMessages(messages, options)`
Normalizes message arrays and removes messages that become empty after sanitization.
Set `keepEmptyMessages: true` to preserve empty turns when downstream consumers require positional alignment.
Set `provider` to apply lightweight provider-profile normalization (e.g., `input_text -> text` for OpenAI shape, `image_url -> image.source.url` for Anthropic shape).
Set `profileMode: "off"` to disable provider normalization and keep original block types.

### `registerPreflightGuard(provider, hook)`
Registers preflight hooks by provider name. Use `"*"` for global hooks.

### `runPreflightGuards(payload, options)`
Runs default sanitization (`content` + `messages`) plus global/provider hooks.
Provider profile normalization applies to both top-level `content` and `messages[*].content` by default.
Use `profileMode: "off"` to disable provider profile normalization in preflight.
Set `includeImpact: true` to append `sanitizeImpact` counters to the returned payload.

### Resource limits

Both sanitization entry points accept deterministic, opt-in aggregate limits:

- `maxMessageCount` examines and retains at most that many raw messages as an
  ordered input prefix.
- `maxTotalBlockCount` caps content entries examined and normalized blocks
  retained across the whole traversal.
- `maxTotalTextChars` caps text processed and retained, in UTF-16 code units,
  across the whole traversal.

Each limit must be a non-negative integer; `0` is valid. An omitted or invalid
value is unlimited, preserving existing behavior.

Aggregate limits use two deterministic gates. Before normalization and regex
transforms, they take an ordered raw-input prefix so configured limits bound
sanitizer work. Every raw array entry consumes block budget even if later
normalization would discard it, and blocks with a string `text` field consume
text budget regardless of provider-specific `type`. After provider/text
transforms, merging, `maxTextLength`, and per-list `maxBlockCount`, the same
limits are reapplied to the normalized output:

- `sanitizeMessages` traverses messages, then each message's blocks, in input
  order.
- `runPreflightGuards` traverses top-level `content` first, then messages and
  their blocks.

The raw message prefix is selected before block/text gates, so a prefixed
message emptied by those gates is not backfilled. Empty messages are removed
unless `keepEmptyMessages` is enabled. Non-text blocks consume one block and no
text; text exhaustion does not prevent later non-text blocks from being
retained. Partial text uses surrogate-safe truncation and an empty normalized
text block is dropped without consuming output block budget.

Preflight reapplies aggregate limits after every hook invocation, including a
hook that mutates in place and returns nothing. When `includeImpact` is enabled,
the final counters describe the final capped hook output. If an input gate
truncated the raw payload, `sanitizeImpact.inputMetricsTruncated` is `true` and
input-side counters cover only the bounded prefix that was examined.

### `summarizeSanitizeImpact(originalMessages, sanitizedMessages)`
Returns deterministic counters (`inputMessages`, `outputMessages`, `removedMessages`, `outputBlocks`) for observability and regression checks.

### `summarizePayloadImpact(originalPayload, sanitizedPayload)`
Extends message-level counters with top-level content counters (`inputContentBlocks`, `outputContentBlocks`, `removedContentBlocks`).

### `clearPreflightGuards()`
Clears all registered hooks (useful for tests).

## Example

```js
import {
  runPreflightGuards,
  registerPreflightGuard,
} from "@ark/sanitize";

registerPreflightGuard("*", ({ payload }) => ({
  ...payload,
  source: "preflight",
}));

registerPreflightGuard("openai", ({ payload }) => ({
  ...payload,
  openaiSafe: true,
}));

const sanitized = runPreflightGuards(
  {
    content: [
      { type: "text", text: "   " },
      "hello world",
      { type: "image", url: "https://example.com/a.png" },
    ],
  },
  { provider: "openai" },
);

// sanitized.content => [
//   { type: "text", text: "hello world" },
//   { type: "image", url: "https://example.com/a.png" }
// ]
```

## Limitations

`@ark/sanitize` is a **normalization** layer, not a security boundary:

- `stripHtmlTags` is a regex tag remover for readability/normalization. It is
  **not** an HTML/XSS sanitizer — do not rely on it as a defense against markup
  injection. Use a real HTML sanitizer for untrusted rendering.
- `maxBlockCount` and `maxTotalBlockCount` truncate in traversal order, which
  can split a logically paired `tool_call` / `tool_result`. Cap with that in
  mind.
- Provider profiles (`provider: "openai" | "anthropic"`) are lightweight,
  best-effort block-shape adjustments, not a complete provider translation
  layer — content-type mapping can depend on endpoint and role.
- Transform functions are pure (they never mutate the input), and both
  `maxTextLength` and `maxTotalTextChars` truncate on UTF-16 boundaries without
  producing lone surrogates.

## Test

```bash
pnpm --filter @ark/sanitize test
```

Test suite includes provider profile behavior, profileMode bypass, option-matrix
determinism, aggregate resource limits, hook reapplication, mixed multimodal
normalization, and large-message deterministic sanitization.
