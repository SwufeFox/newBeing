import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = new Client({ name: "newbeing-mcp-smoke", version: "0.1.0" });
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const serverPath = fileURLToPath(new URL("./server.ts", import.meta.url));
const dataDirectory = mkdtempSync(path.join(tmpdir(), "newbeing-mcp-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", serverPath],
  cwd: `${projectRoot}/packages/mcp`,
  env: {
    PATH: process.env.PATH ?? "",
    NODE_ENV: "test",
    NEWBEING_DATA_DIR: dataDirectory,
  },
  stderr: "inherit",
});

function readPayload(result: Awaited<ReturnType<typeof client.callTool>>): Record<string, unknown> {
  if (result.isError) throw new Error("MCP tool invocation returned an error.");
  const text = result.content.find((item) => item.type === "text");
  if (!text || text.type !== "text") throw new Error("MCP tool invocation returned no text payload.");
  return JSON.parse(text.text) as Record<string, unknown>;
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  const required = ["get_workspace_context", "get_market_data", "run_backtest", "prepare_order"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length > 0) throw new Error(`MCP tool registration missing: ${missing.join(", ")}`);
  const context = readPayload(await client.callTool({ name: "get_workspace_context", arguments: {} }));
  if (!context.state) throw new Error("MCP workspace context tool returned no workspace state.");
  const strategies = readPayload(await client.callTool({ name: "list_strategies", arguments: {} }));
  if (!Array.isArray(strategies.strategies) || strategies.strategies.length === 0) throw new Error("MCP list_strategies tool returned no strategies.");
  const strategyId = `custom-mcp-smoke-${Date.now().toString(36)}`;
  const created = readPayload(await client.callTool({
    name: "create_strategy",
    arguments: { id: strategyId, name: "MCP smoke draft", description: "Isolated stdio smoke test", parameters: {}, source: "// smoke draft; intentionally not executable" },
  }));
  if (created.executable !== false) throw new Error("MCP create_strategy incorrectly marked a source draft executable.");
  const fetched = readPayload(await client.callTool({ name: "get_strategy", arguments: { strategy_id: strategyId } }));
  if (fetched.executable !== false) throw new Error("MCP get_strategy did not return the saved draft as non-executable.");
  console.error(JSON.stringify({
    status: "ok",
    transport: "official SDK stdio client",
    toolCount: names.length,
    invocations: ["get_workspace_context", "list_strategies", "create_strategy", "get_strategy"],
    isolatedDatabase: true,
  }));
} finally {
  await client.close();
  rmSync(dataDirectory, { recursive: true, force: true });
}
