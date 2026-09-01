import { describe, expect, it } from "vitest";
import { fetchJson } from "./fetchJson";

function fake(status: number, body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": status === 200 ? "application/json" : "text/html" },
    })) as unknown as typeof fetch;
}

describe("fetchJson", () => {
  it("resolves parsed JSON on 2xx", async () => {
    await expect(fetchJson<{ a: number }>("/data/x.json", undefined, fake(200, '{"a":1}')))
      .resolves.toEqual({ a: 1 });
  });

  it("rejects a 404 before trying to parse the HTML body", async () => {
    // pre-fix: r.json() on "<h1>Not found</h1>" threw a SyntaxError that the
    // callers swallowed into a permanent loading state
    await expect(fetchJson("/data/x.json", undefined, fake(404, "<h1>Not found</h1>")))
      .rejects.toThrow("/data/x.json: HTTP 404");
  });

  it("rejects a 5xx", async () => {
    await expect(fetchJson("/data/x.json", undefined, fake(503, "")))
      .rejects.toThrow("HTTP 503");
  });

  it("still rejects a 2xx whose body is not JSON", async () => {
    await expect(fetchJson("/data/x.json", undefined, fake(200, "<html>"))).rejects.toThrow();
  });
});
