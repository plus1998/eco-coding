import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} masterLogPath
 * @param {{ client: string, profileId: string }} cell
 */
export function countCellUpstreamExchanges(masterLogPath, cell) {
  return filterCellUpstreamExchanges(masterLogPath, cell).length;
}

/**
 * @param {string} masterLogPath
 * @param {{ client: string, profileId: string }} cell
 */
export function filterCellUpstreamExchanges(masterLogPath, cell) {
  if (!fs.existsSync(masterLogPath)) return [];
  return fs
    .readFileSync(masterLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.client === cell.client && row.profileId === cell.profileId);
}

/**
 * @param {string} masterLogPath
 * @param {string} cellLogPath
 * @param {{ client: string, profileId: string }} cell
 */
export function writeCellUpstreamLog(masterLogPath, cellLogPath, cell) {
  const rows = filterCellUpstreamExchanges(masterLogPath, cell);
  fs.mkdirSync(path.dirname(cellLogPath), { recursive: true });
  fs.writeFileSync(cellLogPath, rows.length ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "");
  return rows.length;
}

/**
 * @param {string} runDir
 * @param {string} client
 * @param {string} profileId
 */
export function resolveCellDir(runDir, client, profileId) {
  return path.join(runDir, client, profileId);
}
