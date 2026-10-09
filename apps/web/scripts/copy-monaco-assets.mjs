import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let directory = dirname(require.resolve("monaco-editor"));
while (!existsSync(join(directory, "min", "vs", "loader.js"))) {
  const parent = dirname(directory);
  if (parent === directory) throw new Error("Could not locate local monaco-editor/min/vs assets.");
  directory = parent;
}
const destination = resolve("public/monaco/vs");
mkdirSync(dirname(destination), { recursive: true });
cpSync(join(directory, "min", "vs"), destination, { recursive: true });
console.log(`Copied local Monaco loader assets to ${destination}`);
