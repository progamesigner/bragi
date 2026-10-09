/** localStorage can be missing or throw (private mode, blocked site data), so every access is guarded. */
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): PreferenceStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  storage = browserStorage(),
): T {
  try {
    const saved = storage?.getItem(key);
    return saved !== null && saved !== undefined && (allowed as readonly string[]).includes(saved)
      ? (saved as T)
      : fallback;
  } catch {
    return fallback;
  }
}

export function readString(key: string, storage = browserStorage()): string | undefined {
  try {
    return storage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeString(key: string, value: string, storage = browserStorage()): void {
  try {
    storage?.setItem(key, value);
  } catch {}
}
