/** MiniApps keep domain data in context.dataDir; normal browser builds keep their existing storage. */
export interface ChatStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

const browserStore: ChatStore = {
  get<T>(key: string, fallback: T): T {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
    catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private browser session */ } },
};
let active: ChatStore = browserStore;
export const chatStore: ChatStore = {
  get: <T>(key: string, fallback: T) => active.get(key, fallback),
  set: (key, value) => active.set(key, value),
};

/** Load before mounting React, so a failed read can never overwrite saved history with defaults. */
export async function initializeMiniAppStorage(
  request: typeof fetch = fetch,
  onError: (message: string) => void = () => {},
): Promise<{ flush(): Promise<void>; hasPending(): boolean }> {
  const response = await request('/api/tracevista/storage', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load MiniApp chat history. Refresh the MiniApp to retry.');
  const values: unknown = await response.json();
  if (!values || typeof values !== 'object' || Array.isArray(values)
    || Object.values(values).some(value => typeof value !== 'string')) throw new Error('MiniApp storage returned invalid data.');
  const cache = new Map(Object.entries(values as Record<string, string>));
  const changed = new Map<string, string>();
  let writing: Promise<void> | undefined;
  async function drain() {
    while (changed.size) {
      const [key, value] = changed.entries().next().value!;
      const result = await request('/api/tracevista/storage', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }),
      });
      if (!result.ok) throw new Error('Could not save MiniApp chat history. Export the conversation before closing.');
      if (changed.get(key) === value) changed.delete(key);
    }
  }
  function flush(): Promise<void> {
    if (!writing) {
      writing = drain().then(() => {
        writing = undefined;
        // A new value can arrive between the final drain iteration and this continuation.
        if (changed.size) return flush();
      }, error => {
        writing = undefined;
        onError(error instanceof Error ? error.message : 'Could not save MiniApp chat history.');
        throw error;
      });
      // Leave failed writes pending for the next change or explicit retry; never discard the cache.
      void writing.catch(() => {});
    }
    return writing;
  }
  active = {
    get<T>(key: string, fallback: T): T { try { const value = cache.get(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } },
    set(key, value) {
      const encoded = JSON.stringify(value);
      if (encoded === cache.get(key)) return;
      cache.set(key, encoded); changed.set(key, encoded);
      void flush();
    },
  };
  return { flush, hasPending: () => changed.size > 0 };
}
