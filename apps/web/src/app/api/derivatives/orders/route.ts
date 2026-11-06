import { z } from "zod";
import { DerivativesOrderPageError, getDerivativesOrderPage } from "@newbeing/application/derivatives";
import { derivativeFailure, derivativeJson, validateDerivativeQuery } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  venue: z.enum(["okx", "deribit"]),
  settle: z.string().regex(/^[A-Z0-9]{1,20}$/),
  before: z.string().min(1).max(128).optional(),
});

export async function GET(request: Request) {
  const rejected = validateDerivativeQuery(request, ["venue", "settle", "before"]);
  if (rejected) return rejected;
  try {
    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({ venue: params.get("venue"), settle: params.get("settle"), before: params.get("before") ?? undefined });
    return derivativeJson(getDerivativesOrderPage(query.venue, query.settle, query.before));
  } catch (error) {
    return derivativeFailure(error, error instanceof DerivativesOrderPageError ? 400 : 503);
  }
}
