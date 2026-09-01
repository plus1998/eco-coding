import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  RECORDING_CELL_SPECS,
  cellKey,
  discoverGatewayClientRoundCells,
} from "../../desktop/src/feed-replay/gateway-client-round-fixture";
import { listDiscoveredMatrixCells } from "../../desktop/src/feed-replay/gateway-client-round-feed-replay";

interface UpstreamExchange {
  profileId: string;
  response: {
    bodyArtifact?: { file: string };
  };
}

function hasClientRoundCells(): boolean {
  return discoverGatewayClientRoundCells().size > 0;
}

function loadUpstreamExchanges(cellDir: string, runDir: string): UpstreamExchange[] {
  const cellLog = path.join(cellDir, "upstream-via-gateway.jsonl");
  const runLog = path.join(runDir, "upstream-via-gateway.jsonl");
  const logPath = fs.existsSync(cellLog) ? cellLog : runLog;
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UpstreamExchange);
}

describe.skipIf(!hasClientRoundCells())("gateway client-round fixture replay", () => {
  test("matrix coverage report", () => {
    const cells = listDiscoveredMatrixCells();
    const discovered = new Set(cells.map((cell) => cellKey(cell.client, cell.profileId)));
    const missing = RECORDING_CELL_SPECS.filter((spec) => !discovered.has(cellKey(spec.client, spec.profileId)));
    console.log(`recorded ${cells.length}/${RECORDING_CELL_SPECS.length} cells`);
    if (missing.length > 0) {
      console.log(`missing: ${missing.map((spec) => cellKey(spec.client, spec.profileId)).join(", ")}`);
    }
    expect(cells.length).toBeGreaterThan(0);
  });

  test("each discovered cell has checklist + upstream artifacts", () => {
    for (const cell of listDiscoveredMatrixCells()) {
      const runDir = path.dirname(path.dirname(cell.dir));
      const exchanges = loadUpstreamExchanges(cell.dir, runDir).filter((row) => row.profileId === cell.profileId);
      expect(exchanges.length, `${cell.client}/${cell.profileId} exchanges`).toBeGreaterThan(0);
      expect(cell.checklistOk, `${cell.client}/${cell.profileId} checklist`).toBe(true);

      const artifactDir = path.join(runDir, "artifacts");
      for (const exchange of exchanges) {
        const artifact = exchange.response.bodyArtifact?.file;
        if (!artifact) {
          continue;
        }
        expect(fs.existsSync(path.join(artifactDir, artifact))).toBe(true);
      }
    }
  });
});
