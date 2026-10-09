import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createNewBeingMcpServer } from "./tools.js";

const handle = serveStdio(createNewBeingMcpServer);

process.on("SIGINT", () => {
  void handle.close();
});
process.on("SIGTERM", () => {
  void handle.close();
});
