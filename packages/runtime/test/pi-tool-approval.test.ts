import { test, expect } from "bun:test";
import { mapPiToolNameToSdkToolName } from "../src/pi-tool-approval.js";

test("mapPiToolNameToSdkToolName maps web_search to WebSearch", () => {
  expect(mapPiToolNameToSdkToolName("web_search")).toBe("WebSearch");
});
