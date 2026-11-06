import { DERIVATIVES_ORDER_PAGE_SIZE, listDerivativesAccounts } from "@newbeing/application/derivatives";
import { derivativeFailure, derivativeJson, validateDerivativeQuery } from "@/lib/derivatives-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = validateDerivativeQuery(request, []);
  if (rejected) return rejected;
  try {
    const accounts = listDerivativesAccounts(DERIVATIVES_ORDER_PAGE_SIZE);
    return derivativeJson({ accounts });
  } catch (error) {
    return derivativeFailure(error, 500);
  }
}
