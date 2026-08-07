export const BROWSER_LINK_OPEN_EVENT = "eco:browser-link-open";

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
