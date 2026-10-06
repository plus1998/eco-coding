import type { Node as PMNode, Schema } from "prosemirror-model";
import { EditorState, Plugin, type Plugin as PMPlugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useLayoutEffect, useRef } from "react";
import { scrollToLineCol } from "./scroll-to-line-col";

export const EMPTY_PM_PLUGINS: readonly PMPlugin[] = Object.freeze([]);

/**
 * Alternative document source.
 *
 * Streaming Markdown cannot go through `createDoc(content)`: that re-parses the
 * whole response on every reveal tick. A provider lets the caller build the doc
 * incrementally (see `streaming-markdown-doc.ts`) while `content` still drives
 * *when* the doc is rebuilt.
 */
export interface ProseMirrorDocProvider {
  buildDoc: () => PMNode;
}

export interface ProseMirrorHostProps {
  className?: string;
  schema: Schema;
  /** Stable plugins list (do not recreate every render). */
  plugins?: readonly PMPlugin[];
  /** Source text or opaque key; when it changes and !dirty, doc is replaced. */
  content: string;
  createDoc: (content: string) => PMNode;
  /** When set, the doc comes from this provider instead of `createDoc(content)`. */
  docProvider?: ProseMirrorDocProvider;
  serializeDoc?: (doc: PMNode) => string;
  editable?: boolean;
  /** When true, external content updates do not replace the local doc. */
  dirty?: boolean;
  onDocChange?: (text: string) => void;
  targetLine?: number;
  targetColumn?: number;
  onView?: (view: EditorView | null) => void;
  /** Hide code-line gutter; non-editable presentation (e.g. diff viewer). */
  readOnly?: boolean;
}

function defaultSerialize(doc: PMNode): string {
  return doc.textContent;
}

export function ProseMirrorHost({
  className,
  schema,
  plugins = EMPTY_PM_PLUGINS,
  content,
  createDoc,
  docProvider,
  serializeDoc = defaultSerialize,
  editable = true,
  dirty = false,
  onDocChange,
  targetLine,
  targetColumn,
  onView,
  readOnly = false,
}: ProseMirrorHostProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const createDocRef = useRef(createDoc);
  const docProviderRef = useRef(docProvider);
  const serializeDocRef = useRef(serializeDoc);
  const onDocChangeRef = useRef(onDocChange);
  const editableRef = useRef(editable && !readOnly);
  const dirtyRef = useRef(dirty);
  const contentRef = useRef(content);

  createDocRef.current = createDoc;
  docProviderRef.current = docProvider;
  serializeDocRef.current = serializeDoc;
  onDocChangeRef.current = onDocChange;
  editableRef.current = editable && !readOnly;
  dirtyRef.current = dirty;
  contentRef.current = content;

  const pluginsKey = plugins;

  // The mount effect must see the doc source for this commit, and the provider
  // is rebuilt every render (it closes over the latest stream text).
  const buildInitialDocRef = useRef<() => PMNode>(() => createDoc(content));
  buildInitialDocRef.current = docProvider
    ? docProvider.buildDoc
    : () => createDocRef.current(contentRef.current);

  useLayoutEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;

    const editablePlugin = new Plugin({
      props: {
        editable: () => editableRef.current,
        attributes: {
          class: "pm-editor-content",
          spellcheck: "false",
        },
      },
    });

    const state = EditorState.create({
      schema,
      doc: buildInitialDocRef.current(),
      plugins: [...pluginsKey, editablePlugin],
    });

    const view = new EditorView(parent, {
      state,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          onDocChangeRef.current?.(serializeDocRef.current(next.doc));
          syncLineGutter(gutterRef.current, next.doc);
        }
      },
    });

    viewRef.current = view;
    onView?.(view);
    syncLineGutter(gutterRef.current, view.state.doc);
    scrollToLineCol(view, targetLine, targetColumn);

    return () => {
      onView?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per plugins identity; parent remounts via key when path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable host lifecycle
  }, [schema, pluginsKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.setProps({
      editable: () => editableRef.current,
    });
  }, [editable, readOnly]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || dirtyRef.current) return;
    let doc: PMNode;
    const provider = docProviderRef.current;
    if (provider) {
      doc = provider.buildDoc();
      // Cached fragments are the same node instances, so identity short-circuits
      // most of this comparison.
      if (view.state.doc.eq(doc)) return;
    } else {
      const current = serializeDocRef.current(view.state.doc);
      if (current === content) return;
      doc = createDocRef.current(content);
    }
    const next = EditorState.create({
      schema: view.state.schema,
      doc,
      plugins: view.state.plugins,
    });
    view.updateState(next);
    syncLineGutter(gutterRef.current, doc);
  }, [content, dirty]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    scrollToLineCol(view, targetLine, targetColumn);
  }, [targetLine, targetColumn, content]);

  return (
    <div className={["pm-host", className].filter(Boolean).join(" ")}>
      {!readOnly ? <div ref={gutterRef} className="pm-code-gutter" aria-hidden="true" /> : null}
      <div ref={mountRef} className={readOnly ? "pm-diff-mount" : "pm-code-mount"} />
    </div>
  );
}

function syncLineGutter(gutter: HTMLDivElement | null, doc: PMNode): void {
  if (!gutter) return;
  const text = doc.textContent;
  const count = text.length === 0 ? 1 : text.split("\n").length;
  if (gutter.childElementCount === count) {
    for (let i = 0; i < count; i += 1) {
      const el = gutter.children[i];
      if (el) el.textContent = String(i + 1);
    }
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= count; i += 1) {
    const line = document.createElement("div");
    line.className = "pm-code-gutter-line";
    line.textContent = String(i);
    frag.appendChild(line);
  }
  gutter.replaceChildren(frag);
}
