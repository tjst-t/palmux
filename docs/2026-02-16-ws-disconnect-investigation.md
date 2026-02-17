# WebSocket 切断によるプロセス消失の調査記録

日時: 2026-02-16

## 概要

Palmux を ttyd 経由で使用中、WebSocket 接続が繰り返し切断され、ttyd が子プロセス (tmux クライアント) を kill した。ユーザーからは「プロセスが軒並み KILL された」ように見えたが、実際には OOM やシステム異常ではなく、**WebSocket 切断 → ttyd による子プロセス kill** が原因。

## タイムライン

サーバ: cdev (KVM VM, 24GB RAM, Ubuntu 24.04, Swap 8GB)

### Boot -1 (03:12:28 ~ 04:47:07)

```
03:12:28  システム起動 (Swap 8GB 有効)
03:12:32  ttyd, caddy, cloudflared 起動完了
03:15:04  WS 接続 → tmux プロセス起動 (pid 3120)
03:29:15  WS 切断 → ttyd が pid 3120 を kill (セッション: 約14分)
03:29:57  WS 再接続 → tmux プロセス起動 (pid 22816)
03:32:27  WS 切断 → ttyd が pid 22816 を kill (セッション: 約2.5分)
03:32:31  WS 再接続 → tmux プロセス起動 (pid 24761)
03:49:55  WS 切断 → ttyd が pid 24761 を kill (セッション: 約17分)
(以後、ttyd への接続なし)
04:46:50  SSH でログイン
04:47:03  sudo shutdown -h now
```

### 背景: それ以前のイベント

```
01:00:57  [Boot -3] OOM Kill: claude プロセス (RSS 9.5GB)
01:45:34  [Boot -3] OOM Kill: claude プロセス (RSS 16GB)
02:13:40  [Boot -3] journald "Under memory pressure" → システム突然死
02:15:23  [Boot -2] 再起動 (Swap有効)
03:10:09  [Boot -2] システム突然死 (原因不明、ハイパーバイザからの強制リセットの可能性)
```

## 技術的事実

### ttyd の挙動

ttyd の設定:
```
ExecStart=/usr/local/bin/ttyd -W -p 7681 -i 127.0.0.1 --base-path /prv/ttyd tmux new-session -A -s main
```

ttyd は WebSocket が切断されると、子プロセス (`tmux new-session -A -s main`) を kill する。これは ttyd の正常な動作。

ttyd ログ (抜粋):
```
03:29:15 N: WS closed from 127.0.0.1, clients: 0
03:29:15 N: killing process, pid: 3120
03:29:15 N: process killed with signal 0, pid: 3120
```

### ネットワーク経路

```
ブラウザ → Cloudflare Access → Cloudflare Tunnel (QUIC) → Caddy (:8080) → ttyd (:7681)
```

### Caddy 設定 (事象発生時)

```
:8080 {
    @ttyd path /prv/ttyd /prv/ttyd/*
    handle @ttyd {
        reverse_proxy localhost:7681
    }
    ...
}
```

WebSocket 用の明示的なタイムアウト設定なし。

### cloudflared

- プロトコル: QUIC
- 接続先: nrt05, nrt08, nrt12 (東京)
- 起動時の警告以外にエラーログなし
- WS 切断時刻前後にログエントリなし

### システム状態

- OOM イベント: **なし** (Boot -1 中)
- メモリ圧迫: **なし** (Boot -1 中)
- カーネルエラー: **なし**
- Swap: 8GB 有効、使用量不明 (ログに記録なし)

### その他の観測事項

- `snap-confine` が `snap-update-ns.maas` を5秒間隔で実行しようとして AppArmor に DENIED され続けていた (MAAS snap は未インストール)
- セッション持続時間にばらつきがある (14分、2.5分、17分) → 固定タイムアウトではなさそう

## ユーザーの状況

- Palmux (自作 tmux Web クライアント) を動かしていたタイミング
- Palmux も tmux セッションに接続するため、ttyd との競合の可能性がある

## 考えられる原因

### 1. Palmux と ttyd の tmux セッション競合

ttyd は `tmux new-session -A -s main` で tmux セッション "main" に接続する。Palmux も同じセッションに接続していた場合、tmux のクライアント管理に影響する可能性がある。

調査ポイント:
- Palmux は tmux セッション "main" に `tmux attach-session` していたか？
- Palmux 側で pty を閉じる操作が ttyd 側の tmux クライアントに影響したか？
- Palmux の WebSocket と ttyd の WebSocket が同じ tmux ウィンドウに同時接続していたか？

### 2. Cloudflare Tunnel / Access の WebSocket タイムアウト

Cloudflare Tunnel にはアイドル接続のタイムアウトがある。ただし、セッション持続時間が不規則 (14分、2.5分、17分) なので、固定タイムアウトの可能性は低い。

調査ポイント:
- Cloudflare Access のセッション設定
- Cloudflare Tunnel の WebSocket アイドルタイムアウト

### 3. Caddy の reverse_proxy タイムアウト

Caddy のデフォルトでは WebSocket のアイドルタイムアウトが適用される可能性がある。

調査ポイント:
- `transport http` の `read_timeout` / `write_timeout`
- `flush_interval` の設定

### 4. ブラウザ / ネットワーク側の問題

スマホブラウザでの使用時、バックグラウンド遷移や通信不安定で WebSocket が切れることがある。

## 再現手順 (案)

1. ttyd を通常通り起動
2. Palmux を起動して同じ tmux セッションに接続
3. ブラウザで ttyd に接続
4. WebSocket が切断されるか観察
5. Palmux を停止して同じテストを行い、比較する

## 次のアクション

- [ ] Palmux あり / なしで ttyd の WS 安定性を比較テスト
- [ ] Palmux の WebSocket / pty ハンドリングで tmux セッション側に影響を与えるコードパスを確認
- [ ] Caddy に WebSocket 用のタイムアウト設定を明示的に追加する検討
