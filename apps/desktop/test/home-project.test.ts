import { test, expect } from "bun:test";
import {
  buildHomeProjectPath,
  HOME_PROJECT_DISPLAY_NAME,
  isHomeProjectPath,
  normalizeProjectPath,
} from "../src/shared/home-project";

test("buildHomeProjectPath resolves under homedir", () => {
  expect(buildHomeProjectPath("/Users/plus")).toBe("/Users/plus/.eco/projects/home");
});

test("isHomeProjectPath normalizes paths before comparing", () => {
  const homePath = "/Users/plus/.eco/projects/home";
  expect(isHomeProjectPath("/Users/plus/.eco/projects/home/", homePath)).toBe(true);
  expect(isHomeProjectPath("\\Users\\plus\\.eco\\projects\\home", homePath)).toBe(true);
  expect(isHomeProjectPath("/Users/plus/other", homePath)).toBe(false);
});

test("normalizeProjectPath produces a stable project identity", () => {
  expect(normalizeProjectPath("C:\\Users\\plus\\.eco\\projects\\home\\")).toBe(
    "C:/Users/plus/.eco/projects/home",
  );
});

test("HOME_PROJECT_DISPLAY_NAME is Home", () => {
  expect(HOME_PROJECT_DISPLAY_NAME).toBe("Home");
});
