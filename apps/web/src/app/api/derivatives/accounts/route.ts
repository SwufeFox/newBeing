import { listDerivativesAccounts } from "@newbeing/application/derivatives";
import { derivativeJson } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = listDerivativesAccounts();
    return derivativeJson({ accounts });
  } catch (error) {
    return derivativeJson({ error: error instanceof Error ? error.message : "Account ledger unavailable." }, 500);
  }
}
