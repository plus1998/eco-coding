import { ipcMain } from "electron";
import { CodexOAuthLoginService } from "./codex-oauth-login";
import { resolveCodexExecutable } from "./codex-runtime-run";

let codexLoginService: CodexOAuthLoginService | null = null;

export function configureCodexOAuthIpc(ecoDataDir: string) {
  const codexHomeDir = `${ecoDataDir}/codex`;
  const codexExecutable = resolveCodexExecutable();

  if (codexExecutable) {
    codexLoginService = new CodexOAuthLoginService(codexHomeDir, codexExecutable);
  }

  ipcMain.handle("codex-oauth:get-status", async () => {
    if (!codexLoginService) {
      return { isLoggedIn: false, message: "Codex CLI 未找到" };
    }
    return codexLoginService.getStatus();
  });

  ipcMain.handle("codex-oauth:start-login", async () => {
    if (!codexLoginService) {
      return { success: false, message: "Codex CLI 未找到" };
    }
    return codexLoginService.startLogin();
  });

  ipcMain.handle("codex-oauth:logout", async () => {
    if (!codexLoginService) {
      return { success: false, message: "Codex CLI 未找到" };
    }
    return codexLoginService.logout();
  });
}
