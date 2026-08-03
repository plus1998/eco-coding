import { expect, test } from "bun:test";
import {
  getRemoteCommandDefinition,
  isRemoteCommandChannel,
  validateRemoteCommandArgs,
} from "../src/remote-command-registry";

test("exposes ASR transcription remotely without exposing authenticated client config", () => {
  expect(isRemoteCommandChannel("asr-settings:get-client-config")).toBe(false);
  expect(getRemoteCommandDefinition("asr:transcribe")).toMatchObject({
    channel: "asr:transcribe",
    risk: "execute",
    requiredCapabilities: ["rpc:invoke"],
    requiresConfirmation: false,
  });
  expect(
    validateRemoteCommandArgs("asr:transcribe", [{ audioWavBase64: "UklGRg==", profileId: "profile_1" }]),
  ).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("asr:transcribe", [{ profileId: "profile_1" }])).toMatchObject({
    ok: false,
  });
});
