import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { getMaterialIconUrl, resolveMaterialIconName } from "../src/renderer/material-file-icon";

test("resolves common code file icons from Material Icon Theme", () => {
  expect(resolveMaterialIconName("src/App.tsx")).toBe("react_ts");
  expect(resolveMaterialIconName("/tmp/example.ts")).toBe("typescript");
  expect(resolveMaterialIconName("package.json")).toBe("nodejs");
  expect(resolveMaterialIconName("vite.config.ts")).toBe("vite");
  expect(resolveMaterialIconName("biome.json")).toBe("biome");
  expect(resolveMaterialIconName(".gitignore")).toBe("git");
  expect(resolveMaterialIconName("readme.md")).toBe("readme");
  expect(resolveMaterialIconName("notes.md")).toBe("markdown");
  expect(resolveMaterialIconName("types/index.d.ts")).toBe("typescript-def");
});

test("maps angular class suffixes to angular-* icon ids", () => {
  expect(resolveMaterialIconName("user.service.ts")).toBe("angular-service");
  expect(resolveMaterialIconName("user.component.ts")).toBe("angular-component");
  expect(resolveMaterialIconName("user.directive.ts")).toBe("angular-directive");
});

test("maps resolved icon names to bundled svg urls", () => {
  const typescriptUrl = getMaterialIconUrl("typescript");
  expect(typescriptUrl).toContain("material-icons/typescript.svg");
  expect(getMaterialIconUrl("react_ts")).toContain("material-icons/react_ts.svg");
  expect(getMaterialIconUrl("angular-service")).toContain("material-icons/angular-service.svg");
});

test("angular clone-only icons exist on disk as *.clone.svg", () => {
  const iconsDir = path.resolve(import.meta.dir, "../node_modules/material-icon-theme/icons");
  const cloneOnly = ["angular-service", "angular-component", "angular-directive"];
  for (const name of cloneOnly) {
    expect(existsSync(path.join(iconsDir, `${name}.svg`))).toBe(false);
    expect(existsSync(path.join(iconsDir, `${name}.clone.svg`))).toBe(true);
  }
});
