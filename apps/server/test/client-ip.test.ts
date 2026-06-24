import { describe, expect, test } from "bun:test";
import {
  clientIdentity,
  enrichDeviceMetadata,
  normalizeIpAddress,
  resolveClientIp,
} from "../src/client-ip";

describe("normalizeIpAddress", () => {
  test("unwraps IPv4-mapped IPv6 addresses", () => {
    expect(normalizeIpAddress("::ffff:192.168.1.10")).toBe("192.168.1.10");
  });
});

describe("resolveClientIp", () => {
  test("prefers cf-connecting-ip", () => {
    const request = new Request("http://localhost/v1/devices/register", {
      headers: { "cf-connecting-ip": "203.0.113.8" },
    });
    expect(resolveClientIp(request)).toBe("203.0.113.8");
  });
});

describe("enrichDeviceMetadata", () => {
  test("overwrites desktop ip with server observed value", () => {
    expect(
      enrichDeviceMetadata({
        deviceKind: "desktop",
        clientIp: "192.168.1.20",
        metadata: {
          hostname: "studio-pc",
          ipAddress: "10.0.0.9",
          platform: "darwin 25.5.0",
        },
      }),
    ).toEqual({
      hostname: "studio-pc",
      ipAddress: "192.168.1.20",
      platform: "darwin 25.5.0",
    });
  });

  test("keeps mobile client ip metadata", () => {
    expect(
      enrichDeviceMetadata({
        deviceKind: "mobile",
        clientIp: "192.168.1.1",
        metadata: {
          model: "OPPO PJA110",
          ipAddress: "192.168.1.44",
        },
      }),
    ).toEqual({
      model: "OPPO PJA110",
      ipAddress: "192.168.1.44",
    });
  });
});

describe("clientIdentity", () => {
  test("falls back to unknown", () => {
    expect(clientIdentity(new Request("http://localhost/health"))).toBe("unknown");
  });
});
