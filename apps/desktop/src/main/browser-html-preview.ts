import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ECO_HTML_PREVIEW_FILE_PREFIX } from "../shared/browser";

export function writeBrowserHtmlPreviewTempFile(html: string): string {
  const fileName = `${ECO_HTML_PREVIEW_FILE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.html`;
  const filePath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(filePath, html, "utf8");
  return pathToFileURL(filePath).href;
}
