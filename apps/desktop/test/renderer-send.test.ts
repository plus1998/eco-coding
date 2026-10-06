import { expect, test } from "bun:test";
import type { BrowserWindow } from "electron";
import { sendToLiveRenderer } from "../src/main/renderer-send";

function makeWindow(
  state: {
    closed?: boolean;
    destroyed?: boolean;
    crashed?: boolean;
    frameDestroyed?: boolean;
    detached?: boolean;
  } = {},
) {
  const sent: unknown[][] = [];
  const window = {
    isDestroyed: () => state.closed ?? false,
    get webContents() {
      if (state.closed) throw new Error("Accessed a closed window");
      return {
        isDestroyed: () => state.destroyed ?? false,
        isCrashed: () => state.crashed ?? false,
        get mainFrame() {
          if (state.destroyed || state.crashed) throw new Error("Accessed a disposed main frame");
          return {
            isDestroyed: () => state.frameDestroyed ?? false,
            detached: state.detached ?? false,
          };
        },
        send: (...args: unknown[]) => sent.push(args),
      };
    },
  } as unknown as BrowserWindow;
  return { window, sent, state };
}

test("skips dead renderers before accessing their disposed frame", () => {
  for (const state of [
    { closed: true },
    { destroyed: true },
    { crashed: true },
    { frameDestroyed: true },
    { detached: true },
  ]) {
    const { window, sent } = makeWindow(state);
    expect(sendToLiveRenderer(window, "conversation:sync", { seq: 1 })).toBe(false);
    expect(sent).toHaveLength(0);
  }
});

test("a crashed window does not block other windows and can receive after recovery", () => {
  const crashed = makeWindow({ crashed: true });
  const live = makeWindow();
  for (const { window } of [crashed, live]) {
    sendToLiveRenderer(window, "conversation:sync", { seq: 2 });
  }
  expect(crashed.sent).toHaveLength(0);
  expect(live.sent).toEqual([["conversation:sync", { seq: 2 }]]);
  crashed.state.crashed = false;
  expect(sendToLiveRenderer(crashed.window, "conversation:sync", { seq: 3 })).toBe(true);
  expect(crashed.sent).toEqual([["conversation:sync", { seq: 3 }]]);
});

test("does not hide serialization errors from a live renderer", () => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isCrashed: () => false,
      mainFrame: { isDestroyed: () => false, detached: false },
      send: () => {
        throw new Error("An object could not be cloned");
      },
    },
  } as unknown as BrowserWindow;
  expect(() => sendToLiveRenderer(window, "test", Symbol("invalid"))).toThrow("could not be cloned");
});
