import { expect, test } from "bun:test";
import { readPromptImagePreviews } from "../src/shared/prompt-image-metadata";

test("reads validated prompt image previews from run metadata", () => {
  expect(
    readPromptImagePreviews({
      promptImagePreviews: [
        { id: "preview-1", mediaType: "image/jpeg", data: "YWJj" },
        { id: "missing-data", mediaType: "image/png" },
      ],
    }),
  ).toEqual([{ id: "preview-1", mediaType: "image/jpeg", data: "YWJj" }]);
});
