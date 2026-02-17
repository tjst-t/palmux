# Palmux: Cloudflare Tunnel 経由での 401 Unauthorized 問題

## 症状

- ローカルネットワーク直接アクセス: 正常動作
- Cloudflare Tunnel 経由、通常リロード: `Failed to load sessions: API error: 401 Unauthorized`
- Cloudflare Tunnel 経由、ハードリロード (Ctrl+Shift+R): 正常動作
- ハードリロード後、通常リロード: 再び 401

## 根本原因

### palmux の認証フロー

palmux は起動時に認証トークンを生成し、`index.html` を配信する際に動的に埋め込む。

```html
<meta name="auth-token" content="<TOKEN>">
```

フロントエンドの JavaScript はこの `<meta>` タグからトークンを読み取り、API リクエストの `Authorization: Bearer <TOKEN>` ヘッダーに使用する。

### Service Worker のキャッシュ戦略

palmux は PWA として `sw.js` を登録しており、`index.html` を **cache-first** でキャッシュする。

```
// sw.js の戦略（問題のある実装）
install 時: index.html を fetch してキャッシュに保存
fetch 時:   キャッシュにあればキャッシュを返す（ネットワーク不要）
```

### なぜ 401 になるか

| タイミング | 起きること |
|-----------|-----------|
| 初回アクセス | SW が index.html (トークンA埋め込み) をキャッシュ |
| サービス再起動 | palmux が新しいトークンB を生成 |
| 通常リロード | SW がキャッシュからトークンA の HTML を返す |
| JS が API 呼び出し | トークンA を送信 → サーバはトークンB を期待 → **401** |
| ハードリロード | ブラウザが SW をバイパスしてネットワークから取得 |
| JS が API 呼び出し | トークンB を送信 → 成功 |
| 次の通常リロード | SW が再びキャッシュのトークンA の HTML を返す → **401** |

### なぜ Cloudflare Tunnel 経由のみ発生したか

SW はドメイン単位で登録される。ローカルネットワークアクセスと Cloudflare Tunnel 経由では異なるオリジンになるため、Tunnel 経由で初めて SW が登録されたタイミングのトークンがキャッシュされ続けた。ローカルアクセスでは SW 未登録か別の SW キャッシュを持っていたため影響を受けなかった。

## 暫定対処（このリポジトリでの対応）

Caddy リバースプロキシで、palmux へのすべてのリクエストに正しいトークンを `header_up` で注入する。

```caddy
@palmux path /prv/palmux /prv/palmux/*
handle @palmux {
    reverse_proxy localhost:7682 {
        header_up Authorization "Bearer <TOKEN>"
    }
}
```

これにより、フロントエンドが古いトークンを送っても、Caddy が上書きするため 401 にならない。

トークンは Ansible playbook 実行時に Infisical から取得し、Caddyfile テンプレートに注入される。

## 本来の修正 (palmux 側への修正指示)

`frontend/sw.js` の fetch ハンドラを修正し、**ナビゲーションリクエスト（HTML ページの取得）は network-first** にする。HTML には動的コンテンツ（認証トークン）が含まれているため、常にサーバから最新版を取得する必要がある。

### 修正対象ファイル

`frontend/sw.js` の `fetch` イベントハンドラ

### 修正内容

```js
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // API リクエストと WebSocket はそのままスルー
  if (url.includes('/api/') || url.startsWith('ws://') || url.startsWith('wss://')) {
    return;
  }

  // ナビゲーションリクエスト（HTML）は network-first
  // 理由: index.html には動的な認証トークンが埋め込まれているため、
  //       キャッシュを返すと古いトークンで 401 になる
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // 取得したレスポンスをキャッシュに更新
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)) // オフライン時はキャッシュにフォールバック
    );
    return;
  }

  // 静的アセット (CSS, JS, アイコン等) は従来通り cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
```

### 修正の効果

| リクエスト種別 | 修正前 | 修正後 |
|--------------|--------|--------|
| HTML (navigate) | cache-first → 古いトークン | network-first → 常に最新トークン |
| CSS / JS / 画像 | cache-first (変わらず) | cache-first (変わらず) |
| API (/api/*) | スルー (変わらず) | スルー (変わらず) |

この修正が palmux 本体に取り込まれた後は、Caddy 側の `header_up Authorization` によるワークアラウンドは不要になる（残しておいても害はない）。
