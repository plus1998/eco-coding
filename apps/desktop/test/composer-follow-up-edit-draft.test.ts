import { expect, test } from "bun:test";
import {
  captureComposerBeforeFollowUpEdit,
  resolveComposerAfterFollowUpEdit,
} from "../src/renderer/composer-follow-up-edit-draft";

test("captureComposerBeforeFollowUpEdit saves draft only on first edit entry", () => {
  const first = captureComposerBeforeFollowUpEdit({
    alreadyEditing: false,
    prompt: "【草稿】继续优化性能",
    attachments: [{ id: "img_1" }],
    imageNotice: "仅支持 PNG",
  });
  expect(first).toEqual({
    prompt: "【草稿】继续优化性能",
    attachments: [{ id: "img_1" }],
    imageNotice: "仅支持 PNG",
  });

  const second = captureComposerBeforeFollowUpEdit({
    alreadyEditing: true,
    prompt: "不应覆盖",
    attachments: [],
  });
  expect(second).toBeUndefined();
});

test("resolveComposerAfterFollowUpEdit restores displaced composer draft", () => {
  const restored = resolveComposerAfterFollowUpEdit({
    prompt: "【草稿】继续优化性能",
    attachments: [{ id: "img_1" }],
    imageNotice: "仅支持 PNG",
  });
  expect(restored.prompt).toBe("【草稿】继续优化性能");
  expect(restored.attachments).toEqual([{ id: "img_1" }]);
  expect(restored.imageNotice).toBe("仅支持 PNG");
});

test("resolveComposerAfterFollowUpEdit clears composer when nothing was saved", () => {
  expect(resolveComposerAfterFollowUpEdit(undefined)).toEqual({
    prompt: "",
    attachments: [],
  });
});
