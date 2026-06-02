import { expect, test } from "bun:test";
import { parseFinalizePlanInput } from "../src/finalize-plan";

test("parseFinalizePlanInput trims strings and defaults missing fields", () => {
  const parsed = parseFinalizePlanInput({
    analysis: "  a  ",
    plan: "\n\np\n",
    extra: 1,
  });
  expect(parsed.analysis).toBe("a");
  expect(parsed.plan).toBe("p");
  expect(parsed.rawInput).toHaveProperty("extra", 1);
});

test("parseFinalizePlanInput returns empty strings for non-string fields", () => {
  const parsed = parseFinalizePlanInput({
    analysis: 123,
    plan: null,
  } as unknown as Record<string, unknown>);
  expect(parsed.analysis).toBe("");
  expect(parsed.plan).toBe("");
});

