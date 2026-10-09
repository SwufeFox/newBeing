import { NextResponse, type NextRequest } from "next/server";
import { localApiRejection } from "@/lib/local-api-guard";

export function proxy(request: NextRequest): NextResponse {
  const rejection = localApiRejection(request);
  if (rejection) return NextResponse.json({ error: rejection }, { status: 403 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
