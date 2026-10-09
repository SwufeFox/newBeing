import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";

const client = new Client({ name: "newbeing-mcp-smoke", version: "0.1.0" });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", serverPath],
  cwd: `${projectRoot}/packages/mcp`,
  stderr: "inherit",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  const required = ["get_workspace_context", "get_market_data", "run_backtest", "prepare_order"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`MCP tool registration missing: ${missing.join(", ")}`);
  const context = await client.callTool({ name: "get_workspace_context", arguments: {} });
  if (context.isError) throw new Error("MCP workspace context read returned an error.");
  console.error(JSON.stringify({ status: "ok", transport: "official SDK stdio client", toolCount: names.length, tools: names }));
} finally {
  await client.close();
}
