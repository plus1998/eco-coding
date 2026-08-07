import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** Scroll and place caret at 1-based line/column inside a single code_file text node. */
export function scrollToLineCol(
  view: EditorView,
  line: number | undefined,
  column: number | undefined,
): void {
  if (line === undefined || line < 1) return;
  const doc = view.state.doc;
  const text = doc.textContent;
  const parts = text.length === 0 ? [""] : text.split("\n");
  const lineIndex = Math.min(line - 1, parts.length - 1);
  let textOffset = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    textOffset += parts[i]!.length + 1;
  }
  const lineLength = parts[lineIndex]?.length ?? 0;
  const col = column === undefined ? 1 : Math.max(1, Math.min(column, lineLength + 1));
  textOffset += col - 1;

  // doc > code_file > text — text content starts at pos 1
  const pos = Math.max(1, Math.min(1 + textOffset, doc.content.size));
  try {
    const selection = TextSelection.create(doc, pos);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  } catch {
    // Out-of-range selection after concurrent doc replace — ignore
  }
}
