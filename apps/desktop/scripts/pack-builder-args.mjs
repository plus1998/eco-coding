/**
 * Shared electron-builder CLI arg helpers for pack-release / pack-local.
 *
 * `--dir` / `--unpacked` skip distributor artifacts (dmg, zip, nsis, AppImage, …)
 * and pack only the unpacked app directory for faster local testing.
 */

const UNPACKED_FLAGS = new Set(["--dir", "--unpacked"]);
const PLATFORM_FLAGS = new Set(["--mac", "--win", "--linux", "-m", "-w", "-l"]);

/**
 * @param {string[]} argv
 * @returns {{ unpacked: boolean, args: string[] }}
 */
export function resolveElectronBuilderCliArgs(argv) {
  const unpacked = argv.some((arg) => UNPACKED_FLAGS.has(arg));
  const withoutFlags = argv.filter((arg) => !UNPACKED_FLAGS.has(arg));
  if (!unpacked) {
    return { unpacked: false, args: withoutFlags };
  }

  const args = [];
  for (let i = 0; i < withoutFlags.length; i++) {
    const arg = withoutFlags[i];
    args.push(arg);
    if (!PLATFORM_FLAGS.has(arg)) {
      continue;
    }
    while (i + 1 < withoutFlags.length && !withoutFlags[i + 1].startsWith("-")) {
      i++;
    }
    args.push("dir");
  }

  return { unpacked: true, args };
}
