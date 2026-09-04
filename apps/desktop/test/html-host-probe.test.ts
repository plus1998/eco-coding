import { describe, expect, test } from "bun:test";
import { probeHtmlHostingCapability } from "../src/main/html-host-store";

describe("probeHtmlHostingCapability", () => {
  test("marks available when Content-Type is text/html", async () => {
    const result = await probeHtmlHostingCapability({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
      fetchImpl: async () =>
        new Response("<!DOCTYPE html><html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    });
    expect(result.available).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.renderRisk).toBeUndefined();
  });

  test("stays available with renderRisk when Content-Type is text/plain", async () => {
    const result = await probeHtmlHostingCapability({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
      fetchImpl: async () =>
        new Response("<!DOCTYPE html><html></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Eco-Html-Host-Probe": "1",
          },
        }),
    });
    expect(result.available).toBe(true);
    expect(result.reason).toBe("content_type_rewritten");
    expect(result.renderRisk).toBe(true);
  });
});
