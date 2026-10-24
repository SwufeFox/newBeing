import { listDerivativesAccounts } from "@newbeing/application/derivatives";
import { derivativeJson, derivativeReplayRejection } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = derivativeReplayRejection();
  if (blocked) return blocked;
  try {
    const accounts = listDerivativesAccounts();
    return derivativeReplayRejection() ?? derivativeJson({ accounts });
  } catch (error) {
    return derivativeReplayRejection() ?? derivativeJson({ error: error instanceof Error ? error.message : "Account ledger unavailable." }, 500);
  }
}
