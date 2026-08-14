import { expect, test } from "bun:test";
import {
  ECO_IMAGE_VIEW_FULL_TOOL,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
  readImageViewPathFromToolArgs,
} from "../src/eco-image-view-tool";

test("recognizes Eco image view MCP names", () => {
  expect(isEcoImageViewToolName(ECO_IMAGE_VIEW_FULL_TOOL)).toBe(true);
  expect(isEcoImageViewToolName(`mcp__${ECO_IMAGE_VIEW_MCP_SERVER}__${ECO_IMAGE_VIEW_TOOL}`)).toBe(true);
  expect(isEcoImageViewToolName("mcp__eco_image_generation__create_image")).toBe(false);
  expect(isEcoImageViewToolName("ViewImage")).toBe(false);
  expect(isEcoImageViewToolName("view_image")).toBe(false);
});

test("readImageViewPathFromToolArgs only returns absolute paths for Eco view_image", () => {
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "/tmp/a.png" })).toBe(
    "/tmp/a.png",
  );
  expect(readImageViewPathFromToolArgs(ECO_IMAGE_VIEW_FULL_TOOL, { path: "relative.png" })).toBe(
    undefined,
  );
  expect(readImageViewPathFromToolArgs("Read", { path: "/tmp/a.png" })).toBe(undefined);
});
