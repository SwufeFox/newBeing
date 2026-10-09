import { describe, expect, it } from "vitest";
import { localApiRejection } from "../src/lib/local-api-guard.js";

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3100/api/workspace", { method, headers: { host: "localhost:3100", ...headers } });
}

describe("local API request guard", () => {
  it("allows loopback read requests but rejects Host aliases used by DNS rebinding", () => {
    expect(localApiRejection(request("GET"))).toBeNull();
    expect(localApiRejection(request("GET", { host: "attacker.example" }))).toContain("loopback Host");
    expect(localApiRejection(request("GET", { host: "localhost.attacker.example" }))).toContain("loopback Host");
  });

  it("requires same-host Origin and JSON for all state-changing methods", () => {
    const valid = { origin: "http://localhost:3100", "content-type": "application/json; charset=utf-8" };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(localApiRejection(request(method, valid))).toBeNull();
      expect(localApiRejection(request(method, { "content-type": "application/json" }))).toContain("Origin header");
      expect(localApiRejection(request(method, { ...valid, origin: "http://attacker.example" }))).toContain("same-host Origin");
      expect(localApiRejection(request(method, { ...valid, "content-type": "text/plain" }))).toContain("application/json");
    }
  });

  it("rejects malformed and non-loopback authorities", () => {
    for (const host of ["", "localhost.attacker.test", "127.0.0.1.attacker.test", "attacker@localhost:3100"]) {
      expect(localApiRejection(request("GET", { host }))).not.toBeNull();
    }
  });
});
