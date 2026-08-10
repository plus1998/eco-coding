import type { Input } from "electron";

export function isReloadShortcutInput(input: Pick<Input, "type" | "key" | "control" | "meta">): boolean {
  return input.type === "keyDown" && input.key.toLowerCase() === "r" && (input.control || input.meta);
}
