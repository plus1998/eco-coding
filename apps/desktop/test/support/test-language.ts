import { afterEach, beforeEach } from "bun:test";
import { i18n } from "../../src/renderer/i18n";

/**
 * Runs a test file in one language and puts the renderer's language back afterwards.
 *
 * `i18n` is module state shared by every file in a `bun test` process. A file that switches
 * the language and leaves it switched does not fail itself: it fails every later file that
 * asserts a localized string, so the suite reads red only in a full run and each red looks
 * unrelated to its cause. Use this instead of calling `i18n.changeLanguage` in a `beforeEach`
 * without a matching restore.
 */
export function withTestLanguage(language: string): void {
  const previous = () => i18n.resolvedLanguage ?? i18n.language;
  let restoreTo = previous();

  beforeEach(async () => {
    restoreTo = restoreTo || previous();
    await i18n.changeLanguage(language);
  });

  afterEach(async () => {
    if (i18n.language !== restoreTo) {
      await i18n.changeLanguage(restoreTo);
    }
  });
}
