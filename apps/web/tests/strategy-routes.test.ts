import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabaseForTests } from "@newbeing/storage";
import { GET as listStrategies, POST as saveDraft } from "../src/app/api/strategies/route.js";
import { GET as getStrategy } from "../src/app/api/strategies/[id]/route.js";

const source = "export function signalAt() { return 'long'; } // research only";
let directory: string;
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://localhost/api/strategies", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  closeDatabaseForTests();
  directory = mkdtempSync(path.join(tmpdir(), "newbeing-strategy-routes-"));
  process.env.NEWBEING_DATA_DIR = directory;
});
afterEach(() => {
  closeDatabaseForTests();
  delete process.env.NEWBEING_DATA_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe("strategy draft HTTP contracts", () => {
  it("keeps the roster small and serves the saved source only by ID", async () => {
    const created = await saveDraft(post({
      id: "custom-source-test", name: "Source test", description: "draft", parameters: { period: 14 }, source,
    }));
    expect(created.status).toBe(201);
    expect((await created.json()).strategy.source).toBe(source);

    const list = await listStrategies();
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    const items = (await list.json()).items as Array<Record<string, unknown>>;
    const saved = items.find((item) => item.id === "custom-source-test");
    expect(saved).toMatchObject({ name: "Source test", version: "draft", parameters: { period: 14 }, builtIn: false });
    expect(saved).not.toHaveProperty("source");

    const detail = await getStrategy(new Request("http://localhost/api/strategies/custom-source-test"), context("custom-source-test"));
    expect(detail.status).toBe(200);
    expect(detail.headers.get("Cache-Control")).toBe("no-store");
    const body = await detail.json();
    expect(body).toEqual({ strategy: expect.objectContaining({ id: "custom-source-test", source }), executable: false });
  });

  it("does not resolve built-in or malformed IDs through the draft endpoint", async () => {
    expect((await getStrategy(new Request("http://localhost"), context("sma-crossover"))).status).toBe(404);
    expect((await getStrategy(new Request("http://localhost"), context("custom-"))).status).toBe(404);
  });
});
