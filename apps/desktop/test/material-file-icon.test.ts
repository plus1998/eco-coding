import { expect, test } from "bun:test";
import { resolveMaterialIconName, getMaterialIconUrl } from "../src/renderer/material-file-icon";

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

test("maps resolved icon names to bundled svg urls", () => {
  const typescriptUrl = getMaterialIconUrl("typescript");
  expect(typescriptUrl).toContain("material-icons/typescript.svg");
  expect(getMaterialIconUrl("react_ts")).toContain("material-icons/react_ts.svg");
});
