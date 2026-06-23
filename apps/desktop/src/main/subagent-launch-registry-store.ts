import { SubagentLaunchRegistry } from "@eco/runtime/sdk";

const registriesByThread = new Map<string, SubagentLaunchRegistry>();

export function getThreadSubagentLaunchRegistry(threadId: string): SubagentLaunchRegistry {
  let registry = registriesByThread.get(threadId);
  if (!registry) {
    registry = new SubagentLaunchRegistry();
    registriesByThread.set(threadId, registry);
  }
  return registry;
}

export function clearThreadSubagentLaunchRegistry(threadId: string): void {
  registriesByThread.delete(threadId);
}
