# Palmux

スマートフォンから快適に tmux を操作できる Web ベースのターミナルクライアント。

Go シングルバイナリにフロントエンドを埋め込んでデプロイでき、モバイルファーストの UI で tmux セッション/ウィンドウの切り替え・操作が行える。

## 特徴

- **モバイルファースト UI** — 修飾キーツールバー (Ctrl, Alt, Esc, Tab, 矢印, PgUp/PgDn)、IME 入力対応
- **シングルバイナリ** — `embed.FS` でフロントエンドを埋め込み、1ファイルでデプロイ可能
- **セッション/ウィンドウ管理** — Drawer UI から作成・削除・リネーム・切り替え
- **自動再接続** — 指数バックオフによる WebSocket 自動再接続、接続状態インジケーター
- **PWA 対応** — ホーム画面に追加してスタンドアロンアプリとして利用可能
- **クリップボード同期** — tmux コピーモード/マウス選択でコピーした内容がブラウザのクリップボードに自動反映（OSC 52）。Ctrl+V でテキスト・画像のペーストも可能
- **TLS サポート** — 証明書を指定して HTTPS で起動可能
- **認証** — Bearer トークンによる API 保護（起動時に自動生成）
- **ベースパス対応** — リバースプロキシ配下でのサブパス運用に対応
- **ファイルブラウザ** — セッションのカレントディレクトリを起点にファイル閲覧。Markdown レンダリング、シンタックスハイライト、画像プレビュー対応
- **通知バッジ** — Claude Code の入力待ち状態をドロワーにリアルタイム表示（Hook 連携）

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

# Claude のコマンドパスを指定（cgroup ラッパー等）
./palmux --claude-path /usr/local/bin/claude-cgroup
```

起動すると認証トークンが標準出力に表示される。ブラウザで `http://<host>:<port>` にアクセスし、セッション一覧からターミナルに接続する。

### CLI フラグ

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--port` | `8080` | 待ち受けポート |
| `--host` | `0.0.0.0` | 待ち受けアドレス |
| `--tmux` | `tmux` | tmux バイナリのパス |
| `--claude-path` | `claude` | Drawer から Claude 起動時に使うコマンドパス |
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

`~/.tmux.conf` に以下を追加してください：

```bash
# マウスサポート（タッチスクロール、マウス選択に必要）
set -g mouse on

# クリップボード同期（OSC 52 経由でブラウザのクリップボードと連携）
set -g set-clipboard on
set -as terminal-features 'xterm-256color:clipboard'
```

- `set -g mouse on` — スマートフォンでのタッチスクロール・マウス選択でのコピーに必要
- `set -g set-clipboard on` — tmux がコピー時に OSC 52 エスケープシーケンスを発行し、ブラウザのクリップボードに反映する
- `set -as terminal-features ...` — tmux に外側ターミナル（Palmux）の OSC 52 サポートを認識させる

クリップボード同期は HTTPS 接続時のみ動作する（`navigator.clipboard` API の要件）。localhost では HTTP でも動作する。

### Drawer

ヘッダー左のハンバーガーメニュー (☰) からセッション/ウィンドウ一覧を表示。

- セッション名タップで展開、ウィンドウ一覧を表示
- ウィンドウタップで切り替え
- 長押しで削除
- ウィンドウ名タップでインラインリネーム
- 通知バッジ — Claude Code が入力待ちのウィンドウに amber ドットを表示

## 通知バッジ（Claude Code 連携）

Claude Code が入力待ち（`Stop`）になったウィンドウをドロワーに amber のパルスドットで表示する。ユーザーが入力を再開（`UserPromptSubmit`）するとバッジが消える。

### 仕組み

1. Palmux 起動時に `~/.config/palmux/env.<port>` が生成される（ポート・トークン・ベースパス）
2. Claude Code の Hook が `Stop` / `UserPromptSubmit` 時に全インスタンスの Palmux API を呼び出す
3. WebSocket 経由でリアルタイムにドロワーへ反映
4. Palmux 終了時に env ファイルが自動削除される

複数の Palmux を同時に起動しても、ポートごとに env ファイルが分離されるため正しく動作する。

### Hook 設定

`~/.claude/settings.json` に以下を追加：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "for f in ~/.config/palmux/env.*; do [ -f \"$f\" ] && . \"$f\" 2>/dev/null && [ -n \"$PALMUX_TOKEN\" ] && curl -sf -X POST \"http://localhost:${PALMUX_PORT}${PALMUX_BASE_PATH}api/notifications\" -H \"Authorization: Bearer $PALMUX_TOKEN\" -H 'Content-Type: application/json' -d \"{\\\"session\\\":\\\"$(tmux display-message -p '#S')\\\",\\\"window_index\\\":$(tmux display-message -p '#I'),\\\"type\\\":\\\"stop\\\"}\"; done; true",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "for f in ~/.config/palmux/env.*; do [ -f \"$f\" ] && . \"$f\" 2>/dev/null && [ -n \"$PALMUX_TOKEN\" ] && curl -sf -X DELETE \"http://localhost:${PALMUX_PORT}${PALMUX_BASE_PATH}api/notifications?session=$(tmux display-message -p '#S')&window=$(tmux display-message -p '#I')\" -H \"Authorization: Bearer $PALMUX_TOKEN\"; done; true",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### 通知 API

| メソッド | エンドポイント | 説明 |
|---|---|---|
| `POST` | `/api/notifications` | 通知を追加（30分 TTL） |
| `DELETE` | `/api/notifications?session=X&window=Y` | 通知を削除 |
| `GET` | `/api/notifications` | 通知一覧を取得 |

## ファイルブラウザ

Drawer のセッション名横にある📁ボタン、またはヘッダーの [📁] タブからファイルブラウザを起動できる。

- **ディレクトリブラウズ** — パンくずリストで階層移動、ディレクトリ優先ソート
- **Markdown プレビュー** — GFM 対応、テーブル・チェックボックス・コードブロックのハイライト
- **シンタックスハイライト** — Go, JavaScript, Python, Bash, YAML, JSON, HTML, CSS, SQL, TypeScript に対応
- **画像表示** — PNG, JPG, GIF, SVG, WebP をインライン表示
- **読み取り専用** — ファイルの閲覧のみ（編集・削除は不可）
- **セキュリティ** — パストラバーサル防止、シンボリックリンクのルート外アクセス拒否

## 開発

```bash
# テスト実行
make test

# フロントエンドのみビルド
make frontend

# クリーンアップ
make clean

# HTTPS 付きでテスト起動（自己署名証明書を自動生成）
./dev-serve.sh <ホスト名|IP> [ポート]
# 例: ./dev-serve.sh 192.168.1.100
# 例: ./dev-serve.sh mydev.local 9443
```

`dev-serve.sh` は `make build` 実行後、自己署名証明書が `/tmp/palmux-dev-certs/` になければ自動生成し、HTTPS で Palmux を起動する。ホスト名/IP ごとに別の証明書ファイルが作成されるため、アドレスが変わっても再生成される。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| Backend | Go (`net/http`, `nhooyr.io/websocket`, `github.com/creack/pty`) |
| Frontend | Vanilla JS + xterm.js |
| ファイルプレビュー | marked (Markdown), highlight.js (シンタックスハイライト), DOMPurify (XSS 対策) |
| ビルド | esbuild |
| pty 接続 | `tmux attach-session` を pty 内で実行し WebSocket で中継 |

## ライセンス

MIT
