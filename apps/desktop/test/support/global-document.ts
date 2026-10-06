/**
 * Installs a global and puts it back exactly as it was.
 *
 * `Object.defineProperty(globalThis, name, { value })` creates a **read-only** property:
 * `writable` defaults to false, so restoring the global with another `defineProperty` left it
 * permanently non-writable and every later file that assigned its own mock died with
 * "Attempted to assign to readonly property". That is how the browser pool, guest bridge and
 * terminal link tests read red only in a full run. Restoring means putting the original
 * descriptor back (or deleting the property if there was none), never just its value.
 */
export function withGlobalProperty<T>(name: string, value: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  const restore = () => {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  let result: T;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  // An async body would otherwise see the global restored before it runs.
  if (result instanceof Promise) {
    return result.finally(restore) as T;
  }
  restore();
  return result;
}

export function withGlobalDocument<T>(value: unknown, run: () => T): T {
  return withGlobalProperty("document", value, run);
}

export function withGlobalWindow<T>(value: unknown, run: () => T): T {
  return withGlobalProperty("window", value, run);
}
