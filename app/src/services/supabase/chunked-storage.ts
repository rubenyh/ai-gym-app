/**
 * Supabase auth storage adapter on top of a small key/value store (expo-secure-store in the app).
 * Secure store values are size-limited (~2 KB), and a Supabase session is larger, so values are
 * split into chunks: `<key>.n` holds the chunk count, `<key>.0..n-1` hold the parts.
 *
 * ponytail: chunks are written without a cross-key transaction; a crash mid-write can leave a
 * mixed value, which Supabase rejects as an invalid session (user signs in again). Upgrade to an
 * encrypted single blob in SQLite if that ever matters.
 */
export type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

// Characters, not bytes: session JSON is mostly ASCII, so 1000 chars stays well under 2048 bytes.
export const CHUNK_SIZE = 1000;

const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

export function createChunkedStorage(store: KeyValueStore) {
  async function chunkCount(key: string): Promise<number> {
    const n = Number(await store.getItemAsync(countKey(key)));
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  async function removeChunks(key: string, from: number, to: number) {
    for (let i = from; i < to; i++) await store.deleteItemAsync(chunkKey(key, i));
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const n = await chunkCount(key);
      if (n === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // incomplete value: treat as no session
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key: string, value: string): Promise<void> {
      const previous = await chunkCount(key);
      const parts: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) parts.push(value.slice(i, i + CHUNK_SIZE));
      if (parts.length === 0) parts.push('');
      for (let i = 0; i < parts.length; i++) await store.setItemAsync(chunkKey(key, i), parts[i]);
      await store.setItemAsync(countKey(key), String(parts.length));
      await removeChunks(key, parts.length, previous);
    },

    async removeItem(key: string): Promise<void> {
      const n = await chunkCount(key);
      await store.deleteItemAsync(countKey(key));
      await removeChunks(key, 0, n);
    },
  };
}
