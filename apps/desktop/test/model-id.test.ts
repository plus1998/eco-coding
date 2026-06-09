import { expect, test } from "bun:test";
import { formatRoleModelLabel } from "@eco/runtime";
import { isEcoSdkModelAlias, pickDisplayModelId } from "../src/shared/model-id";

test("isEcoSdkModelAlias matches runtime eco-role-hash aliases", () => {
  expect(isEcoSdkModelAlias("eco-planner-59c6458bbc15")).toBe(true);
  expect(isEcoSdkModelAlias("eco-coder-a1b2c3d4e5f6")).toBe(true);
  expect(isEcoSdkModelAlias("eco-planner")).toBe(false);
  expect(isEcoSdkModelAlias("claude-opus-4-7")).toBe(false);
});

test("pickDisplayModelId prefers configured upstream over SDK alias live value", () => {
  expect(
    pickDisplayModelId("eco-planner-59c6458bbc15", "claude-opus-4-7"),
  ).toBe("claude-opus-4-7");
  expect(pickDisplayModelId("claude-haiku-4-5", "claude-opus-4-7")).toBe("claude-haiku-4-5");
  expect(pickDisplayModelId(undefined, "claude-opus-4-7")).toBe("claude-opus-4-7");
  expect(pickDisplayModelId("eco-coder-a1b2c3d4e5f6", undefined)).toBeUndefined();
});

test("formatRoleModelLabel with pickDisplayModelId does not show eco alias", () => {
  const modelId = pickDisplayModelId("eco-planner-59c6458bbc15", "claude-opus-4-7");
  expect(formatRoleModelLabel("planner", modelId)).toBe("主代理 · claude-opus-4-7");
});
