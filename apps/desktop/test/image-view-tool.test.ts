import { expect, test } from "bun:test";
import { ECO_IMAGE_VIEW_FULL_TOOL } from "@eco/runtime";
import { buildImageViewPromptAppend } from "../src/shared/image-view-tool";

test("prompt append names the Eco view_image tool and does not mention integrations", () => {
  const text = buildImageViewPromptAppend();
  expect(text).toContain(ECO_IMAGE_VIEW_FULL_TOOL);
  expect(text).toContain("absolute");
  expect(text.toLowerCase()).not.toContain("integration");
  expect(text).toContain("view_image");
});
