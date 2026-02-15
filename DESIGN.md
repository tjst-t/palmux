# Palmux - Design Document

> **Palmux** (読み: パーマックス)

## Overview

Palmux は、スマートフォンから快適に tmux セッション/ウィンドウを操作できる Web ベースのターミナルクライアント。Go のシングルバイナリとしてデプロイでき、モバイルファーストの UI を持つ。

## Goals

- スマホブラウザから tmux セッションとウィンドウを快適に切り替え・操作できる
- 修飾キー（Ctrl, Alt, Esc, 矢印キー, Tab 等）をタップで入力できる補助 UI
- Go シングルバイナリでデプロイ可能（フロントエンドを `embed.FS` で埋め込み）
- 認証付きで安全にリモートアクセス可能

## Non-Goals

- tmux 自体の再実装（tmux をバックエンドとしてそのまま利用する）
- デスクトップターミナルの完全な代替
- マルチユーザー/マルチホスト対応（v1 ではシングルホスト・シングルユーザー）

---

## Architecture

```
┌─────────────────────────────────────┐
│           Browser (Mobile)           │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Session/   │  │   xterm.js     │  │
│  │ Window UI  │  │   Terminal     │  │
│  └───────────┘  └────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │    Mobile Key Toolbar          │  │
│  │  [Ctrl][Alt][Esc][Tab][↑↓←→]  │  │
│  └────────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │ HTTP / WebSocket
               │
┌──────────────▼──────────────────────┐
│          Palmux Server (Go)          │
│                                      │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ HTTP API  │  │  WebSocket Hub  │  │
│  │ (REST)    │  │  (per-window)   │  │
│  └────┬─────┘  └───────┬─────────┘  │
│       │                │             │
│  ┌────▼────────────────▼─────────┐  │
│  │       tmux Manager            │  │
│  │   (os/exec + pty via          │  │
│  │    creack/pty)                 │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
└──────────────────┼───────────────────┘
                   │ IPC
            ┌──────▼──────┐
            │  tmux server │
            └─────────────┘
```

---

## Tech Stack

### Backend (Go)

| Component | Package |
|---|---|
| HTTP Router | `net/http` (標準ライブラリ) |
| WebSocket | `nhooyr.io/websocket` |
| PTY | `github.com/creack/pty` |
| tmux 連携 | `os/exec` による CLI 呼び出し |
| 静的ファイル配信 | `embed.FS` |
| 認証 | Bearer token (起動時に生成し stdout に出力) |

### Frontend

| Component | Technology |
|---|---|
| ターミナルエミュレータ | @xterm/xterm + @xterm/addon-fit + @xterm/addon-web-links |
| UI | Vanilla HTML/CSS/JS (フレームワーク不使用) |
| ビルドツール | esbuild (xterm.js のバンドルのみ) |

---

## API Design

### Base Path

すべてのルートは設定可能なベースパスの下にマウントされる。
`--base-path /palmux/` の場合、`/palmux/api/sessions`, `/palmux/ws/...` のようになる。

**実装方針:**
- サーバー内部では相対パス (`/api/sessions` 等) でルーティングを定義
- 起動時に `http.StripPrefix(basePath, mux)` でベースパスを処理
- フロントエンドには `<meta name="base-path" content="/palmux/">` 等でベースパスを注入し、JS 側で API コール時に付与
- ベースパスは必ず `/` で始まり `/` で終わるように正規化する（例: `palmux` → `/palmux/`）

**リバースプロキシ設定例 (Caddy):**
```
example.com {
    route /palmux/* {
        reverse_proxy localhost:8080
    }
}
```

この場合、Palmux 側は `--base-path /palmux/` で起動する。

### REST API

すべてのエンドポイントは `Authorization: Bearer <token>` ヘッダーを要求する。
WebSocket 接続ではブラウザ API の制約によりカスタムヘッダーを設定できないため、
クエリパラメータ `?token=xxx` による認証もサポートする。
以下のパスはベースパスからの相対パス。

#### Sessions

```
GET    {basePath}api/sessions
Response: [
  {
    "name": "main",
    "windows": 3,
    "attached": true,
    "created": "2025-01-01T00:00:00Z"
  }
]

POST   {basePath}api/sessions
Body: { "name": "new-session" }
Response: { "name": "new-session" }

DELETE {basePath}api/sessions/{name}
Response: 204 No Content
```

#### Windows

```
GET    {basePath}api/sessions/{session}/windows
Response: [
  {
    "index": 0,
    "name": "bash",
    "active": true
  },
  {
    "index": 1,
    "name": "vim",
    "active": false
  }
]

POST   {basePath}api/sessions/{session}/windows
Body: { "name": "new-window" }  (optional)
Response: { "index": 2, "name": "new-window" }

PATCH  {basePath}api/sessions/{session}/windows/{index}
Body: { "name": "new-name" }
Response: { "index": 0, "name": "new-name", "active": true }

DELETE {basePath}api/sessions/{session}/windows/{index}
Response: 204 No Content
```

#### Connections

```
GET    {basePath}api/connections
Response: [
  {
    "session": "main",
    "connected_at": "2025-01-01T00:00:00Z",
    "remote_addr": "192.168.1.10:54321"
  }
]
```

### WebSocket

```
WS {basePath}api/sessions/{session}/windows/{index}/attach
```

- 接続時に `tmux send-keys` 等ではなく、対象ウィンドウの pty に直接 attach する
- 実装: `tmux capture-pane` ではなく、`tmux pipe-pane` もしくは新規 pty を tmux ウィンドウ内で起動してそこに接続

**pty attach 方式の詳細:**

WebSocket 接続時に以下の流れで pty を確保する:

1. `tmux send-keys -t {session}:{window}` 方式は遅延・同期の問題がある
2. 代わりに `tmux respawn-pane` や直接 pty を開く方式も問題がある
3. **推奨方式**: `tmux attach-session -t {session}` を pty 内で実行し、`tmux select-window -t :{index}` で対象ウィンドウに移動する。この pty の I/O を WebSocket に中継する

```go
// pseudo code
cmd := exec.Command("tmux", "attach-session", "-t", sessionName)
ptmx, _ := pty.Start(cmd)
// ptmx <-> WebSocket の双方向コピー
```

ウィンドウ切り替え時は同じ pty 接続上で `tmux select-window` を送信する。
これにより WebSocket を張り直す必要がなくなる。

### WebSocket Message Format

```
// Client -> Server (stdin)
{ "type": "input", "data": "ls\r" }
{ "type": "resize", "cols": 80, "rows": 24 }

// Server -> Client (stdout)
{ "type": "output", "data": "\x1b[1;32muser@host\x1b[0m:~$ " }
```

---

## tmux Manager

tmux CLI をラップする Go の内部パッケージ。

```go
// pkg/tmux/tmux.go

type Manager struct {
    Exec Executor // テスト時にモック注入可能
}

type Session struct {
    Name     string    `json:"name"`
    Windows  int       `json:"windows"`
    Attached bool      `json:"attached"`
    Created  time.Time `json:"created"`
}

type Window struct {
    Index  int    `json:"index"`
    Name   string `json:"name"`
    Active bool   `json:"active"`
}

func (m *Manager) ListSessions() ([]Session, error)
func (m *Manager) NewSession(name string) (*Session, error)
func (m *Manager) KillSession(name string) error

func (m *Manager) ListWindows(session string) ([]Window, error)
func (m *Manager) NewWindow(session, name string) (*Window, error)
func (m *Manager) KillWindow(session string, index int) error
func (m *Manager) RenameWindow(session string, index int, name string) error

func (m *Manager) Attach(session string) (*os.File, *exec.Cmd, error)
// Attach は tmux attach を pty 内で実行し、pty の fd と cmd を返す
```

**tmux コマンドのフォーマット指定:**

```go
// ListSessions の実装例
func (m *Manager) ListSessions() ([]Session, error) {
    out, err := m.Exec.Run(
        "list-sessions",
        "-F", "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}",
    )
    // タブ区切りでパース
}
```

---

## Frontend Design

### Screen Layout (Mobile)

```
┌──────────────────────────┐
│ ☰  session:window    ▼  │  <- Header: ハンバーガーメニュー + セッション:ウィンドウ表示
├──────────────────────────┤
│                          │
│                          │
│    xterm.js Terminal     │  <- メイン領域: ターミナル (inputmode="none" で IME 無効)
│                          │
│                          │
│                          │
├──────────────────────────┤
│ [Esc][Tab][Ctrl][Alt]    │  <- 修飾キーツールバー (トグル可能)
│ [↑][↓][←][→][PgUp][PgDn]│
├──────────────────────────┤
│ [テキスト入力欄    ][送信]│  <- IME 入力用フィールド (トグル可能)
└──────────────────────────┘
```

### Mobile Input Strategy

Android Chrome + GBoard 環境では xterm.js の IME 対応に根本的な問題がある
（composition イベントの不整合による文字重複・化け）。
このため、日本語等の IME 入力には専用の入力フィールドを設ける。

**2つの入力モード:**

| モード | 用途 | 仕組み |
|---|---|---|
| Direct モード | 英数字・コマンド入力 | xterm.js に直接入力。ターミナルをタップでフォーカス。`inputmode="none"` で IME を抑制し、修飾キーツールバーと併用 |
| IME モード | 日本語等の変換入力 | ターミナル下部のテキストフィールドで変換を完了し、確定テキストを pty に送信 |

**IME 入力フィールドの挙動:**
- 通常は非表示。ツールバーの [あ] ボタンまたはキーボードショートカットでトグル
- `<input type="text">` で通常のブラウザ IME を利用
- Enter で確定テキストを WebSocket 経由で pty に送信（末尾に `\n` を付与するかはオプション）
- 送信後にフィールドをクリアし、フォーカスを維持（連続入力可能）
- Shift+Enter で改行なし送信（コマンドの途中に日本語を挿入する場合）

**実装:**
```javascript
// IME 入力フィールドのハンドラ
imeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = imeInput.value;
    ws.send(JSON.stringify({ type: 'input', data: text + '\n' }));
    imeInput.value = '';
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    const text = imeInput.value;
    ws.send(JSON.stringify({ type: 'input', data: text }));
    imeInput.value = '';
  }
});
```

### Session/Window Drawer (☰ タップ時)

```
┌──────────────────────────┐
│ Sessions          [+ New]│
├──────────────────────────┤
│ ▼ main                   │
│   ├ 0: bash       ●      │  <- ● = active
│   ├ 1: vim               │
│   └ 2: htop              │
│ ▶ dev                    │
│ ▶ monitoring             │
├──────────────────────────┤
│ [New Session]            │
└──────────────────────────┘
```

### Mobile Key Toolbar

修飾キーはトグル式。Ctrl をタップすると次の1キー入力に Ctrl 修飾が付く（ワンショット）。
ダブルタップでロック（連続入力モード）。

```
[Esc][Tab][Ctrl][Alt][↑][↓][←][→][PgUp][PgDn][あ]
                                                ^^^ IME モードトグル
```

---

## Directory Structure

```
palmux/
├── main.go                 # エントリポイント、CLI フラグ処理
├── go.mod
├── go.sum
├── internal/
│   ├── server/
│   │   ├── server.go       # HTTP サーバー起動、ルーティング、ベースパス処理
│   │   ├── server_test.go
│   │   ├── auth.go         # Bearer token 認証ミドルウェア
│   │   ├── auth_test.go
│   │   ├── api_sessions.go # セッション系 API ハンドラ
│   │   ├── api_sessions_test.go
│   │   ├── api_window.go   # ウィンドウ系 API ハンドラ（※ _windows は Go ビルド制約と衝突）
│   │   ├── api_window_test.go
│   │   ├── ws.go           # WebSocket ハンドラ (pty <-> WS ブリッジ)
│   │   └── ws_test.go
│   └── tmux/
│       ├── executor.go     # Executor インターフェース + RealExecutor
│       ├── tmux.go         # Manager 構造体、コマンド実行
│       ├── tmux_test.go
│       ├── parse.go        # tmux 出力パーサー
│       ├── parse_test.go
│       └── testdata/       # テストフィクスチャ
│           ├── list-sessions.txt
│           ├── list-sessions-empty.txt
│           ├── list-windows.txt
│           └── list-windows-single.txt
├── frontend/
│   ├── index.html          # SPA エントリ (base-path を meta タグで注入)
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js          # メインアプリケーションロジック
│   │   ├── api.js          # REST API クライアント (base-path 対応)
│   │   ├── terminal.js     # xterm.js ラッパー
│   │   ├── toolbar.js      # 修飾キーツールバー
│   │   ├── ime-input.js    # IME 入力フィールド
│   │   ├── drawer.js       # セッション/ウィンドウ drawer
│   │   ├── touch.js        # タッチジェスチャーハンドラ
│   │   └── connection.js   # 接続状態管理・自動再接続
│   ├── manifest.json       # PWA マニフェスト
│   ├── sw.js               # Service Worker
│   ├── icons/              # PWA アイコン (192x192, 512x512)
│   └── build/              # esbuild 出力 (gitignore)
├── embed.go                # //go:embed frontend/build/*
├── Makefile
└── README.md
```

---

## Build & Deploy

```makefile
# Makefile
GO ?= $(shell which go 2>/dev/null || echo /usr/local/go/bin/go)

.PHONY: build frontend build-linux build-arm test clean

frontend:
	cd frontend && npx esbuild js/app.js \
	  --bundle --minify --outdir=build
	cp frontend/index.html frontend/build/
	cp frontend/css/style.css frontend/build/
	cp frontend/node_modules/@xterm/xterm/css/xterm.css frontend/build/
	cp frontend/manifest.json frontend/build/
	cp frontend/sw.js frontend/build/
	mkdir -p frontend/build/icons
	cp -r frontend/icons/* frontend/build/icons/

build: frontend
	CGO_ENABLED=0 $(GO) build -o palmux .

# クロスコンパイル
build-linux: frontend
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build -o palmux-linux-amd64 .
build-arm: frontend
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 $(GO) build -o palmux-linux-arm64 .

test:
	$(GO) test ./...
```

> **Note:** xterm.js は `--external` を使わずバンドルに含める（`embed.FS` でシングルバイナリにするため）。

### 起動

```bash
$ ./palmux --port 8080
Palmux started on :8080 (base path: /)
Auth token: a1b2c3d4e5f6...

# ベースパス付き
$ ./palmux --port 8080 --base-path /palmux/
Palmux started on :8080 (base path: /palmux/)
Auth token: a1b2c3d4e5f6...
```

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--port` | `8080` | Listen port |
| `--host` | `0.0.0.0` | Listen address |
| `--tmux` | `tmux` | tmux binary path |
| `--tls-cert` | - | TLS certificate file |
| `--tls-key` | - | TLS private key file |
| `--token` | (auto-generated) | 固定の認証トークンを指定 |
| `--base-path` | `/` | ベースパス (例: `/palmux/`, `/hogehoge/`) |
| `--max-connections` | `5` | セッションあたりの最大同時接続数 |

---

## Security

- 起動時にランダムな Bearer token を生成し stdout に出力
- `--token` フラグで固定トークンも指定可能（systemd 等での運用向け）
- LAN 外に公開する場合は TLS 必須（`--tls-cert`, `--tls-key`）
- リバースプロキシ（Caddy, nginx）の背後で動かすことを推奨

---

## Development Approach: テストファースト

すべての機能実装はテストを先に書いてから実装する（TDD）。

### テスト戦略

| レイヤー | テスト手法 | 内容 |
|---|---|---|
| `internal/tmux` | ユニットテスト + インターフェース | `TmuxExecutor` インターフェースを定義し、テスト時はモック実装を注入。実際の tmux コマンド出力をテストフィクスチャとして保存 |
| `internal/server` | httptest による API テスト | 各エンドポイントのリクエスト/レスポンス、認証、ベースパス処理を検証 |
| `internal/server` (WebSocket) | gorilla/websocket のテストクライアント | pty I/O の双方向通信を検証 |
| `internal/server` (base path) | 複数ベースパスでのルーティングテスト | `/`, `/palmux/`, `/deep/nested/path/` 等でAPIが正しく動作するか検証 |
| フロントエンド | 手動テスト（v1） | v1 ではブラウザでの手動確認。将来的に Playwright 等を検討 |

### インターフェース設計（テスタビリティのため）

```go
// internal/tmux/executor.go

// Executor は tmux コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type Executor interface {
    Run(args ...string) ([]byte, error)
}

// RealExecutor は実際の tmux バイナリを実行する。
type RealExecutor struct {
    TmuxBin string
}

func (e *RealExecutor) Run(args ...string) ([]byte, error) {
    return exec.Command(e.TmuxBin, args...).Output()
}

// Manager は Executor を通じて tmux を操作する。
type Manager struct {
    Exec Executor
}
```

### テスト実行

```bash
# 全テスト
go test ./...

# tmux パッケージのみ
go test ./internal/tmux/...

# カバレッジ
go test -cover ./...
```

### テストフィクスチャ例

```
internal/tmux/testdata/
├── list-sessions.txt        # tmux list-sessions の出力例
├── list-sessions-empty.txt  # セッションなしの出力
├── list-windows.txt         # tmux list-windows の出力例
└── list-windows-single.txt  # ウィンドウ1つの出力
```

---

## Implementation Phases

**原則: 各タスクはテストを先に書き、テストが失敗することを確認してから実装する。**

### Phase 1: MVP

- [x] tmux Executor インターフェース + モック実装
- [x] tmux Manager (ListSessions, ListWindows, Attach) — テストフィクスチャ付き
- [x] tmux 出力パーサー — テーブル駆動テスト
- [x] HTTP サーバー + ベースパス処理 — httptest でルーティング検証
- [x] Bearer token 認証ミドルウェア — 正常/異常系テスト
- [x] REST API ハンドラ — モック Manager 注入でテスト
- [x] WebSocket pty ブリッジ
- [x] 最小限のフロントエンド（xterm.js + セッション選択）

### Phase 2: Mobile UX

- [x] 修飾キーツールバー（ワンショット/ロック）
- [x] IME 入力フィールド（Direct/IME モード切り替え）
- [x] セッション/ウィンドウ drawer UI
- [x] タッチ操作最適化（スワイプでウィンドウ切り替え等）
- [x] フォントサイズ調整
- [x] PWA 対応（ホーム画面に追加）

### Phase 3: Enhanced Features

- [x] セッション/ウィンドウの作成・削除 UI
- [x] ウィンドウリネーム
- [x] 接続状態表示・自動再接続
- [x] TLS サポート
- [x] 複数端末からの同時接続

---

## Notes

- xterm.js の `Terminal.onData()` で入力を受け取り、修飾キーツールバーの状態と合成してから WebSocket に送信する
- xterm.js 本体は `inputmode="none"` を設定し、Android の IME（GBoard 等）による composition イベントの不整合を回避する
- 日本語等の IME 入力は専用テキストフィールド経由で行い、確定済みテキストのみを pty に送信する
- ウィンドウ切り替え時は WebSocket を張り直さず、同一 pty 上で `tmux select-window` を実行する
- `creack/pty` は `CGO_ENABLED=0` でもビルド可能（pure Go fallback あり、要確認）
- tmux がインストールされていない場合は起動時にエラーで終了する
- tmux サーバーが起動していない場合、`ListSessions` は空配列を返す（`no server running` エラーをハンドリング）
- ファイル名に `_windows` サフィックスを使わない（Go が `GOOS=windows` のビルド制約と解釈するため `api_window.go` とする）
- xterm.js パッケージはスコープ付き名前を使用: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`