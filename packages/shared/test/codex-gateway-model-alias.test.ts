import { expect, test } from "bun:test";
import {
  buildCodexGatewayModelAlias,
  CODEX_GATEWAY_ROUTE_ALIAS_V1_PREFIX,
  InvalidCodexGatewayModelAliasError,
  parseCodexGatewayModelAlias,
} from "../src";

test("default Codex gateway alias remains byte-compatible with the legacy format", () => {
  const alias = buildCodexGatewayModelAlias("packyapi", "deepseek-v4-flash");
  expect(alias).toBe("eco_packyapi__deepseek-v4-flash");
  expect(parseCodexGatewayModelAlias(alias)).toEqual({
    providerId: "packyapi",
    upstreamModelId: "deepseek-v4-flash",
  });
});

test("V1 Codex gateway alias reversibly carries opaque ids and API compatibility", () => {
  const alias = buildCodexGatewayModelAlias(
    "provider.__/中文",
    "vendor/model.__测试",
    "openai_chat_completions",
  );
  expect(alias.startsWith(CODEX_GATEWAY_ROUTE_ALIAS_V1_PREFIX)).toBe(true);
  expect(parseCodexGatewayModelAlias(alias)).toEqual({
    providerId: "provider.__/中文",
    upstreamModelId: "vendor/model.__测试",
    apiCompat: "openai_chat_completions",
  });
});

test("V1 Codex gateway alias uses stable wire codes for every compatibility", () => {
  expect(buildCodexGatewayModelAlias("p", "m", "anthropic").split(".")[2]).toBe("a");
  expect(buildCodexGatewayModelAlias("p", "m", "openai_responses").split(".")[2]).toBe("r");
  expect(buildCodexGatewayModelAlias("p", "m", "openai_chat_completions").split(".")[2]).toBe("c");
});

test("malformed reserved V1 aliases fail closed", () => {
  for (const alias of [
    "eco_route_v1",
    "eco_route_v1.bad",
    "eco_route_v1.cA.x.bQ",
    "eco_route_v1.cA.toString.bQ",
    "eco_route_v1.***.a.bQ",
    "eco_route_v1.cA.a.b",
  ]) {
    expect(() => parseCodexGatewayModelAlias(alias)).toThrow(InvalidCodexGatewayModelAliasError);
  }
  expect(parseCodexGatewayModelAlias("ordinary-model")).toBeUndefined();
});

test("legacy providers whose ids merely start with route_v1 remain compatible", () => {
  expect(parseCodexGatewayModelAlias("eco_route_v1__model")).toEqual({
    providerId: "route_v1",
    upstreamModelId: "model",
  });
  expect(parseCodexGatewayModelAlias("eco_route_v1x__model")).toEqual({
    providerId: "route_v1x",
    upstreamModelId: "model",
  });
});

test("builder rejects an invalid runtime apiCompat instead of emitting an undefined wire code", () => {
  expect(() => buildCodexGatewayModelAlias("p", "m", "invalid" as "anthropic")).toThrow(
    "Unsupported Codex gateway apiCompat",
  );
});
