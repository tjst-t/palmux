# Palmux - Claude Code Development Guide

## プロジェクト概要

Palmux（パーマックス）は、スマホから快適に tmux を操作できる Web ベースのターミナルクライアント。
詳細は `DESIGN.md` を参照すること。実装前に必ず DESIGN.md を読み、設計に沿って実装すること。

### 用語集

機能・UI の共通用語は **`docs/glossary.md`** を参照すること。
指示者・Claude Code 双方がこの用語集を基準として会話する。

**新機能・新 UI を追加したら `docs/glossary.md` を必ず更新すること。**

## 開発原則

### テストファースト（TDD）

- **すべての機能はテストを先に書いてから実装する**
- テストが失敗することを確認（Red）→ 実装（Green）→ リファクタ（Refactor）
- テストなしのコードを commit しない
- テーブル駆動テスト（table-driven tests）を積極的に使う
- superpowers の `test-driven-development` スキルに従う

### 実装ワークフロー: subagent-driven-development

すべてのフェーズの実装は superpowers の `subagent-driven-development` スキルを使って進める。
メインエージェントはオーケストレーターに徹し、各タスクの実装は subagent に委譲する。

**フロー:**

1. 実装対象フェーズのタスクファイル（`docs/tasks/` 配下）を読み、全タスクを TodoWrite で管理する
2. 各タスクに対して以下を繰り返す:
   a. **implementer subagent を dispatch** — タスクの全文・コンテキスト・依存ファイルを渡す。TDD で実装・テスト・コミット・セルフレビューまで行わせる
   b. **spec reviewer subagent を dispatch** — DESIGN.md の該当仕様と implementer の成果物を渡し、仕様準拠を検証。❌ なら implementer に修正させて再レビュー
   c. **code quality reviewer subagent を dispatch** — 実装コードの品質レビュー。❌ なら implementer に修正させて再レビュー
   d. 両レビューが ✅ になったら TodoWrite でタスク完了にマーク
3. 全タスク完了後、最終コードレビュー subagent を dispatch
4. `finishing-a-development-branch` スキルで完了

**重要なルール:**
- subagent にはタスクの全文をプロンプトで渡す（ファイルを読ませない）
- spec review が ✅ になるまで code quality review に進まない
- レビューで問題が見つかったら修正→再レビューを繰り返す
- 実装 subagent を並列に dispatch しない（コンフリクト防止）

### 使用するスキル

- **superpowers:subagent-driven-development** — メインの実装ワークフロー
- **superpowers:test-driven-development** — 各 subagent の TDD 手法
- **superpowers:writing-plans** — 実装計画の策定
- **superpowers:finishing-a-development-branch** — 全タスク完了後のブランチ整理
- **frontend-design** — モバイルファーストの UI 実装

### タスク定義

各フェーズの実装タスクは `docs/tasks/` 配下に配置する。
Phase 1〜4 は全タスク実装済み。

- `docs/tasks/phase1-mvp.md` — Phase 1: MVP (完了)
- `docs/tasks/phase2-mobile-ux.md` — Phase 2: Mobile UX (完了)
- `docs/tasks/phase3-enhanced.md` — Phase 3: Enhanced Features (完了)
- `docs/tasks/phase4-file-browser.md` — Phase 4: Session File Browser (完了)

## 技術スタック

- **Backend**: Go (標準ライブラリ中心)
  - HTTP: `net/http`
  - WebSocket: `nhooyr.io/websocket`
  - PTY: `github.com/creack/pty`
  - tmux 連携: `os/exec`
  - 静的ファイル: `embed.FS`
- **Frontend**: Vanilla HTML/CSS/JS + xterm.js
  - フレームワーク不使用
  - バンドル: esbuild

## ディレクトリ構成

```
palmux/
├── CLAUDE.md
├── DESIGN.md
├── README.md
├── docs/
│   └── tasks/       # フェーズ別タスク定義
├── main.go
├── go.mod
├── embed.go         # //go:embed frontend/build/*
├── internal/
│   ├── fileserver/  # ファイル一覧・読み取り・パス検証
│   │   ├── fileserver.go      # FileServer 構造体、ValidatePath、List、Read、RawFile
│   │   └── fileserver_test.go
│   ├── server/      # HTTP サーバー、API ハンドラ、WebSocket
│   │   ├── server.go          # Server 構造体、ルーティング、TmuxManager インターフェース
│   │   ├── auth.go            # Bearer token 認証ミドルウェア
│   │   ├── api_sessions.go    # セッション API ハンドラ
│   │   ├── api_window.go      # ウィンドウ API ハンドラ（※ _windows は Go ビルド制約と衝突するため _window）
│   │   ├── api_files.go       # cwd / files エンドポイント
│   │   └── ws.go              # WebSocket pty ブリッジ、接続トラッカー
│   └── tmux/        # tmux Manager、Executor インターフェース、パーサー
│       ├── executor.go        # Executor インターフェース + RealExecutor
│       ├── tmux.go            # Manager 構造体
│       ├── parse.go           # tmux 出力パーサー
│       └── testdata/          # テストフィクスチャ
├── frontend/
│   ├── index.html
│   ├── css/
│   │   ├── style.css
│   │   └── filebrowser.css    # ファイラー用スタイル
│   ├── js/
│   │   ├── app.js             # メインアプリケーション
│   │   ├── api.js             # REST API クライアント
│   │   ├── terminal.js        # xterm.js ラッパー
│   │   ├── toolbar.js         # 修飾キーツールバー
│   │   ├── ime-input.js       # IME 入力フィールド
│   │   ├── drawer.js          # セッション/ウィンドウ Drawer
│   │   ├── touch.js           # タッチジェスチャーハンドラ
│   │   ├── connection.js      # 接続状態管理・自動再接続
│   │   ├── filebrowser.js     # ディレクトリブラウズ UI
│   │   └── file-preview.js    # Markdown / コード / 画像プレビュー
│   ├── manifest.json          # PWA マニフェスト
│   ├── sw.js                  # Service Worker
│   ├── icons/                 # PWA アイコン
│   └── build/                 # esbuild 出力 (gitignore)
└── Makefile
```

## コーディング規約

### Go

- `gofmt` / `goimports` に従う
- エラーは必ずハンドリングする（`_` で握りつぶさない）
- `internal/` 配下にパッケージを置く（外部公開しない）
- インターフェースでテスタビリティを確保する（特に `tmux.Executor`）
- ハンドラは依存を構造体のフィールドで受け取る（グローバル変数を使わない）

### Frontend

- Vanilla JS で書く。React 等のフレームワークは使わない
- モバイルファースト: スマホでの操作性を最優先に設計する
- xterm.js 本体には `inputmode="none"` を設定し、IME 入力は専用フィールド経由

## テスト

### 実行方法

```bash
make test                        # 全テスト（Makefile 経由、Go パス自動解決）
go test ./...                    # 全テスト（go が PATH にある場合）
go test ./internal/tmux/...      # tmux パッケージのみ
go test -cover ./...             # カバレッジ付き
go test -v -run TestParseSession # 特定テスト
```

### テスト方針

| パッケージ | 方針 |
|---|---|
| `internal/tmux` | `Executor` インターフェースのモック実装を注入。`testdata/` にフィクスチャ |
| `internal/server` | `httptest` でAPIテスト。tmux Manager もモック注入 |
| `internal/fileserver` | `t.TempDir()` にテスト用ディレクトリ構造を作成。パストラバーサル・シンボリックリンク検証 |
| WebSocket | テストクライアントで双方向通信を検証 |

### テストを書くときの注意

- 1つのテスト関数で1つの振る舞いを検証する
- テストケース名は日本語でもよい（`TestListSessions/セッションが空の場合`）
- `testdata/` のフィクスチャは実際の tmux 出力をコピーして使う

## ベースパス対応

- すべてのルートは `--base-path` で設定されたパスの下にマウントされる
- サーバー内部では相対パスでルーティングを定義し、`http.StripPrefix` で処理
- フロントエンドへは `<meta name="base-path">` タグで注入
- テストでは `/`, `/palmux/`, `/deep/nested/path/` 等の複数パターンを検証

## サーバー起動

- テストサーバーは `make serve` で起動すること。ポート番号を直接指定してはいけない。
- サーバー起動スクリプトを作成・変更する場合は、portman ガイドを参照すること:
  https://raw.githubusercontent.com/tjst-t/port-manager/main/docs/CLAUDE_INTEGRATION.md

```bash
make serve                       # portman 経由でサーバー起動（フォアグラウンド）
./dev-serve.sh                   # portman 経由でバックグラウンド起動（nohup + PID 管理）
```

## ビルド

```bash
make build                       # フロントエンドビルド → Go バイナリ生成
make frontend                    # フロントエンドのみビルド
make build-linux                 # Linux amd64 向けクロスコンパイル
make build-arm                   # Linux arm64 向けクロスコンパイル
```

Makefile は `GO` 変数で Go バイナリのパスを自動解決する（`which go` → `/usr/local/go/bin/go` にフォールバック）。
明示指定も可能: `make build GO=/usr/local/go/bin/go`

## よくある注意点

- `creack/pty` は Unix 系のみ対応（Windows では動かない）
- tmux がインストールされていない環境ではサーバー起動時にエラー終了する
- tmux サーバーが未起動の場合、`ListSessions` は空配列を返す（エラーではない）
- WebSocket のメッセージは JSON 形式（`{"type": "input", "data": "..."}` 等）
- WebSocket の認証はクエリパラメータ `?token=xxx` でも可能（ブラウザ WebSocket API はカスタムヘッダーを設定できないため）
- フロントエンドのビルド成果物 (`frontend/build/`) は gitignore する
- `api_window.go` のファイル名は単数形（`_windows` サフィックスは Go が `GOOS=windows` のビルド制約と解釈するため）
- xterm.js のパッケージ名はスコープ付き: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`