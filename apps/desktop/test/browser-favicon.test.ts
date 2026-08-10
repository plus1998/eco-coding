import { expect, test } from "bun:test";
import { pickBrowserFaviconUrl } from "../src/shared/browser";

test("pickBrowserFaviconUrl prefers https image urls", () => {
  expect(
    pickBrowserFaviconUrl([
      "  ",
      "chrome://favicon/size/16@1x/https://example.com",
      "https://www.deepseek.com/favicon.ico",
    ]),
  ).toBe("https://www.deepseek.com/favicon.ico");
});

test("pickBrowserFaviconUrl accepts data image urls", () => {
  const data = "data:image/png;base64,abc";
  expect(pickBrowserFaviconUrl([data])).toBe(data);
});

test("pickBrowserFaviconUrl returns undefined when empty", () => {
  expect(pickBrowserFaviconUrl(undefined)).toBeUndefined();
  expect(pickBrowserFaviconUrl([])).toBeUndefined();
  expect(pickBrowserFaviconUrl(["chrome://theme/IDR_DEFAULT_FAVICON"])).toBeUndefined();
});
