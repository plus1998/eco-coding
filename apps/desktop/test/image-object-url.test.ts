import { describe, expect, it } from "bun:test";
import {
  createImageObjectUrlFromBase64,
  createImageObjectUrlFromBytes,
  revokeImageObjectUrl,
} from "../src/renderer/image-object-url";

describe("image-object-url", () => {
  it("creates a blob URL from base64 and revokes safely", () => {
    const url = createImageObjectUrlFromBase64("image/png", btoa("png-bytes"));
    expect(url.startsWith("blob:")).toBe(true);
    revokeImageObjectUrl(url);
    revokeImageObjectUrl(url);
    revokeImageObjectUrl("data:image/png;base64,xx");
    revokeImageObjectUrl(undefined);
  });

  it("creates a blob URL from raw bytes", () => {
    const url = createImageObjectUrlFromBytes("image/jpeg", new TextEncoder().encode("jpeg"));
    expect(url.startsWith("blob:")).toBe(true);
    revokeImageObjectUrl(url);
  });
});
