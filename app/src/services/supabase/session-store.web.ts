import type { KeyValueStore } from './chunked-storage';

/*
 * Web: browsers have no keychain. The session lives in this origin's localStorage, which is what supabase-js
 * uses by default on the web. Any script running on the origin can read it, so the web build must never load
 * third-party scripts. Storage may throw (private mode, blocked site data); a failure means "no session".
 */
const store: KeyValueStore = {
  async getItemAsync(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItemAsync(key, value) {
    localStorage.setItem(key, value);
  },
  async deleteItemAsync(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing stored
    }
  },
};

export const { getItemAsync, setItemAsync, deleteItemAsync } = store;
