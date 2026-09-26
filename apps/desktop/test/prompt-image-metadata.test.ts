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

test("accepts durable V2 attachments without a UI-only id", () => {
  expect(
    readPromptImagePreviews({
      promptImagePreviews: [
        {
          mediaType: "image/png",
          contentRef: "sha256:abc",
          data: "YWJj",
        },
      ],
    }),
  ).toEqual([
    {
      id: "prompt-image:sha256:abc",
      mediaType: "image/png",
      contentRef: "sha256:abc",
      data: "YWJj",
    },
  ]);
});
