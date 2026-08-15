import { expect, test } from "bun:test";
import { createElement } from "react";
import { ComposerPlusMenuPanel } from "../src/renderer/ComposerPlusMenu";
import { renderLocalized } from "./i18n-test";

test("plus menu includes runtime configuration for Eco cores", () => {
  const markup = renderLocalized(
    createElement(ComposerPlusMenuPanel, {
      sessionMode: "agent",
      canEditMode: true,
      canOpenRoute: true,
      showRoute: true,
      onSelectMode: () => undefined,
      onPickImage: () => undefined,
      onOpenRoute: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("配置");
  expect(markup).toContain("图片");
});

test("plus menu hides runtime configuration for ACP", () => {
  const markup = renderLocalized(
    createElement(ComposerPlusMenuPanel, {
      sessionMode: "agent",
      canEditMode: true,
      canOpenRoute: true,
      showRoute: false,
      onSelectMode: () => undefined,
      onPickImage: () => undefined,
      onOpenRoute: () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("图片");
  expect(markup).not.toContain("配置");
});
