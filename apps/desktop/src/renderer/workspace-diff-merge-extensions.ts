import { getChunks, unifiedMergeView } from "@codemirror/merge";
import {
  EditorState,
  RangeSetBuilder,
  StateField,
  type Extension,
  type RangeSet,
} from "@codemirror/state";
import { GutterMarker, lineNumberMarkers } from "@codemirror/view";

const changedLineNumberMarker = new (class extends GutterMarker {
  override elementClass = "cm-diffChangedLineNumber";
})();

export function buildChangedLineNumberMarkers(state: EditorState): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const info = getChunks(state);
  if (!info) return builder.finish();

  const side = info.side ?? "b";
  const seen = new Set<number>();

  for (const chunk of info.chunks) {
    let from = side === "a" ? chunk.fromA : chunk.fromB;
    const to = side === "a" ? chunk.toA : chunk.toB;
    if (from >= to) continue;

    from = Math.min(Math.max(from, 0), state.doc.length);
    const end = Math.min(to, state.doc.length + (to > state.doc.length ? 1 : 0));

    while (from < end) {
      const line = state.doc.lineAt(Math.min(from, Math.max(state.doc.length - 1, 0)));
      if (!seen.has(line.from)) {
        seen.add(line.from);
        builder.add(line.from, line.from, changedLineNumberMarker);
      }
      if (line.to >= state.doc.length) break;
      from = line.to + 1;
      if (from >= end) break;
    }
  }

  return builder.finish();
}

const changedLineNumberField = StateField.define<RangeSet<GutterMarker>>({
  create: buildChangedLineNumberMarkers,
  update(markers, tr) {
    const before = getChunks(tr.startState);
    const after = getChunks(tr.state);
    if (tr.docChanged || before?.chunks !== after?.chunks) {
      return buildChangedLineNumberMarkers(tr.state);
    }
    return markers.map(tr.changes);
  },
  provide: (field) => lineNumberMarkers.from(field),
});

export function buildWorkspaceDiffMergeExtensions(options: {
  originalContent: string;
  phrases?: Record<string, string>;
}): Extension[] {
  return [
    ...(options.phrases ? [EditorState.phrases.of(options.phrases)] : []),
    unifiedMergeView({
      original: options.originalContent,
      highlightChanges: false,
      gutter: true,
      mergeControls: false,
      collapseUnchanged: { margin: 4, minSize: 6 },
      diffConfig: { scanLimit: 2000, timeout: 80 },
    }),
    // Must follow unifiedMergeView so ChunkField exists when markers are built.
    changedLineNumberField,
  ];
}
