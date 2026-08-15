import { createMarkdownTableRepair } from "./table";
import type { MarkdownRepair } from "./types";

export { normalizeColumnCountFixer } from "./normalize-column-count";
export {
  createMarkdownTableRepair,
  defaultTableDetectors,
  defaultTableFixers,
  gfmHeaderSeparatorDetector,
  isTableSeparator,
  serializeMarkdownTable,
  splitTableRow,
} from "./table";
export type {
  MarkdownRepair,
  MarkdownTable,
  MarkdownTableAlignment,
  MarkdownTableBlock,
  MarkdownTableDetector,
  MarkdownTableFixer,
  MarkdownTableRepairOptions,
} from "./types";

/**
 * Default pipeline: GFM tables with a header+separator, column-count only.
 *
 * Not in v1: missing separator, blockquote/list tables, unclosed pipes / whitespace
 * unless a column-count rewrite already emits canonical GFM.
 */
export const defaultMarkdownRepairs: readonly MarkdownRepair[] = [createMarkdownTableRepair()];

export function repairMarkdown(
  markdown: string,
  repairs: readonly MarkdownRepair[] = defaultMarkdownRepairs,
): string {
  return repairs.reduce((text, repair) => repair.apply(text), markdown);
}
