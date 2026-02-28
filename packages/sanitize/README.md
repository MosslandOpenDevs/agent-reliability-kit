# @ark/sanitize

Sanitization module for provider payload safety.

## Scope (v0.1.0)
- Remove empty/whitespace-only text blocks
- Normalize content block arrays
- Provider-aware preflight checks

## API

### `removeEmptyTextBlocks(blocks)`
Removes content blocks where `type === "text"` and `text` is empty/whitespace-only.

### `normalizeContentBlocks(content)`
Normalizes content into provider-friendly block arrays.

- `string` -> `[{ type: "text", text: string }]`
- `Array<string | object>` -> object blocks (strings become text blocks)
- unsupported values -> `[]`

### `registerPreflightGuard(provider, hook)`
Registers preflight hooks by provider name. Use `"*"` for global hooks.

### `runPreflightGuards(payload, { provider })`
Runs default sanitization plus global/provider hooks.

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
