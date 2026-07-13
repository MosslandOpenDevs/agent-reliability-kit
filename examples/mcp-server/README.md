# @ark/example-mcp-server

A runnable [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the Agent Reliability Kit as tools. It is a **workspace example**, not a
published package.

## Tools

- `ark_sanitize` — normalize/preflight-clean a provider request payload.
- `ark_classify` — classify a runtime event (`incidentReason`, `riskTier`, `confidence`).
- `ark_policy` — turn a classification into a retry/fallback/fail-fast decision.
- `ark_triage` — end-to-end: classify → decide policy → build an incident report.

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

See [`docs/MCP.md`](../../docs/MCP.md) for the server-vs-interceptor integration
patterns and version notes.
