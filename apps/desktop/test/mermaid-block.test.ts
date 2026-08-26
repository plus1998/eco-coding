import { expect, test } from "bun:test";
import {
  buildEcoMermaidConfig,
  buildEcoMermaidThemeVariables,
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
