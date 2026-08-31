import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const indexSource = readFileSync(
  fileURLToPath(new URL("../src/main/index.ts", import.meta.url)),
  "utf8",
);
const identitySource = readFileSync(
  fileURLToPath(new URL("../src/main/desktop-app-identity.ts", import.meta.url)),
  "utf8",
);
const devScriptSource = readFileSync(
  fileURLToPath(new URL("../scripts/dev.mjs", import.meta.url)),
  "utf8",
);

test("dev identity uses userData suffix and app.isPackaged gate", () => {
  expect(identitySource).toContain("if (app.isPackaged)");
  expect(identitySource).toContain("ECO_DEV_USER_DATA_SUFFIX");
  expect(identitySource).toContain('app.getPath("userData") + suffix');
  expect(identitySource).toContain("app.setAppLogsPath");
  expect(identitySource).toContain('app.setName(DESKTOP_DEV_APP_NAME)');
  expect(identitySource).not.toContain("setAppUserModelId");
});

test("main process configures dev identity before single-instance lock", () => {
  expect(indexSource).toContain('import { configureDesktopDevIdentity } from "./desktop-app-identity"');
  expect(indexSource).toMatch(
    /configureDesktopDevIdentity\(\);\s*\n\s*\/\/ The shared SQLite store and fixed-port gateway require a single main-process writer\.\s*\nconst hasSingleInstanceLock = app\.requestSingleInstanceLock\(\);/,
  );
  expect(devScriptSource).toContain("ECO_DEV_USER_DATA_SUFFIX");
});
