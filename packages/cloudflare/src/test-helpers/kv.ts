export interface FakeKvEntry {
  value: string;
  expirationTtl: number | null;
}

export interface FakeKvNamespace {
  entries: Map<string, FakeKvEntry>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createFakeKv(): FakeKvNamespace {
  const entries = new Map<string, FakeKvEntry>();

  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      entries.set(key, { value, expirationTtl: options?.expirationTtl ?? null });
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}
