/**
 * Shared utilities for Zustand stores.
 */

/** Pick only the keys present in `dataKeys` from `data`. */
export function pickData<T extends Record<string, unknown>>(data: Partial<T>, dataKeys: string[]): Partial<T> {
  const result: Partial<T> = {};
  for (const key of dataKeys) {
    if (key in data) (result as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
  }
  return result;
}
