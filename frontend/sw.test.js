import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Service Worker 環境のモック ---

// キャッシュストア: cacheName -> Map<url, response>
let cacheStore;
// addEventListener で登録されたハンドラ
let eventHandlers;
// グローバル fetch のモック
let fetchMock;

function createMockResponse(body, options = {}) {
  const resp = {
    body,
    status: options.status || 200,
    clone() {
      return { ...resp, _cloned: true };
    },
  };
  return resp;
}

function createMockCache() {
  const store = new Map();
  return {
    put(request, response) {
      const url = typeof request === 'string' ? request : request.url;
      store.set(url, response);
      return Promise.resolve();
    },
    match(request) {
      const url = typeof request === 'string' ? request : request.url;
      return Promise.resolve(store.get(url) || undefined);
    },
    addAll(urls) {
      return Promise.all(
        urls.map((url) =>
          fetchMock(url).then((resp) => store.set(url, resp))
        )
      );
    },
    delete(key) {
      store.delete(key);
      return Promise.resolve(true);
    },
    _store: store,
  };
}

function setupSWEnvironment() {
  cacheStore = new Map();
  eventHandlers = {};

  const cachesAPI = {
    open(name) {
      if (!cacheStore.has(name)) {
        cacheStore.set(name, createMockCache());
      }
      return Promise.resolve(cacheStore.get(name));
    },
    match(request) {
      for (const cache of cacheStore.values()) {
        const url = typeof request === 'string' ? request : request.url;
        if (cache._store.has(url)) {
          return Promise.resolve(cache._store.get(url));
        }
      }
      return Promise.resolve(undefined);
    },
    keys() {
      return Promise.resolve([...cacheStore.keys()]);
    },
    delete(name) {
      cacheStore.delete(name);
      return Promise.resolve(true);
    },
  };

  fetchMock = vi.fn((request) => {
    return Promise.resolve(createMockResponse('network response'));
  });

  // self = globalThis in SW context
  globalThis.caches = cachesAPI;
  globalThis.fetch = fetchMock;
  globalThis.self = globalThis;
  globalThis.addEventListener = (type, handler) => {
    eventHandlers[type] = handler;
  };
}

function createFetchEvent(url, options = {}) {
  let respondWithResult = null;
  return {
    request: {
      url,
      mode: options.mode || 'cors',
      clone() { return { ...this }; },
    },
    respondWith(promise) {
      respondWithResult = promise;
    },
    get _result() {
      return respondWithResult;
    },
  };
}

async function loadSW() {
  // vitest のモジュールキャッシュをクリアしてから再読込
  vi.resetModules();
  await import('./sw.js');
}

// --- テスト ---

describe('Service Worker', () => {
  beforeEach(() => {
    setupSWEnvironment();
  });

  describe('install イベント', () => {
    it('静的アセットをプリキャッシュする（index.html を含まない）', async () => {
      await loadSW();
      const handler = eventHandlers['install'];
      expect(handler).toBeDefined();

      let waitUntilPromise;
      const event = {
        waitUntil(p) { waitUntilPromise = p; },
      };
      handler(event);
      await waitUntilPromise;

      const cache = cacheStore.get('palmux-v3');
      expect(cache).toBeDefined();

      // 静的アセットがキャッシュされている
      expect(cache._store.has('./app.js')).toBe(true);
      expect(cache._store.has('./style.css')).toBe(true);
      expect(cache._store.has('./xterm.css')).toBe(true);
      expect(cache._store.has('./manifest.json')).toBe(true);

      // index.html はプリキャッシュに含まれない
      expect(cache._store.has('./index.html')).toBe(false);
      expect(cache._store.has('./')).toBe(false);
    });
  });

  describe('fetch イベント - API リクエスト', () => {
    it('/api/ を含む URL は respondWith を呼ばずスルーする', async () => {
      await loadSW();
      const handler = eventHandlers['fetch'];

      const event = createFetchEvent('https://example.com/api/sessions');
      handler(event);
      expect(event._result).toBeNull();
    });

    it('ws:// URL はスルーする', async () => {
      await loadSW();
      const handler = eventHandlers['fetch'];

      const event = createFetchEvent('ws://example.com/ws');
      handler(event);
      expect(event._result).toBeNull();
    });

    it('wss:// URL はスルーする', async () => {
      await loadSW();
      const handler = eventHandlers['fetch'];

      const event = createFetchEvent('wss://example.com/ws');
      handler(event);
      expect(event._result).toBeNull();
    });
  });

  describe('fetch イベント - ナビゲーションリクエスト (network-first)', () => {
    it('ネットワークからレスポンスを取得する', async () => {
      const networkResponse = createMockResponse('<html>token-B</html>');
      fetchMock.mockResolvedValueOnce(networkResponse);

      await loadSW();
      const handler = eventHandlers['fetch'];

      const event = createFetchEvent('https://example.com/', { mode: 'navigate' });
      handler(event);

      const result = await event._result;
      expect(result).toBe(networkResponse);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('取得したレスポンスをキャッシュに保存する', async () => {
      const networkResponse = createMockResponse('<html>token-B</html>');
      fetchMock.mockResolvedValueOnce(networkResponse);

      await loadSW();
      const handler = eventHandlers['fetch'];

      const event = createFetchEvent('https://example.com/', { mode: 'navigate' });
      handler(event);
      await event._result;

      // キャッシュ書き込みは非同期なので少し待つ
      await new Promise((r) => setTimeout(r, 10));

      const cache = cacheStore.get('palmux-v3');
      expect(cache).toBeDefined();
      const cached = cache._store.get('https://example.com/');
      expect(cached).toBeDefined();
      expect(cached._cloned).toBe(true);
    });

    it('ネットワーク障害時はキャッシュにフォールバックする', async () => {
      // キャッシュにあらかじめ古い HTML を入れておく
      await loadSW();
      const cache = await globalThis.caches.open('palmux-v3');
      const cachedResponse = createMockResponse('<html>token-A</html>');
      await cache.put('https://example.com/', cachedResponse);

      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      const handler = eventHandlers['fetch'];
      const event = createFetchEvent('https://example.com/', { mode: 'navigate' });
      handler(event);

      const result = await event._result;
      expect(result).toBe(cachedResponse);
    });

    it('ネットワーク障害時かつキャッシュなしの場合は undefined を返す', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await loadSW();
      const handler = eventHandlers['fetch'];
      const event = createFetchEvent('https://example.com/unknown', { mode: 'navigate' });
      handler(event);

      const result = await event._result;
      expect(result).toBeUndefined();
    });
  });

  describe('fetch イベント - 静的アセット (stale-while-revalidate)', () => {
    it('キャッシュにあればキャッシュを即座に返す（バックグラウンドで更新）', async () => {
      await loadSW();
      const cache = await globalThis.caches.open('palmux-v3');
      const cachedResponse = createMockResponse('cached CSS');
      await cache.put('https://example.com/style.css', cachedResponse);

      // バックグラウンド fetch 用のレスポンス
      const freshResponse = createMockResponse('fresh CSS');
      fetchMock.mockResolvedValueOnce(freshResponse);

      const handler = eventHandlers['fetch'];
      const event = createFetchEvent('https://example.com/style.css');
      handler(event);

      const result = await event._result;
      // stale-while-revalidate: キャッシュがあれば即座に返す
      expect(result).toBe(cachedResponse);
    });

    it('キャッシュになければネットワークから取得する', async () => {
      const networkResponse = createMockResponse('fresh JS');
      fetchMock.mockResolvedValueOnce(networkResponse);

      await loadSW();
      const handler = eventHandlers['fetch'];
      const event = createFetchEvent('https://example.com/app.js');
      handler(event);

      const result = await event._result;
      expect(result).toBe(networkResponse);
    });
  });

  describe('fetch イベント - 認証トークンのシナリオ再現', () => {
    it('サーバー再起動後、ナビゲーションで最新トークンを取得する', async () => {
      // 1. 初回: トークンA の HTML がキャッシュされる
      const responseTokenA = createMockResponse('<html><meta content="token-A"></html>');
      fetchMock.mockResolvedValueOnce(responseTokenA);

      await loadSW();
      const handler = eventHandlers['fetch'];

      const event1 = createFetchEvent('https://example.com/', { mode: 'navigate' });
      handler(event1);
      const result1 = await event1._result;
      expect(result1.body).toContain('token-A');

      await new Promise((r) => setTimeout(r, 10));

      // 2. サーバー再起動: トークンB に変わる
      const responseTokenB = createMockResponse('<html><meta content="token-B"></html>');
      fetchMock.mockResolvedValueOnce(responseTokenB);

      // 3. 通常リロード: network-first なのでトークンB を取得できる
      const event2 = createFetchEvent('https://example.com/', { mode: 'navigate' });
      handler(event2);
      const result2 = await event2._result;
      expect(result2.body).toContain('token-B');
    });
  });

  describe('activate イベント', () => {
    it('現在のキャッシュ名以外を削除する', async () => {
      // 古いキャッシュを作成
      cacheStore.set('palmux-v1', createMockCache());
      cacheStore.set('old-cache', createMockCache());

      await loadSW();

      const handler = eventHandlers['activate'];
      expect(handler).toBeDefined();

      let waitUntilPromise;
      const event = {
        waitUntil(p) { waitUntilPromise = p; },
      };
      handler(event);
      await waitUntilPromise;

      // palmux-v3 は残る（install で作成される可能性がある）
      // palmux-v1 と old-cache は削除される
      expect(cacheStore.has('palmux-v1')).toBe(false);
      expect(cacheStore.has('old-cache')).toBe(false);
    });
  });
});
