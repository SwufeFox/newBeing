const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackAuthority(authority: string): boolean {
  if (authority.length === 0 || authority !== authority.trim() || authority.includes("@")) return false;
  try {
    const parsed = new URL(`http://${authority}`);
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
      && parsed.username.length === 0
      && parsed.password.length === 0
      && parsed.pathname === "/"
      && parsed.search.length === 0
      && parsed.hash.length === 0;
  } catch {
    return false;
  }
}

/**
 * API routes are intentionally bound to loopback. Host validation blocks DNS-rebinding
 * aliases; writes additionally require a same-host browser Origin and JSON body.
 */
export function localApiRejection(request: Request): string | null {
  const host = request.headers.get("host") ?? "";
  if (!isLoopbackAuthority(host)) return "API requests must use a loopback Host.";

  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("origin");
  if (!origin) return "State-changing API requests require an Origin header.";
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== "http:" || parsedOrigin.host.toLowerCase() !== host.toLowerCase()
      || parsedOrigin.username.length > 0 || parsedOrigin.password.length > 0
      || parsedOrigin.pathname !== "/" || parsedOrigin.search.length > 0 || parsedOrigin.hash.length > 0) {
      return "State-changing API requests must have a same-host Origin.";
    }
  } catch {
    return "State-changing API requests must have a valid same-host Origin.";
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return "State-changing API requests must use application/json.";
  return null;
}
