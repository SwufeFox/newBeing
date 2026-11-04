import { NextResponse } from "next/server";
import { STRATEGIES } from "@newbeing/core";
import { listStoredStrategySummaries } from "@newbeing/storage";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const builtins = STRATEGIES.map(({ id, name, version, description, defaults }) => ({
    id, name, version, description, parameters: defaults, builtIn: true,
  }));
  const saved = listStoredStrategySummaries().map((strategy) => ({ ...strategy, builtIn: false }));
  return NextResponse.json({ items: [...builtins, ...saved] }, { headers: { "Cache-Control": "no-store" } });
}
