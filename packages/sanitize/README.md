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

### `sanitizeMessages(messages, { keepEmptyMessages, provider, profileMode })`
Normalizes message arrays and removes messages that become empty after sanitization.
Set `keepEmptyMessages: true` to preserve empty turns when downstream consumers require positional alignment.
Set `provider` to apply lightweight provider-profile normalization (e.g., `input_text -> text` for OpenAI shape, `image_url -> image.source.url` for Anthropic shape).
Set `profileMode: "off"` to disable provider normalization and keep original block types.

### `registerPreflightGuard(provider, hook)`
Registers preflight hooks by provider name. Use `"*"` for global hooks.

### `runPreflightGuards(payload, { provider, keepEmptyMessages, profileMode, includeImpact })`
Runs default sanitization (`content` + `messages`) plus global/provider hooks.
Provider profile normalization applies to both top-level `content` and `messages[*].content` by default.
Use `profileMode: "off"` to disable provider profile normalization in preflight.
Set `includeImpact: true` to append `sanitizeImpact` counters to the returned payload.

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
- `maxBlockCount` truncates from the front of the block list, which can split a
  logically paired `tool_call` / `tool_result`. Cap with that in mind.
- Provider profiles (`provider: "openai" | "anthropic"`) are lightweight,
  best-effort block-shape adjustments, not a complete provider translation
  layer — content-type mapping can depend on endpoint and role.
- Transform functions are pure (they never mutate the input), and `maxTextLength`
  truncates on UTF-16 boundaries without producing lone surrogates.

## Test

```bash
pnpm --filter @ark/sanitize test
```

Test suite includes provider profile behavior, profileMode bypass, option-matrix determinism, mixed multimodal normalization, and large-message deterministic sanitization.
