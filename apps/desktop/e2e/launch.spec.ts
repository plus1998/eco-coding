import { expect, test } from "./fixtures/electron-app";
import { waitForEcoReady } from "./helpers/eco-page";

test("launches Electron and exposes window.eco", async ({ ecoPage: page }) => {
  await waitForEcoReady(page);
  const hasEco = await page.evaluate(() => typeof window.eco?.listThreads === "function");
  expect(hasEco).toBe(true);
  console.log(`[launch] ok title=${JSON.stringify(await page.title())} url=${page.url()}`);
});
