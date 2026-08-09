import "../_core/loadEnv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getMcpUserContext } from "./auth";
import { registerMcpTools } from "./tools";

const main = async () => {
  const user = await getMcpUserContext();
  const server = new McpServer({
    name: "customer-service-agent",
    version: "1.0.0",
  });

  registerMcpTools(server, user);

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch(error => {
  console.error("[MCP] Failed to start:", error);
  process.exit(1);
});

