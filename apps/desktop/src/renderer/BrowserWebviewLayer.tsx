import { useBrowserWebviewInstances } from "./browser-state-store";
import { BrowserWebviewPersistentHost } from "./BrowserWebviewPersistentHost";
import { browserWebviewPool } from "./browser-webview-pool";

/**
 * App-root layer: owns persistent host slots and syncs the imperative guest pool
 * with main-process {@link BrowserViewState.allGuestInstances}.
 */
export function BrowserWebviewLayer() {
  const instances = useBrowserWebviewInstances();

  // Sync during render so release runs before React commits PersistentHost unmounts
  // (otherwise the slot div is deleted with the <webview> still inside).
  browserWebviewPool.sync(instances);

  return (
    <>
      {instances.map((instance) => (
        <BrowserWebviewPersistentHost key={instance.id} browserId={instance.id} />
      ))}
    </>
  );
}
