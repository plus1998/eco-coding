import { expect, test } from "bun:test";
import {
  COMPUTER_USE_AGENT_PRESENCE_IDLE_MS,
  isComputerUsePointerToolLeaf,
  isEcoComputerUseToolName,
  parseComputerUsePointerFromToolInput,
} from "../src/shared/computer-use-agent-presence";

test("isEcoComputerUseToolName matches eco server tools only", () => {
  expect(isEcoComputerUseToolName("mcp__eco_computer_use__click")).toBe(true);
  expect(isEcoComputerUseToolName("eco_computer_use")).toBe(true);
  expect(isEcoComputerUseToolName("mcp__eco-computer-use__click")).toBe(true);
  expect(isEcoComputerUseToolName("open-computer-use")).toBe(true);
  expect(isEcoComputerUseToolName("mcp__eco_agent_browser__agent_browser_click")).toBe(false);
  expect(isEcoComputerUseToolName("click")).toBe(false);
  expect(isEcoComputerUseToolName(undefined)).toBe(false);
});

test("parseComputerUsePointerFromToolInput reads click and drag coords", () => {
  expect(parseComputerUsePointerFromToolInput({ x: 12, y: 34 })).toEqual({
    kind: "click",
    x: 12,
    y: 34,
  });
  expect(parseComputerUsePointerFromToolInput({ x: 1, y: 2, end_x: 9, end_y: 8 })).toEqual({
    kind: "drag",
    x: 1,
    y: 2,
    endX: 9,
    endY: 8,
  });
  expect(parseComputerUsePointerFromToolInput({ start_x: 3, start_y: 4, end_x: 30, end_y: 40 })).toEqual({
    kind: "drag",
    x: 3,
    y: 4,
    endX: 30,
    endY: 40,
  });
  expect(parseComputerUsePointerFromToolInput({ element_index: "2" })).toBeUndefined();
  expect(parseComputerUsePointerFromToolInput(undefined)).toBeUndefined();
});

test("isComputerUsePointerToolLeaf", () => {
  expect(isComputerUsePointerToolLeaf("mcp__eco_computer_use__click")).toBe(true);
  expect(isComputerUsePointerToolLeaf("drag")).toBe(true);
  expect(isComputerUsePointerToolLeaf("list_apps")).toBe(false);
});

test("idle timeout is 15s", () => {
  expect(COMPUTER_USE_AGENT_PRESENCE_IDLE_MS).toBe(15_000);
});
