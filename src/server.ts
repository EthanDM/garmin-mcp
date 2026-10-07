import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getGarminConfig } from "./config.js";
import { formatErrorMessage } from "./errors.js";
import {
  GarminBridgeClient,
  BridgeProcessRunner
} from "./lib/garmin-bridge-client.js";
import { GarminClient } from "./lib/garmin.js";
import { createTools } from "./tools.js";

/** Startup validates executable configuration; auth is checked lazily and never prompts. */
async function main() {
  const runner = new BridgeProcessRunner(getGarminConfig());
  const server = new McpServer({ name: "garmin-mcp", version: "0.1.0" });
  for (const tool of createTools(
    new GarminClient(new GarminBridgeClient(runner.run))
  )) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations
      },
      tool.handler
    );
  }
  const shutdown = () => {
    runner.close();
    void server.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // EOF must also terminate outstanding bridge requests, not just signal shutdown.
  process.stdin.once("end", shutdown);
}
main().catch((error: unknown) => {
  console.error(formatErrorMessage(error));
  process.exitCode = 1;
});
