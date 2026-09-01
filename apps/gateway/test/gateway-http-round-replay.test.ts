import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  buildProviderFromProfileId,
  loadGatewayHttpRoundFixture,
  readExchangeBody,
  replayGatewayClientExchange,
  resolveGatewayHttpRoundFixtureDir,
} from "./helpers/gateway-http-round-fixture";

function hasGatewayFixture(): boolean {
  try {
    resolveGatewayHttpRoundFixtureDir("gateway");
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasGatewayFixture())("gateway HTTP round replay", () => {
  const fixture = loadGatewayHttpRoundFixture("gateway");

  test("fixture summary marks recorded profiles", () => {
    expect(fixture.exchanges.length).toBeGreaterThan(0);
    const profiles = fixture.summary.profiles as Record<string, unknown> | undefined;
    expect(profiles && Object.keys(profiles).length).toBeGreaterThan(0);
  });

  for (const profileId of ["packy_anthropic", "longcat_chat"]) {
    test(`${profileId} gateway client replay matches recorded artifacts`, async () => {
      const clientExchanges = fixture.exchanges.filter(
        (e) => e.layer === "gateway-client" && e.profileId === profileId && e.ok,
      );
      if (clientExchanges.length === 0) {
        return;
      }
      const upstreamFixtureDir = resolveGatewayHttpRoundFixtureDir("gateway", fixture.runId);
      const upstreamLog = fs.readFileSync(path.join(upstreamFixtureDir, "upstream-via-gateway.jsonl"), "utf8");
      const upstreamExchanges = upstreamLog
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const provider = buildProviderFromProfileId(profileId);
      for (const clientExchange of clientExchanges) {
        const upstreamExchange = upstreamExchanges.find(
          (row: { profileId?: string; scenarioId?: string }) =>
            row.profileId === profileId && row.scenarioId === clientExchange.scenarioId,
        );
        if (!upstreamExchange) continue;

        const replayed = await replayGatewayClientExchange({
          provider,
          clientExchange,
          upstreamExchange,
          fixture,
        });
        expect(replayed.status).toBe(clientExchange.response.status);

        const expectedBody = readExchangeBody(fixture, clientExchange);
        const actualBody = await replayed.text();
        expect(actualBody).toBe(expectedBody);
      }
    });
  }
});
