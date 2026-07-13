# ARK + Model Context Protocol (MCP)

ARK integrates with the [Model Context Protocol](https://modelcontextprotocol.io)
in two complementary ways.

## 1. ARK as an MCP server (pull)

Expose ARK's primitives as MCP **tools** so any host or agent can call them at
runtime — sanitize a payload before sending it, classify a failure, or ask for a
recovery decision. See [`examples/mcp-server`](../examples/mcp-server) for a
runnable server built on `@modelcontextprotocol/sdk` that registers:

| Tool           | Input                                    | Output                                  |
| -------------- | ---------------------------------------- | --------------------------------------- |
| `ark_sanitize` | `{ payload, options? }`                  | sanitized payload                       |
| `ark_classify` | `{ event }`                              | `Classification`                        |
| `ark_policy`   | `{ classification, context?, config? }`  | `PolicyDecision`                        |
| `ark_triage`   | `{ event, context?, config? }`           | classification + decision + report      |

```bash
pnpm --filter @ark/example-mcp-server build
node examples/mcp-server/dist/index.mjs   # speaks MCP over stdio
```

## 2. ARK as a transport interceptor (push)

Wrap the MCP SDK's client/server transport to observe every `tools/call`
request/response and JSON-RPC error, project it into an ARK `RuntimeEvent`
(session/turn, provider/model, request/response envelope, error payload), and
run it through `classify → policy → report`. This gives you the observability and
audit trail the MCP roadmap calls out as an under-served enterprise gap — without
the agent having to call ARK explicitly.

## Version & compatibility notes (mid-2026)

- Target the current stable spec revision **2025-11-25**; pin
  `@modelcontextprotocol/sdk@^1.29.0`.
- A **stateless** protocol core lands with the 2026-07-28 revision (no
  `initialize` handshake, no `Mcp-Session-Id`; client context moves into
  per-request `_meta`). Keep interceptors session-agnostic and attach ARK
  correlation/trace ids via `_meta` so they survive that migration.
- Do **not** build ARK observability on MCP's own `logging` utility — it is
  deprecated in the 2026-07-28 RC (alongside Roots and Sampling). Emit
  OpenTelemetry-style traces/artifacts instead (see [`@ark/core`](../packages/core/README.md)
  `toGenAIAttributes`).
- The SDK v2 beta (`@modelcontextprotocol/server` / `@modelcontextprotocol/client`)
  splits the monolith and adds Express/Fastify/Hono/Node adapters — natural
  interception seams once it reaches GA.
