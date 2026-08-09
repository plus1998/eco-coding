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

test("exposes image view reads as a read-only RPC command", () => {
  expect(getRemoteCommandDefinition("image-view:read")).toMatchObject({
    risk: "read",
    requiredCapabilities: ["rpc:invoke"],
  });
  expect(validateRemoteCommandArgs("image-view:read", [{ path: "/tmp/photo.png" }])).toEqual({
    ok: true,
  });
  expect(validateRemoteCommandArgs("image-view:read", [{}])).toMatchObject({
    ok: false,
  });
});
