import { EditorState } from "@codemirror/state";
import { expect, test } from "bun:test";
import {
  buildChangedLineNumberMarkers,
  buildWorkspaceDiffMergeExtensions,
} from "../src/renderer/workspace-diff-merge-extensions";

test("buildWorkspaceDiffMergeExtensions marks changed line numbers", () => {
  const extensions = buildWorkspaceDiffMergeExtensions({
    originalContent: "one\ntwo\nthree\n",
  });
  const state = EditorState.create({
    doc: "one\ntwo-changed\nthree\nfour\n",
    extensions,
  });
  const markers = buildChangedLineNumberMarkers(state);
  const markedLines: number[] = [];
  markers.between(0, state.doc.length, (from) => {
    markedLines.push(state.doc.lineAt(from).number);
  });
  expect(markedLines).toContain(2);
});
