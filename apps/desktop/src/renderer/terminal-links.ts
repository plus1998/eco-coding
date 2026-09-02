import {
  type Terminal as GhosttyTerminalType,
  type ILink,
  type ILinkProvider,
  OSC8LinkProvider,
  UrlRegexProvider,
} from "ghostty-web";
import { dispatchBrowserLinkOpen, isHttpishHref } from "./browser-link";

/** Where a terminal URL click should go. */
export type TerminalLinkOpenTarget = "internal" | "external" | "none";

interface LinkDetectorRuntime {
  providers: ILinkProvider[];
  registerProvider(provider: ILinkProvider): void;
}

interface TerminalLinkRuntime {
  linkDetector?: LinkDetectorRuntime;
}

export function resolveTerminalLinkOpenTarget(
  url: string,
  modifiers: { metaKey: boolean; ctrlKey: boolean },
): TerminalLinkOpenTarget {
  const trimmed = url.trim();
  if (!trimmed) {
    return "none";
  }
  // Cmd/Ctrl+click → system browser (Electron setWindowOpenHandler → shell.openExternal for http(s)).
  if (modifiers.metaKey || modifiers.ctrlKey) {
    return "external";
  }
  // Plain click → built-in browser; only navigate http(s).
  if (isHttpishHref(trimmed)) {
    return "internal";
  }
  return "none";
}

/**
 * Open a detected terminal URL according to modifier keys.
 * Returns the resolved target (useful for tests / callers that want no window side effects).
 */
export function activateTerminalLink(
  url: string,
  event: Pick<MouseEvent, "metaKey" | "ctrlKey" | "preventDefault">,
): TerminalLinkOpenTarget {
  const target = resolveTerminalLinkOpenTarget(url, event);
  if (target === "none") {
    return target;
  }
  event.preventDefault();
  if (target === "external") {
    if (typeof window !== "undefined") {
      window.open(url.trim(), "_blank", "noopener,noreferrer");
    }
    return target;
  }
  dispatchBrowserLinkOpen(url.trim());
  return target;
}

function wrapLinkProvider(
  provider: ILinkProvider,
  onActivate: (url: string, event: MouseEvent) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      provider.provideLinks(y, (links) => {
        if (!links?.length) {
          callback(undefined);
          return;
        }
        callback(
          links.map(
            (link: ILink): ILink => ({
              ...link,
              activate: (event) => onActivate(link.text, event),
            }),
          ),
        );
      });
    },
    dispose: () => provider.dispose?.(),
  };
}

/**
 * Replace ghostty-web default link providers so plain click opens the in-app browser
 * and Cmd/Ctrl+click opens the system browser.
 *
 * ghostty-web hardcodes activate → window.open only with modifier; we re-register after open.
 */
export function installTerminalLinkHandling(terminal: GhosttyTerminalType): () => void {
  const detector = (terminal as unknown as TerminalLinkRuntime).linkDetector;
  if (!detector) {
    return () => undefined;
  }

  detector.providers.length = 0;
  detector.registerProvider(wrapLinkProvider(new OSC8LinkProvider(terminal), activateTerminalLink));
  detector.registerProvider(wrapLinkProvider(new UrlRegexProvider(terminal), activateTerminalLink));

  return () => {
    // Terminal.dispose tears down the detector; nothing else to clean up.
  };
}
