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

### `runPreflightGuards(payload, { provider, keepEmptyMessages, profileMode })`
Runs default sanitization (`content` + `messages`) plus global/provider hooks.
Provider profile normalization applies to both top-level `content` and `messages[*].content` by default.
Use `profileMode: "off"` to disable provider profile normalization in preflight.

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

## Test

```bash
cd packages/sanitize
npm test
```
