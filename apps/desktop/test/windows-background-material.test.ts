import { describe, expect, test } from "bun:test";
import {
  resolveWindowsBackdropVersion,
  resolveWindowsBackgroundMaterial,
} from "../src/main/windows-background-material";

describe("Windows background material", () => {
  test("identifies Windows 10 builds and does not request an unsupported material", () => {
    expect(resolveWindowsBackdropVersion("10.0.19045")).toBe("win10");
    expect(resolveWindowsBackgroundMaterial("10.0.19045")).toBeUndefined();
  });

  test("keeps mica on Windows 11 builds", () => {
    expect(resolveWindowsBackdropVersion("10.0.22631")).toBe("win11");
    expect(resolveWindowsBackgroundMaterial("10.0.22631")).toBe("mica");
  });

  test("uses the Windows 10 treatment for an unrecognized Windows release", () => {
    expect(resolveWindowsBackdropVersion("unknown")).toBe("win10");
    expect(resolveWindowsBackgroundMaterial("unknown")).toBeUndefined();
  });
});
