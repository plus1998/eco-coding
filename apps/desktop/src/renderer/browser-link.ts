import { buildHtmlDataNavigateUrl } from "../shared/browser";

export const BROWSER_LINK_OPEN_EVENT = "eco:browser-link-open";
export const BROWSER_HTML_OPEN_EVENT = "eco:browser-html-open";

export function isHttpishHref(href: string): boolean {
  try {
    const parsed = new URL(href, "https://example.invalid");
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    // Absolute URL only; relative paths are not browser navigations from feed.
    return false;
  } catch {
    return false;
  }
}

export function dispatchBrowserLinkOpen(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<string>(BROWSER_LINK_OPEN_EVENT, {
      detail: url,
    }),
  );
}

export function dispatchBrowserHtmlOpen(html: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<string>(BROWSER_HTML_OPEN_EVENT, {
      detail: html,
    }),
  );
}

/**
 * Open a hosted HTML page in Eco's built-in browser.
 * Cloud shared domains often serve text/plain — fetch body and open as HTML instead of loadURL.
 */
export async function openPublishedHtmlInBrowser(publicUrl: string): Promise<void> {
  try {
    const response = await fetch(publicUrl);
    const html = (await response.text()).trim();
    if (html) {
      const dataUrl = buildHtmlDataNavigateUrl(html);
      if (dataUrl) {
        dispatchBrowserLinkOpen(dataUrl);
        return;
      }
      dispatchBrowserHtmlOpen(html);
      return;
    }
  } catch {
    // fall through
  }
  dispatchBrowserLinkOpen(publicUrl);
}
