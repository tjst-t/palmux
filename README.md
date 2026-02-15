# Palmux

スマートフォンから快適に tmux を操作できる Web ベースのターミナルクライアント。

Go シングルバイナリにフロントエンドを埋め込んでデプロイでき、モバイルファーストの UI で tmux セッション/ウィンドウの切り替え・操作が行える。

## 特徴

- **モバイルファースト UI** — 修飾キーツールバー (Ctrl, Alt, Esc, Tab, 矢印, PgUp/PgDn)、IME 入力対応
- **シングルバイナリ** — `embed.FS` でフロントエンドを埋め込み、1ファイルでデプロイ可能
- **セッション/ウィンドウ管理** — Drawer UI から作成・削除・リネーム・切り替え
- **自動再接続** — 指数バックオフによる WebSocket 自動再接続、接続状態インジケーター
- **PWA 対応** — ホーム画面に追加してスタンドアロンアプリとして利用可能
- **TLS サポート** — 証明書を指定して HTTPS で起動可能
- **認証** — Bearer トークンによる API 保護（起動時に自動生成）
- **ベースパス対応** — リバースプロキシ配下でのサブパス運用に対応

## 必要環境

- Go 1.23+
- Node.js (フロントエンドビルド用)
- tmux

## インストール

```bash
git clone https://github.com/tjst-t/palmux.git
cd palmux
cd frontend && npm install && cd ..
make build
```

`palmux` バイナリが生成される。

### クロスコンパイル

```bash
make build-linux   # Linux amd64
make build-arm     # Linux arm64
```

## 使い方

```bash
# 基本的な起動
./palmux

# ポートとホストを指定
./palmux --port 3000 --host 127.0.0.1

# 固定トークンを指定
./palmux --token my-secret-token

# TLS で起動
./palmux --tls-cert cert.pem --tls-key key.pem

# ベースパスを指定（リバースプロキシ配下）
./palmux --base-path /palmux/

# 同時接続数の上限を変更
./palmux --max-connections 10
```

起動すると認証トークンが標準出力に表示される。ブラウザで `http://<host>:<port>` にアクセスし、セッション一覧からターミナルに接続する。

### CLI フラグ

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--port` | `8080` | 待ち受けポート |
| `--host` | `0.0.0.0` | 待ち受けアドレス |
| `--tmux` | `tmux` | tmux バイナリのパス |
| `--token` | (自動生成) | 認証トークン |
| `--base-path` | `/` | ベースパス |
| `--tls-cert` | (なし) | TLS 証明書ファイル |
| `--tls-key` | (なし) | TLS 秘密鍵ファイル |
| `--max-connections` | `5` | セッションあたりの最大同時接続数 |

### リバースプロキシ設定例 (Caddy)

```
example.com {
    route /palmux/* {
        reverse_proxy localhost:8080
    }
}
```

```bash
./palmux --base-path /palmux/
```

## モバイル操作

### ツールバー

ターミナル下部に修飾キーツールバーを表示。ヘッダーのトグルボタンで表示/非表示を切り替え可能。

- **ワンショット** — ボタンをタップすると次の1キー入力に修飾が付き、自動解除
- **ロック** — ダブルタップで連続入力モード（再タップで解除）
- **[あ] ボタン** — IME 入力モードに切り替え（日本語入力対応）
- **[A-] / [A+]** — フォントサイズ調整（8px〜24px、`localStorage` に保存）

### ジェスチャー

- **上下スワイプ** — ターミナルスクロール（tmux で `set -g mouse on` が必要）
- **左右スワイプ** — ウィンドウ切り替え
- **ピンチズーム** — フォントサイズ変更

### tmux 推奨設定

スマートフォンでのタッチスクロールによるログ閲覧を有効にするため、tmux の設定ファイル (`~/.tmux.conf`) に以下を追加してください：

```bash
set -g mouse on
```

### Drawer

ヘッダー左のハンバーガーメニュー (☰) からセッション/ウィンドウ一覧を表示。

- セッション名タップで展開、ウィンドウ一覧を表示
- ウィンドウタップで切り替え
- 長押しで削除
- ウィンドウ名タップでインラインリネーム

## 開発

```bash
# テスト実行
make test

# フロントエンドのみビルド
make frontend

# クリーンアップ
make clean
```

## 技術スタック

| レイヤー | 技術 |
|---|---|
| Backend | Go (`net/http`, `nhooyr.io/websocket`, `github.com/creack/pty`) |
| Frontend | Vanilla JS + xterm.js |
| ビルド | esbuild |
| pty 接続 | `tmux attach-session` を pty 内で実行し WebSocket で中継 |

## ライセンス

MIT
