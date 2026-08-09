import { expect, test } from "bun:test";
import { getRemoteCommandDefinition, validateRemoteCommandArgs } from "../src/remote-command-registry";

test("exposes integration availability and project settings to mobile", () => {
  expect(getRemoteCommandDefinition("integration-availability:get")).toMatchObject({
    risk: "read",
    requiredCapabilities: ["rpc:invoke"],
  });
  expect(validateRemoteCommandArgs("integration-availability:get", [])).toEqual({ ok: true });

  expect(validateRemoteCommandArgs("project-integrations-settings:get", ["/repo"])).toEqual({
    ok: true,
  });
  expect(
    validateRemoteCommandArgs("project-integrations-settings:save", [
      {
        workspacePath: "/repo",
        enabled: { browser: true, imageGeneration: false },
      },
    ]),
  ).toEqual({ ok: true });
  expect(
    validateRemoteCommandArgs("project-integrations-settings:save", [{ workspacePath: "/repo" }]),
  ).toMatchObject({
    ok: false,
  });
});
