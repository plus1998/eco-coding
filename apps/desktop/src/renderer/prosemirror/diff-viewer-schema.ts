import { type Node as PMNode, Schema } from "prosemirror-model";

export type DiffLineKind = "context" | "insert" | "delete";

export const diffViewerSchema = new Schema({
  nodes: {
    doc: {
      content: "hunk*",
    },
    text: {
      group: "inline",
    },
    hunk: {
      content: "diff_line*",
      isolating: true,
      toDOM() {
        return ["div", { class: "pm-diff-hunk" }, 0];
      },
      parseDOM: [{ tag: "div.pm-diff-hunk" }],
    },
    diff_line: {
      attrs: {
        kind: { default: "context" as DiffLineKind },
        oldNo: { default: null as number | null },
        newNo: { default: null as number | null },
        text: { default: "" },
      },
      atom: true,
      selectable: false,
      toDOM(node) {
        const kind = String(node.attrs.kind) as DiffLineKind;
        const oldNo = node.attrs.oldNo as number | null;
        const newNo = node.attrs.newNo as number | null;
        const text = String(node.attrs.text ?? "");
        return [
          "div",
          {
            class: `pm-diff-line is-${kind}`,
            "data-kind": kind,
            "data-old-no": oldNo == null ? "" : String(oldNo),
            "data-new-no": newNo == null ? "" : String(newNo),
          },
          [
            "span",
            { class: "pm-diff-line-nos", "aria-hidden": "true" },
            ["span", { class: "pm-diff-line-no pm-diff-line-no--old" }, oldNo == null ? "" : String(oldNo)],
            ["span", { class: "pm-diff-line-no pm-diff-line-no--new" }, newNo == null ? "" : String(newNo)],
          ],
          ["span", { class: "pm-diff-line-text" }, text.length > 0 ? text : "\u00a0"],
        ];
      },
      parseDOM: [
        {
          tag: "div.pm-diff-line",
          getAttrs(dom) {
            if (!(dom instanceof HTMLElement)) return false;
            const kind = (dom.dataset.kind ?? "context") as DiffLineKind;
            const oldRaw = dom.dataset.oldNo ?? "";
            const newRaw = dom.dataset.newNo ?? "";
            const text = dom.querySelector(".pm-diff-line-text")?.textContent ?? "";
            return {
              kind: kind === "insert" || kind === "delete" ? kind : "context",
              oldNo: oldRaw === "" ? null : Number(oldRaw),
              newNo: newRaw === "" ? null : Number(newRaw),
              text: text === "\u00a0" ? "" : text,
            };
          },
        },
      ],
    },
  },
});

export function createEmptyDiffDoc(): PMNode {
  return diffViewerSchema.node("doc");
}
