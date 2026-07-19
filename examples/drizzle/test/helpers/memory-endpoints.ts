import type { EndpointStore } from '../../src/endpoints';

export function memoryEndpointStore(initial: Record<string, string> = {}): {
  store: EndpointStore;
  rows: Map<string, string>;
  calls: string[];
} {
  const rows = new Map(Object.entries(initial));
  const calls: string[] = [];

  const store: EndpointStore = {
    async get(keyId) {
      calls.push(`get:${keyId}`);
      return rows.get(keyId) ?? null;
    },
    async upsert(keyId, baseUrl) {
      calls.push(`upsert:${keyId}`);
      rows.set(keyId, baseUrl);
    },
    async delete(keyId) {
      calls.push(`delete:${keyId}`);
      rows.delete(keyId);
    },
  };

  return { store, rows, calls };
}
