import { NextResponse } from "next/server";
import { z } from "zod";
import { STRATEGIES } from "@newbeing/core";
import { listStoredStrategies, saveStrategy } from "@newbeing/storage";

export const runtime = "nodejs";

const parametersSchema = z.record(z.string(), z.union([z.number().finite(), z.boolean()]));
const strategySchema = z.object({
  id: z.string().regex(/^custom-[a-z0-9-]{2,80}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  parameters: parametersSchema,
  source: z.string().max(50_000),
});

export async function GET(): Promise<NextResponse> {
  const builtins = STRATEGIES.map(({ id, name, version, description, defaults }) => ({
    id, name, version, description, parameters: defaults, builtIn: true,
  }));
  const saved = listStoredStrategies().map((strategy) => ({ ...strategy, builtIn: false }));
  return NextResponse.json({ items: [...builtins, ...saved] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body: unknown = await request.json();
    const parsed = strategySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid strategy draft." }, { status: 400 });
    const stored = saveStrategy({ ...parsed.data, version: "draft", source: parsed.data.source });
    return NextResponse.json({ strategy: stored, executable: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save strategy draft.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
