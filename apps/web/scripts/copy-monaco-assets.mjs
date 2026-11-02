import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let directory = dirname(require.resolve("monaco-editor"));
while (!existsSync(join(directory, "min", "vs", "loader.js"))) {
  const parent = dirname(directory);
  if (parent === directory) throw new Error("Could not locate local monaco-editor/min/vs assets.");
  directory = parent;
}

let version;
try {
  version = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version;
} catch {
  throw new Error(`Could not read the monaco-editor version from ${join(directory, "package.json")}.`);
}
if (typeof version !== "string" || version.length === 0) {
  throw new Error("The resolved monaco-editor package.json carries no version.");
}

const destination = resolve("public/monaco/vs");
const marker = join(destination, ".copy-meta.json");
mkdirSync(dirname(destination), { recursive: true });

let copiedVersion;
try {
  copiedVersion = JSON.parse(readFileSync(marker, "utf8")).version;
} catch {
  copiedVersion = undefined;
}
if (copiedVersion === version && existsSync(join(destination, "loader.js"))) {
  console.log(`Monaco ${version} assets are already up to date at ${destination}`);
} else {
  rmSync(destination, { recursive: true, force: true });
  cpSync(join(directory, "min", "vs"), destination, { recursive: true });
  writeFileSync(marker, `${JSON.stringify({ version }, null, 2)}\n`);
  console.log(`Copied local Monaco loader assets to ${destination}`);
}
