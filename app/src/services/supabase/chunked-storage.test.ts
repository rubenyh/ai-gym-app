import { CHUNK_SIZE, createChunkedStorage, type KeyValueStore } from './chunked-storage';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => void data.set(k, v),
    deleteItemAsync: async (k) => void data.delete(k),
  };
}

describe('chunked secure storage', () => {
  it('round-trips a session larger than one secure-store value', async () => {
    const store = memoryStore();
    const storage = createChunkedStorage(store);
    const session = JSON.stringify({ access_token: 'x'.repeat(CHUNK_SIZE * 3 + 17) });
    await storage.setItem('sb-auth', session);
    expect(store.data.get('sb-auth.n')).toBe('4');
    expect([...store.data.values()].every((v) => v.length <= CHUNK_SIZE)).toBe(true);
    expect(await storage.getItem('sb-auth')).toBe(session);
  });

  it('removes stale chunks when a value shrinks', async () => {
    const store = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'a'.repeat(CHUNK_SIZE * 3));
    await storage.setItem('k', 'short');
    expect(await storage.getItem('k')).toBe('short');
    expect(store.data.has('k.1')).toBe(false);
    expect(store.data.has('k.2')).toBe(false);
  });

  it('treats a missing chunk as no session instead of returning a corrupt token', async () => {
    const store = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'b'.repeat(CHUNK_SIZE * 2));
    store.data.delete('k.1');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('removeItem deletes every chunk (sign-out clears tokens)', async () => {
    const store = memoryStore();
    const storage = createChunkedStorage(store);
    await storage.setItem('k', 'c'.repeat(CHUNK_SIZE * 2));
    await storage.removeItem('k');
    expect(store.data.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });
});
