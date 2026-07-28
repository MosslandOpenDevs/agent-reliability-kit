/** Stdio entry point for the side-effect-free server factory in `server.ts`. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createArkMcpServer } from "./server.ts";

async function main(): Promise<void> {
  const server = createArkMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ark-mcp-server listening on stdio");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
