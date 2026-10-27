import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePaperPreview } from "@newbeing/application";
import { getOrderPreview, getWorkspaceState, PaperReplayBlockedError } from "@newbeing/storage";
import { getWebMarketAdapter } from "@/lib/market-adapter";

export const runtime = "nodejs";
const actionSchema = z.object({ action: z.enum(["confirm", "dismiss"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    if (getWorkspaceState().state.activeWorkspace === "replay") {
      return NextResponse.json({ error: "Normal Paper preview confirmation is disabled during Replay." }, { status: 409 });
    }
    const { id } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Expected confirm or dismiss." }, { status: 400 });
    if (!getOrderPreview(id)) return NextResponse.json({ error: "Order preview not found." }, { status: 404 });
    const result = await resolvePaperPreview(id, parsed.data.action, getWebMarketAdapter);
    if (result.preview.status === "expired") return NextResponse.json({ ...result, error: "Preview expired; prepare a fresh quote." }, { status: 410 });
    if (parsed.data.action === "dismiss") {
      return NextResponse.json(result, { status: result.preview.status === "dismissed" ? 200 : 409 });
    }
    if (result.preview.status !== "confirmed") return NextResponse.json(result, { status: 409 });
    const pending = result.order && ["created", "submitted", "unknown"].includes(result.order.status);
    const status = pending ? 202 : result.order?.status === "filled" ? (result.deduplicated ? 200 : 201) : 422;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof PaperReplayBlockedError) return NextResponse.json({ error: "Normal Paper preview confirmation is disabled during Replay." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm this Paper preview." }, { status: 422 });
  }
}
