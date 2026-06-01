// A safe registry for storage to prevent "SecurityError" on iOS Safari / inside iframes / Private Browsing
const memoryStore: Record<string, string> = {};

let isStorageSupported = false;
try {
  if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage !== null) {
    const testKey = '__test_storage__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    isStorageSupported = true;
  }
} catch (e) {
  isStorageSupported = false;
}

export const safeStorage = {
  getItem(key: string): string | null {
    if (isStorageSupported) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        // Fallback to memory
      }
    }
    return memoryStore[key] !== undefined ? memoryStore[key] : null;
  },

  setItem(key: string, value: string): void {
    if (isStorageSupported) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch (e) {
        // Fallback to memory
      }
    }
    memoryStore[key] = String(value);
  },

  removeItem(key: string): void {
    if (isStorageSupported) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch (e) {
        // Fallback to memory
      }
    }
    delete memoryStore[key];
  },

  clear(): void {
    if (isStorageSupported) {
      try {
        window.localStorage.clear();
        return;
      } catch (e) {
        // Fallback to memory
      }
    }
    for (const key in memoryStore) {
      delete memoryStore[key];
    }
  }
};
