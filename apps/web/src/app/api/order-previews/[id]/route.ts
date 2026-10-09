import { NextResponse } from "next/server";
import { z } from "zod";
import { executePaperOrder } from "@newbeing/application";
import { getOrderPreview, getPaperOrder, getWorkspaceState, updateOrderPreview } from "@newbeing/storage";

export const runtime = "nodejs";

const actionSchema = z.object({ action: z.enum(["confirm", "dismiss"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    if (getWorkspaceState().state.activeWorkspace === "replay") {
      return NextResponse.json({ error: "Normal Paper preview confirmation is disabled during Replay." }, { status: 409 });
    }
    const { id } = await context.params;
    const body: unknown = await request.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Expected confirm or dismiss." }, { status: 400 });
    const preview = getOrderPreview(id);
    if (!preview) return NextResponse.json({ error: "Order preview not found." }, { status: 404 });
    if (preview.status !== "prepared") {
      const existing = preview.orderId ? getPaperOrder(preview.orderId) : undefined;
      return NextResponse.json({ preview, order: existing ?? null, message: "Preview is already closed; no second order was submitted." }, { status: 409 });
    }
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      updateOrderPreview(id, { status: "expired" });
      return NextResponse.json({ error: "Preview expired; ask the assistant for a fresh quote." }, { status: 410 });
    }
    if (parsed.data.action === "dismiss") {
      updateOrderPreview(id, { status: "dismissed" });
      return NextResponse.json({ preview: { ...preview, status: "dismissed" } });
    }
    const orderId = `preview-${preview.id}`;
    const result = await executePaperOrder({
      clientOrderId: orderId,
      symbol: preview.symbol,
      side: preview.side,
      quantity: preview.quantity,
    });
    updateOrderPreview(id, { status: "confirmed", orderId });
    const status = result.order.status === "filled" ? 201 : result.order.status === "unknown" ? 202 : 422;
    return NextResponse.json({ preview: { ...preview, status: "confirmed", orderId }, ...result }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not confirm this Paper preview.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
