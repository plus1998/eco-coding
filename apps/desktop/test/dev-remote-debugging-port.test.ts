import { expect, test } from "bun:test";
import {
  DEFAULT_DEV_CDP_PORT,
  devRemoteDebuggingElectronArgs,
  resolveDevRemoteDebuggingPort,
} from "../scripts/dev-remote-debugging-port.mjs";

test("resolveDevRemoteDebuggingPort default", () => {
  expect(resolveDevRemoteDebuggingPort({})).toBe(DEFAULT_DEV_CDP_PORT);
});

test("devRemoteDebuggingElectronArgs", () => {
  expect(devRemoteDebuggingElectronArgs(undefined)).toEqual([]);
  expect(devRemoteDebuggingElectronArgs(9333)).toEqual(["--remote-debugging-port=9333"]);
});

test("ECO_DEV_CDP=0 disables port", () => {
  expect(resolveDevRemoteDebuggingPort({ ECO_DEV_CDP: "0" })).toBeUndefined();
});
