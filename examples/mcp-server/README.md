# @ark/example-mcp-server

A runnable [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Agent Reliability Kit as tools. It is a **workspace example**, not a
published package. Tool inputs are advertised as JSON Schema and validated
against those same schemas at runtime before they reach an ARK package.

## Tools

- `ark_sanitize` — normalize/preflight-clean a provider request payload.
- `ark_classify` — classify a runtime event (`incidentReason`, `riskTier`, `confidence`).
- `ark_policy` — turn a classification into a retry/fallback/fail-fast decision.
- `ark_triage` — end-to-end: classify → decide policy → build an incident report.

Malformed arguments return an MCP tool result with `isError: true`, including a
short schema-path explanation. The connection remains usable so an MCP host or
model can correct the call.

### Sanitize resource ceilings

`ark_sanitize` applies server-side ceilings even when the caller omits limit
options:

| Option               | Server ceiling |
| -------------------- | -------------: |
| `maxMessageCount`    |            256 |
| `maxTotalBlockCount` |          2,048 |
| `maxTotalTextChars`  |      1,000,000 |

Callers may set any ceiling to a lower non-negative integer, including zero, but
cannot raise it. `maxTotalTextChars` counts UTF-16 code units. The sanitizer
gates known top-level `content` and `messages` before transforms and reapplies
the limits to normalized output. They are not a raw stdio/JSON-RPC byte limit
and do not recursively constrain opaque provider-specific fields that the
payload preserves. Remote `mergeSeparator` values are additionally limited to
1,024 Unicode characters.

## Run

```bash
pnpm install
pnpm --filter @ark/example-mcp-server build
node examples/mcp-server/dist/index.mjs   # speaks MCP over stdio
```

Point any MCP host (Claude Desktop, an agent framework, an IDE) at that command,
or drive it directly with JSON-RPC over stdio:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ark_triage","arguments":{"event":{"timestamp":"2026-07-13T00:00:00Z","app":"demo","phase":"error","provider":"openai","error":{"type":"RateLimitError","status":429}}}}}' \
  | node examples/mcp-server/dist/index.mjs
```

## Test

```bash
pnpm --filter @ark/example-mcp-server test
```

The suite connects a real MCP client and server through the SDK's in-memory
transport, exercises all four tools, and verifies schema failures and resource
ceilings without starting a subprocess.

See [`docs/MCP.md`](../../docs/MCP.md) for the server-vs-interceptor integration
patterns and version notes.
