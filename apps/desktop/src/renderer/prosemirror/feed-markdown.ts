import MarkdownIt from "markdown-it";
import {
  defaultMarkdownParser,
  schema as markdownSchema,
  MarkdownParser,
} from "prosemirror-markdown";
import { Fragment, type Mark, type Node as PMNode, Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import { copyTextToClipboard } from "../clipboard";
import { i18n } from "../i18n";
import { getMaterialIconUrl, resolveMaterialIconName } from "../material-file-icon";
import {
  dispatchWorkspaceFileReference,
  formatWorkspaceFileReferenceLabel,
  linkifyWorkspaceFileReferences,
  parseWorkspaceFileReferenceHref,
  type WorkspaceFileReference,
} from "../workspace-file-reference";
import { dispatchBrowserLinkOpen, isHttpishHref } from "../browser-link";

function fileRefTitle(reference: WorkspaceFileReference): string {
  if (reference.line !== undefined) {
    return `${reference.path}:${reference.line}${
      reference.column !== undefined ? `:${reference.column}` : ""
    }`;
  }
  return reference.path;
}

export function fileRefHref(reference: WorkspaceFileReference, href?: string): string {
  if (href?.startsWith("eco-file:")) return href;
  if (href && parseWorkspaceFileReferenceHref(href)) return href;
  const base = reference.path;
  if (reference.line !== undefined) {
    return `${base}:${reference.line}${reference.column !== undefined ? `:${reference.column}` : ""}`;
  }
  return base;
}

function fileRefToDOM(node: PMNode) {
  const reference: WorkspaceFileReference = {
    path: String(node.attrs.path),
    ...(node.attrs.line != null ? { line: Number(node.attrs.line) } : {}),
    ...(node.attrs.column != null ? { column: Number(node.attrs.column) } : {}),
  };
  const href = String(node.attrs.href || fileRefHref(reference));
  const iconName = resolveMaterialIconName(reference.path);
  const iconUrl = getMaterialIconUrl(iconName);
  return [
    "a",
    {
      href,
      class: "markdown-file-ref",
      title: fileRefTitle(reference),
      "data-eco-file": "1",
    },
    [
      "img",
      {
        class: "markdown-file-ref__icon",
        src: iconUrl,
        alt: "",
        width: "14",
        height: "14",
        draggable: "false",
        "aria-hidden": "true",
      },
    ],
    ["span", { class: "markdown-file-ref__label" }, formatWorkspaceFileReferenceLabel(reference)],
  ] as const;
}

const feedTableNodes = {
  table: {
    content: "table_row+",
    group: "block",
    isolating: true,
    parseDOM: [{ tag: "table" }],
    toDOM() {
      return ["table", { class: "markdown-table" }, ["tbody", 0]];
    },
  },
  table_row: {
    content: "(table_cell | table_header)*",
    parseDOM: [{ tag: "tr" }],
    toDOM() {
      return ["tr", 0];
    },
  },
  table_cell: {
    content: "inline*",
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    isolating: true,
    parseDOM: [
      {
        tag: "td",
        getAttrs(dom: HTMLElement | string) {
          if (typeof dom === "string") return false;
          return {
            colspan: Number(dom.getAttribute("colspan") || 1),
            rowspan: Number(dom.getAttribute("rowspan") || 1),
          };
        },
      },
    ],
    toDOM(node: PMNode) {
      return [
        "td",
        {
          colspan: node.attrs.colspan,
          rowspan: node.attrs.rowspan,
        },
        0,
      ];
    },
  },
  table_header: {
    content: "inline*",
    attrs: {
      colspan: { default: 1 },
      rowspan: { default: 1 },
    },
    isolating: true,
    parseDOM: [
      {
        tag: "th",
        getAttrs(dom: HTMLElement | string) {
          if (typeof dom === "string") return false;
          return {
            colspan: Number(dom.getAttribute("colspan") || 1),
            rowspan: Number(dom.getAttribute("rowspan") || 1),
          };
        },
      },
    ],
    toDOM(node: PMNode) {
      return [
        "th",
        {
          colspan: node.attrs.colspan,
          rowspan: node.attrs.rowspan,
        },
        0,
      ];
    },
  },
};

export const feedMarkdownSchema = new Schema({
  nodes: markdownSchema.spec.nodes.append(feedTableNodes).append({
    file_ref: {
      inline: true,
      atom: true,
      group: "inline",
      selectable: false,
      attrs: {
        path: {},
        line: { default: null },
        column: { default: null },
        href: { default: "" },
      },
      toDOM: fileRefToDOM,
      parseDOM: [
        {
          tag: "a.markdown-file-ref",
          getAttrs(dom) {
            if (!(dom instanceof HTMLElement)) return false;
            const href = dom.getAttribute("href") ?? "";
            const reference = parseWorkspaceFileReferenceHref(href);
            if (!reference) return false;
            return {
              path: reference.path,
              line: reference.line ?? null,
              column: reference.column ?? null,
              href,
            };
          },
        },
      ],
    },
  }),
  marks: markdownSchema.spec.marks
    .update("link", {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs(dom: HTMLElement | string) {
            if (typeof dom === "string") return false;
            const href = dom.getAttribute("href");
            if (
              !href ||
              parseWorkspaceFileReferenceHref(href) ||
              dom.classList.contains("markdown-file-ref")
            ) {
              return false;
            }
            return {
              href,
              title: dom.getAttribute("title"),
            };
          },
        },
      ],
      toDOM(mark: Mark) {
        return [
          "a",
          {
            href: mark.attrs.href,
            title: mark.attrs.title,
            target: "_blank",
            rel: "noreferrer noopener",
          },
          0,
        ];
      },
    })
    .update("code", {
      excludes: "_",
      parseDOM: [
        {
          tag: "code",
          preserveWhitespace: "full",
          getAttrs(dom: HTMLElement | string) {
            if (typeof dom === "string") return false;
            // Fenced / block code uses <pre><code>, not the inline mark.
            if (dom.closest("pre")) return false;
            return null;
          },
        },
      ],
      toDOM() {
        return ["code", { class: "markdown-inline-code" }, 0];
      },
    })
    .addToEnd("strikethrough", {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM() {
        return ["del", 0];
      },
    }),
});

// Default markdown-it (not commonmark-only) so GFM tables / strikethrough work.
const tokenizer = MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
});

export const feedMarkdownParser = new MarkdownParser(feedMarkdownSchema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  softbreak: { node: "hard_break" },
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: { block: "table_header" },
  td: { block: "table_cell" },
  s: { mark: "strikethrough" },
});

function createFileRefNode(reference: WorkspaceFileReference, href?: string): PMNode {
  return feedMarkdownSchema.nodes.file_ref.create({
    path: reference.path,
    line: reference.line ?? null,
    column: reference.column ?? null,
    href: fileRefHref(reference, href),
  });
}

function linkMarkToFileRef(mark: Mark): PMNode | null {
  if (mark.type.name !== "link") return null;
  const href = String(mark.attrs.href ?? "");
  const reference = parseWorkspaceFileReferenceHref(href);
  if (!reference) return null;
  return createFileRefNode(reference, href);
}

/** Convert file-path link marks and bare path text into `file_ref` atoms (skip code marks). */
function rewriteFileReferences(node: PMNode): PMNode {
  if (node.type.name === "code_block") {
    return node;
  }
  if (node.isTextblock) {
    const pieces: PMNode[] = [];
    node.forEach((child) => {
      if (!child.isText) {
        pieces.push(rewriteFileReferences(child));
        return;
      }
      if (child.marks.some((mark) => mark.type.name === "code")) {
        pieces.push(child);
        return;
      }
      const link = child.marks.find((mark) => mark.type.name === "link");
      if (link) {
        const fileRef = linkMarkToFileRef(link);
        if (fileRef) {
          pieces.push(fileRef);
          return;
        }
        pieces.push(child);
        return;
      }
      const parts = linkifyWorkspaceFileReferences(child.text ?? "");
      if (!parts.some((part) => part.type === "link")) {
        pieces.push(child);
        return;
      }
      for (const part of parts) {
        if (part.type === "text") {
          if (part.value.length > 0) {
            pieces.push(feedMarkdownSchema.text(part.value, child.marks));
          }
        } else {
          pieces.push(createFileRefNode(part.reference));
        }
      }
    });
    return node.copy(Fragment.fromArray(pieces));
  }
  if (node.childCount === 0 || node.isLeaf) {
    return node;
  }
  const children: PMNode[] = [];
  node.forEach((child) => {
    children.push(rewriteFileReferences(child));
  });
  return node.copy(Fragment.fromArray(children));
}

export function createFeedMarkdownDoc(text: string): PMNode {
  let doc: PMNode;
  try {
    doc = feedMarkdownParser.parse(text);
  } catch {
    doc = feedMarkdownSchema.node("doc", null, [
      feedMarkdownSchema.node(
        "paragraph",
        null,
        text.length > 0 ? [feedMarkdownSchema.text(text)] : undefined,
      ),
    ]);
  }
  return rewriteFileReferences(doc);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function serializeInline(node: PMNode): string {
  if (node.type.name === "file_ref") {
    const reference: WorkspaceFileReference = {
      path: String(node.attrs.path),
      ...(node.attrs.line != null ? { line: Number(node.attrs.line) } : {}),
      ...(node.attrs.column != null ? { column: Number(node.attrs.column) } : {}),
    };
    const href = escapeHtml(String(node.attrs.href || fileRefHref(reference)));
    const title = escapeHtml(fileRefTitle(reference));
    const iconName = resolveMaterialIconName(reference.path);
    const iconUrl = escapeHtml(getMaterialIconUrl(iconName));
    const label = escapeHtml(formatWorkspaceFileReferenceLabel(reference));
    return (
      `<a href="${href}" class="markdown-file-ref" title="${title}" data-eco-file="1">` +
      `<img class="markdown-file-ref__icon" src="${iconUrl}" alt="" width="14" height="14" draggable="false" aria-hidden="true"/>` +
      `<span class="markdown-file-ref__label">${label}</span>` +
      `</a>`
    );
  }
  if (node.type.name === "hard_break") {
    return "<br/>";
  }
  if (node.isText) {
    let text = escapeHtml(node.text ?? "");
    for (const mark of node.marks) {
      if (mark.type.name === "code") {
        text = `<code class="markdown-inline-code">${text}</code>`;
      } else if (mark.type.name === "strong") {
        text = `<strong>${text}</strong>`;
      } else if (mark.type.name === "em") {
        text = `<em>${text}</em>`;
      } else if (mark.type.name === "strikethrough") {
        text = `<del>${text}</del>`;
      } else if (mark.type.name === "link") {
        const href = escapeHtml(String(mark.attrs.href ?? ""));
        text =
          `<a href="${href}"` +
          (mark.attrs.title ? ` title="${escapeHtml(String(mark.attrs.title))}"` : "") +
          ` target="_blank" rel="noreferrer noopener">${text}</a>`;
      }
    }
    return text;
  }
  let out = "";
  node.forEach((child) => {
    out += serializeInline(child);
  });
  return out;
}

function serializeCodeBlock(node: PMNode): string {
  const language = (String(node.attrs.params ?? "").trim() || "text").toLowerCase();
  const code = escapeHtml(node.textContent);
  return (
    `<div class="markdown-code-block">` +
    `<div class="markdown-code-block__toolbar">` +
    `<span class="markdown-code-block__language">${escapeHtml(language)}</span>` +
    `<div class="markdown-code-block__actions"></div>` +
    `</div>` +
    `<pre class="markdown-pre"><code class="language-${escapeHtml(language)}">${code}</code></pre>` +
    `</div>`
  );
}

function serializeTable(node: PMNode): string {
  let body = "";
  node.forEach((row) => {
    body += "<tr>";
    row.forEach((cell) => {
      const tag = cell.type.name === "table_header" ? "th" : "td";
      const colspan = Number(cell.attrs.colspan || 1);
      const rowspan = Number(cell.attrs.rowspan || 1);
      const attrs =
        (colspan > 1 ? ` colspan="${colspan}"` : "") +
        (rowspan > 1 ? ` rowspan="${rowspan}"` : "");
      body += `<${tag}${attrs}>${serializeInline(cell)}</${tag}>`;
    });
    body += "</tr>";
  });
  return `<table class="markdown-table"><tbody>${body}</tbody></table>`;
}

function serializeBlock(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph":
      return `<p>${serializeInline(node)}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
      return `<h${level}>${serializeInline(node)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${serializeChildren(node)}</blockquote>`;
    case "code_block":
      return serializeCodeBlock(node);
    case "bullet_list":
      return `<ul>${serializeChildren(node)}</ul>`;
    case "ordered_list":
      return `<ol>${serializeChildren(node)}</ol>`;
    case "list_item":
      return `<li>${serializeChildren(node)}</li>`;
    case "horizontal_rule":
      return `<hr/>`;
    case "table":
      return serializeTable(node);
    case "image": {
      const src = escapeHtml(String(node.attrs.src ?? ""));
      const alt = escapeHtml(String(node.attrs.alt ?? ""));
      const title = node.attrs.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : "";
      return `<img src="${src}" alt="${alt}"${title}/>`;
    }
    default:
      return serializeChildren(node);
  }
}

function serializeChildren(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    out += child.isInline ? serializeInline(child) : serializeBlock(child);
  });
  return out;
}

/** DOM-less HTML for SSR / renderToStaticMarkup tests. */
export function renderFeedMarkdownHtml(text: string): string {
  if (!text.trim()) return "";
  const doc = createFeedMarkdownDoc(text);
  return serializeChildren(doc);
}

function createCodeBlockNodeView(): NodeViewConstructor {
  return (node, _view, _getPos) => {
    const wrap = document.createElement("div");
    wrap.className = "markdown-code-block";

    const toolbar = document.createElement("div");
    toolbar.className = "markdown-code-block__toolbar";

    const language = document.createElement("span");
    language.className = "markdown-code-block__language";
    const lang = (String(node.attrs.params ?? "").trim() || "text").toLowerCase();
    language.textContent = lang;

    const actions = document.createElement("div");
    actions.className = "markdown-code-block__actions";

    const wrapBtn = document.createElement("button");
    wrapBtn.type = "button";
    wrapBtn.className = "markdown-code-block__action";
    wrapBtn.setAttribute("aria-label", i18n.t("markdown.code.wrap"));
    wrapBtn.title = i18n.t("markdown.code.wrap");

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "markdown-code-block__action";
    copyBtn.setAttribute("aria-label", i18n.t("common.copy"));
    copyBtn.title = i18n.t("common.copy");

    let wrapping = false;
    const wrapIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M3 12h15"/><path d="M3 18h18"/><path d="m19 9 3 3-3 3"/></svg>';
    const copyIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    const checkIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

    wrapBtn.innerHTML = wrapIcon;
    copyBtn.innerHTML = copyIcon;

    actions.append(wrapBtn, copyBtn);
    toolbar.append(language, actions);

    const pre = document.createElement("pre");
    pre.className = "markdown-pre";
    const code = document.createElement("code");
    if (lang) code.className = `language-${lang}`;
    pre.appendChild(code);

    wrap.append(toolbar, pre);

    wrapBtn.addEventListener("mousedown", (event) => event.preventDefault());
    wrapBtn.addEventListener("click", (event) => {
      event.preventDefault();
      wrapping = !wrapping;
      wrap.classList.toggle("is-wrap", wrapping);
      wrapBtn.classList.toggle("is-active", wrapping);
      const label = wrapping ? i18n.t("markdown.code.unwrap") : i18n.t("markdown.code.wrap");
      wrapBtn.setAttribute("aria-label", label);
      wrapBtn.title = label;
    });

    copyBtn.addEventListener("mousedown", (event) => event.preventDefault());
    copyBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const text = code.textContent ?? "";
      void copyTextToClipboard(text).then((ok) => {
        if (!ok) return;
        copyBtn.innerHTML = checkIcon;
        window.setTimeout(() => {
          copyBtn.innerHTML = copyIcon;
        }, 1400);
      });
    });

    return {
      dom: wrap,
      contentDOM: code,
      update(updated) {
        if (updated.type.name !== "code_block") return false;
        const nextLang = (String(updated.attrs.params ?? "").trim() || "text").toLowerCase();
        language.textContent = nextLang;
        code.className = nextLang ? `language-${nextLang}` : "";
        return true;
      },
    };
  };
}

export function createFeedMarkdownPlugins(): Plugin[] {
  return [
    new Plugin({
      props: {
        nodeViews: {
          code_block: createCodeBlockNodeView(),
        },
        handleDOMEvents: {
          click(_view, event) {
            const target = event.target;
            if (!(target instanceof Element)) return false;
            const anchor = target.closest("a");
            if (!(anchor instanceof HTMLAnchorElement)) return false;
            const href = anchor.getAttribute("href") ?? "";
            const reference = parseWorkspaceFileReferenceHref(href);
            if (reference) {
              event.preventDefault();
              dispatchWorkspaceFileReference(reference);
              return true;
            }
            if (anchor.classList.contains("markdown-file-ref")) {
              return false;
            }
            if (isHttpishHref(href)) {
              event.preventDefault();
              dispatchBrowserLinkOpen(href);
              return true;
            }
            return false;
          },
        },
        attributes: {
          class: "ProseMirror pm-feed-markdown-doc",
        },
      },
    }),
  ];
}

export const FEED_MARKDOWN_PLUGINS = createFeedMarkdownPlugins();
