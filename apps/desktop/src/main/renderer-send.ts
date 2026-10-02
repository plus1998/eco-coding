import type { BrowserWindow } from "electron";

/** A BrowserWindow can outlive its crashed renderer or detached main frame. */
export function sendToLiveRenderer(window: BrowserWindow, channel: string, payload: unknown): boolean {
  if (window.isDestroyed()) return false;
  const contents = window.webContents;
  if (contents.isDestroyed() || contents.isCrashed()) return false;
  const frame = contents.mainFrame;
  if (frame.isDestroyed() || frame.detached) return false;
  contents.send(channel, payload);
  return true;
}
