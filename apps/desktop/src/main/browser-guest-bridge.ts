import type { BrowserWindow, WebContents, WebPreferences } from "electron";
import { BROWSER_WEBVIEW_TAB_ID_ATTR } from "../shared/browser";
import type { BrowserHost } from "./browser-host";

/**
 * Wire Electron `<webview>` guest attach to BrowserHost.
 * Renderer owns the DOM webview; main process receives guest WebContents for CDP.
 */
export function installBrowserGuestBridge(mainWindow: BrowserWindow, host: BrowserHost): () => void {
  const onWillAttach = (
    _event: Electron.Event,
    webPreferences: WebPreferences,
    params: Record<string, string>,
  ) => {
    webPreferences.sandbox = true;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.javascript = true;
    const partition = params.partition?.trim();
    if (partition) {
      webPreferences.partition = partition;
    }
    const browserId = params[BROWSER_WEBVIEW_TAB_ID_ATTR]?.trim();
    if (browserId) {
      host.notePendingGuestAttach(browserId);
    }
  };

  const onDidAttach = (_event: Electron.Event, guestWebContents: WebContents) => {
    const browserId = host.consumePendingGuestAttach(guestWebContents.id);
    if (browserId) {
      host.registerGuestWebContents(browserId, guestWebContents);
    }
  };

  const wc = mainWindow.webContents;
  wc.on("will-attach-webview", onWillAttach);
  wc.on("did-attach-webview", onDidAttach);

  return () => {
    if (wc.isDestroyed()) {
      return;
    }
    wc.removeListener("will-attach-webview", onWillAttach);
    wc.removeListener("did-attach-webview", onDidAttach);
  };
}
