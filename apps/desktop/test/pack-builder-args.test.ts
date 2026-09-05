import { expect, test } from "bun:test";
import { resolveElectronBuilderCliArgs } from "../scripts/pack-builder-args.mjs";

test("leaves distributor targets unchanged without --dir/--unpacked", () => {
  expect(resolveElectronBuilderCliArgs(["--mac", "dmg", "zip", "--arm64"])).toEqual({
    unpacked: false,
    args: ["--mac", "dmg", "zip", "--arm64"],
  });
});

test("--dir replaces mac dmg/zip with unpacked dir target", () => {
  expect(resolveElectronBuilderCliArgs(["--mac", "dmg", "zip", "--arm64", "--dir"])).toEqual({
    unpacked: true,
    args: ["--mac", "dir", "--arm64"],
  });
});

test("--unpacked is an alias of --dir", () => {
  expect(resolveElectronBuilderCliArgs(["--mac", "dmg", "zip", "--x64", "--unpacked"])).toEqual({
    unpacked: true,
    args: ["--mac", "dir", "--x64"],
  });
});

test("--dir also rewrites win/linux installer targets", () => {
  expect(resolveElectronBuilderCliArgs(["--win", "nsis", "--x64", "--dir"])).toEqual({
    unpacked: true,
    args: ["--win", "dir", "--x64"],
  });
  expect(resolveElectronBuilderCliArgs(["--linux", "AppImage", "--x64", "--unpacked"])).toEqual({
    unpacked: true,
    args: ["--linux", "dir", "--x64"],
  });
});
