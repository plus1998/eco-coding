import { expect, test } from "bun:test";
import {
  buildEcoMermaidConfig,
  buildEcoMermaidThemeVariables,
  cleanupMermaidRenderArtifacts,
  isMermaidErrorSvg,
  isMermaidLang,
  readAppTheme,
} from "../src/renderer/prosemirror/mermaid-block";

test("isMermaidLang first token only", () => {
  expect(isMermaidLang("mermaid")).toBe(true);
  expect(isMermaidLang("  MERMAID  ")).toBe(true);
  expect(isMermaidLang("mermaid dark")).toBe(true);
  expect(isMermaidLang("notmermaid")).toBe(false);
});

test("readAppTheme defaults without document theme", () => {
  expect(readAppTheme()).toBe("light");
});

test("isMermaidErrorSvg detects mermaid native error output", () => {
  expect(isMermaidErrorSvg('<svg><text class="error-text">Syntax error in text</text></svg>')).toBe(
    true,
  );
  expect(isMermaidErrorSvg('<svg><circle r="4"/></svg>')).toBe(false);
});

test("cleanupMermaidRenderArtifacts removes mermaid temp nodes", () => {
  if (typeof document === "undefined") return;
  const renderId = "eco-mermaid-test";
  for (const id of [renderId, `d${renderId}`, `i${renderId}`]) {
    const node = document.createElement("div");
    node.id = id;
    document.body.appendChild(node);
  }
  cleanupMermaidRenderArtifacts(renderId);
  expect(document.getElementById(renderId)).toBeNull();
  expect(document.getElementById(`d${renderId}`)).toBeNull();
  expect(document.getElementById(`i${renderId}`)).toBeNull();
});

test("buildEcoMermaidConfig uses Eco base theme", () => {
  const dark = buildEcoMermaidConfig("dark");
  const light = buildEcoMermaidConfig("light");
  expect(dark.theme).toBe("base");
  expect(light.theme).toBe("base");
  expect(dark.securityLevel).toBe("strict");
  expect((dark.flowchart as { curve: string }).curve).toBe("basis");
  expect(buildEcoMermaidThemeVariables("dark").darkMode).toBe(true);
  expect(buildEcoMermaidThemeVariables("light").darkMode).toBe(false);
  expect(buildEcoMermaidThemeVariables("dark").primaryColor).toBeTruthy();
});
