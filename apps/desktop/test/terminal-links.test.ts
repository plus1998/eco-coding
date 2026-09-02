import { describe, expect, test } from "bun:test";
import { activateTerminalLink, resolveTerminalLinkOpenTarget } from "../src/renderer/terminal-links";

describe("resolveTerminalLinkOpenTarget", () => {
  test("plain click on http(s) opens internal browser", () => {
    expect(
      resolveTerminalLinkOpenTarget("https://example.com/docs", {
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("internal");
    expect(
      resolveTerminalLinkOpenTarget("http://localhost:3000", {
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("internal");
  });

  test("Cmd or Ctrl click opens external browser", () => {
    expect(
      resolveTerminalLinkOpenTarget("https://example.com", {
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe("external");
    expect(
      resolveTerminalLinkOpenTarget("https://example.com", {
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe("external");
  });

  test("plain click ignores non-http schemes and empty", () => {
    expect(
      resolveTerminalLinkOpenTarget("mailto:a@b.com", {
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("none");
    expect(
      resolveTerminalLinkOpenTarget("ftp://files.example.com", {
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe("none");
    expect(resolveTerminalLinkOpenTarget("  ", { metaKey: false, ctrlKey: false })).toBe("none");
  });

  test("modifier still selects external for non-http schemes", () => {
    expect(
      resolveTerminalLinkOpenTarget("mailto:a@b.com", {
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe("external");
  });
});

function withMockWindow(
  run: (state: {
    events: Array<{ type: string; detail: unknown }>;
    opened: Array<{ url: string; target: string; features: string }>;
  }) => void,
): void {
  const events: Array<{ type: string; detail: unknown }> = [];
  const opened: Array<{ url: string; target: string; features: string }> = [];
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;

  class MockCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  (globalThis as { CustomEvent: unknown }).CustomEvent = MockCustomEvent;
  (globalThis as { window: unknown }).window = {
    dispatchEvent(event: { type: string; detail?: unknown }) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    open(url?: string | URL, target?: string, features?: string) {
      opened.push({
        url: String(url ?? ""),
        target: target ?? "",
        features: features ?? "",
      });
      return null;
    },
  };
  try {
    run({ events, opened });
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = previousWindow;
    }
    if (previousCustomEvent === undefined) {
      delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
    } else {
      (globalThis as { CustomEvent: unknown }).CustomEvent = previousCustomEvent;
    }
  }
}

describe("activateTerminalLink", () => {
  test("internal path prevents default and dispatches browser event", () => {
    withMockWindow(({ events }) => {
      let prevented = false;
      const target = activateTerminalLink("https://example.com/x", {
        metaKey: false,
        ctrlKey: false,
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(target).toBe("internal");
      expect(prevented).toBe(true);
      expect(events).toEqual([{ type: "eco:browser-link-open", detail: "https://example.com/x" }]);
    });
  });

  test("external path prevents default and uses window.open", () => {
    withMockWindow(({ opened }) => {
      let prevented = false;
      const target = activateTerminalLink("https://example.com/ext", {
        metaKey: true,
        ctrlKey: false,
        preventDefault: () => {
          prevented = true;
        },
      });
      expect(target).toBe("external");
      expect(prevented).toBe(true);
      expect(opened).toEqual([
        {
          url: "https://example.com/ext",
          target: "_blank",
          features: "noopener,noreferrer",
        },
      ]);
    });
  });
});
