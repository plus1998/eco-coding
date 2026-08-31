import { describe, expect, test } from "bun:test";
import { shouldAdhocSignMac } from "../scripts/after-pack-mac-sign.mjs";

describe("shouldAdhocSignMac", () => {
  test("adhoc-signs when mac identity is unset", () => {
    expect(shouldAdhocSignMac({ packager: { platformSpecificBuildOptions: { identity: null } } })).toBe(true);
    expect(shouldAdhocSignMac({ packager: { platformSpecificBuildOptions: {} } })).toBe(true);
    expect(shouldAdhocSignMac({ packager: { platformSpecificBuildOptions: { identity: "-" } } })).toBe(true);
  });

  test("skips adhoc-sign when Developer ID identity is configured", () => {
    expect(
      shouldAdhocSignMac({
        packager: {
          platformSpecificBuildOptions: { identity: "Developer ID Application: Eco Coding (TEAMID)" },
        },
      }),
    ).toBe(false);
  });
});
