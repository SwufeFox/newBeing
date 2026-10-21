import { NextResponse } from "next/server";
import { z } from "zod";
import { listPaperRecoveries, listPendingPaperOrders, recoverPaperIntent } from "@newbeing/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only termination is public. Prices, balances and fill claims are never accepted.
const recoverySchema = z.object({
  action: z.literal("cancel"),
  clientOrderId: z.string().min(1).max(100),
  actionId: z.string().regex(/^[A-Za-z0-9-]{8,100}$/),
  reason: z.string().trim().min(1).max(2000),
}).strict();

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ pending: listPendingPaperOrders(), recoveries: listPaperRecoveries() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = recoverySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Expected cancel, clientOrderId, actionId and audit reason only." }, { status: 400 });
    return NextResponse.json(recoverPaperIntent(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Paper recovery failed." }, { status: 409 });
  }
}
