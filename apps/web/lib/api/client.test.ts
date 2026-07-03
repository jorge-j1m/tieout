import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, fetchJson, fetchJsonOrNull } from "./client";

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("fetchJson — every response crosses the schema boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a valid payload against its schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ operator: "ana" })));
    await expect(fetchJson("/me", z.object({ operator: z.string() }))).resolves.toEqual({
      operator: "ana",
    });
  });

  it("prefixes the API base url", async () => {
    const spy = vi.fn().mockResolvedValue(okJson([]));
    vi.stubGlobal("fetch", spy);
    await fetchJson("/runs", z.array(z.unknown()));
    expect(spy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3001/runs");
  });

  it("throws ApiError with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(fetchJson("/runs", z.unknown())).rejects.toMatchObject(
      new ApiError("/runs", 500),
    );
  });

  it("rejects a payload that violates the schema — shape drift fails loudly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ operator: 42 })));
    await expect(fetchJson("/me", z.object({ operator: z.string() }))).rejects.toThrow();
  });

  it("fetchJsonOrNull turns a 404 into null and nothing else", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 404 })));
    await expect(fetchJsonOrNull("/breaks/x", z.unknown())).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));
    await expect(fetchJsonOrNull("/breaks/x", z.unknown())).rejects.toBeInstanceOf(ApiError);
  });
});
