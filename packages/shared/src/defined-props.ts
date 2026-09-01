type DefinedProps<T extends Record<string, unknown>> = {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
};

/** Drop keys whose values are `undefined` (for exactOptionalPropertyTypes call sites). */
export function definedProps<T extends Record<string, unknown>>(value: T): DefinedProps<T> {
  const out = {} as DefinedProps<T>;
  for (const key of Object.keys(value) as (keyof T)[]) {
    const entry = value[key];
    if (entry !== undefined) {
      (out as Record<string, unknown>)[key as string] = entry;
    }
  }
  return out;
}
