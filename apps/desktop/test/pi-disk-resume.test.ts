import { expect, test } from "bun:test";
import { resolvePiDiskResume } from "../src/main/pi-runtime-run";

test("resolvePiDiskResume requires pi binding and sessionFile only", () => {
  expect(
    resolvePiDiskResume({
      binding: undefined,
      cwd: "/w",
    }),
  ).toBeUndefined();

  expect(
    resolvePiDiskResume({
      binding: {
        coreKind: "claude",
        externalSessionId: "x",
        cwd: "/w",
        metadata: { sessionFile: "/w/s.jsonl", identityFingerprint: "id" },
      },
      cwd: "/w",
    }),
  ).toBeUndefined();

  expect(
    resolvePiDiskResume({
      binding: {
        coreKind: "pi",
        externalSessionId: "sess",
        cwd: "/w",
        metadata: {},
      },
      cwd: "/w",
    }),
  ).toBeUndefined();

  // cwd mismatch must not block resume — fingerprints still pass through for driver rebuild.
  expect(
    resolvePiDiskResume({
      binding: {
        coreKind: "pi",
        externalSessionId: "sess",
        cwd: "/other",
        metadata: {
          sessionFile: "/data/s.jsonl",
          identityFingerprint: "id1",
          mcpFingerprint: "mcp1",
        },
      },
      cwd: "/w",
    }),
  ).toEqual({
    sessionFile: "/data/s.jsonl",
    resumeIdentityFingerprint: "id1",
    resumeMcpFingerprint: "mcp1",
  });

  // sessionFile alone is enough; missing identity still resumes.
  expect(
    resolvePiDiskResume({
      binding: {
        coreKind: "pi",
        externalSessionId: "sess",
        cwd: "/w",
        metadata: { sessionFile: "/data/s.jsonl" },
      },
      cwd: "/w",
    }),
  ).toEqual({
    sessionFile: "/data/s.jsonl",
    resumeIdentityFingerprint: "",
    resumeMcpFingerprint: "",
  });

  expect(
    resolvePiDiskResume({
      binding: {
        coreKind: "pi",
        externalSessionId: "sess",
        cwd: "/w",
        metadata: {
          sessionFile: "/data/s.jsonl",
          identityFingerprint: "id1",
          mcpFingerprint: "mcp1",
        },
      },
      cwd: "/w",
    }),
  ).toEqual({
    sessionFile: "/data/s.jsonl",
    resumeIdentityFingerprint: "id1",
    resumeMcpFingerprint: "mcp1",
  });
});
