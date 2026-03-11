# Palmux - Claude Code Development Guide

## プロジェクト概要

Palmux（パーマックス）は、スマホから快適に tmux を操作できる Web ベースのターミナルクライアント。
実装前に必ず `DESIGN.md` を読み、設計に沿って実装すること。

- 用語集: **`docs/glossary.md`**（新機能・新 UI 追加時は必ず更新）
- 開発ワークフロー・ディレクトリ構成・テスト戦略の詳細: **`docs/development-guide.md`**

## 技術スタック

- **Backend**: Go（`net/http`, `nhooyr.io/websocket`, `github.com/creack/pty`, `embed.FS`）
- **Frontend**: Svelte 5 + xterm.js（Vite でバンドル）
  - UI コンポーネント: Svelte 5 runes（`$state`, `$props`, `$derived`, `$effect`）
  - ビルドツール: Vite + `@sveltejs/vite-plugin-svelte`
  - 状態管理: Svelte stores（`frontend/src/stores/`）
  - アーキテクチャ: ルート `App.svelte` からフル Svelte コンポーネントツリー（Adapter 層なし）

## コーディング規約

### Go

- `gofmt` / `goimports` に従う
- エラーは必ずハンドリングする（`_` で握りつぶさない）
- `internal/` 配下にパッケージを置く（外部公開しない）
- インターフェースでテスタビリティを確保（特に `tmux.Executor`）
- ハンドラは依存を構造体のフィールドで受け取る（グローバル変数を使わない）

### Frontend

- **Svelte 5** で書く。runes API（`$state`, `$props`, `$derived`, `$effect`）を使用する
- モバイルファースト: スマホでの操作性を最優先に設計する
- xterm.js 本体には `inputmode="none"` を設定し、IME 入力は専用フィールド経由
- **ナビゲーションは必ず `router.js` の `Router` 経由**。`history.pushState` / `replaceState` を直接呼ばない（詳細は `docs/development-guide.md`）
- **コンポーネント連携**: `bind:this` と `export function` で親子間の命令的アクセスを実現
- **ディレクトリ構成**:
  - `frontend/src/lib/` — Svelte コンポーネント（`.svelte`）
  - `frontend/src/stores/` — Svelte stores（`.svelte.js`）
  - `frontend/js/` — ロジック層 Vanilla JS（terminal, connection, filebrowser 等。Svelte コンポーネントが内部でインポート）

## 開発原則

### テストファースト（TDD）

- **すべての機能はテストを先に書いてから実装する**（Red → Green → Refactor）
- テストなしのコードを commit しない
- テーブル駆動テスト（table-driven tests）を積極的に使う

### 実装ワークフロー

subagent-driven-development で進める。詳細は `docs/development-guide.md` を参照。

## コマンド

```bash
make test                        # 全テスト
make serve                       # portman 経由でサーバー起動（ポート直接指定禁止）
make build                       # フロントエンドビルド → Go バイナリ生成
make frontend                    # フロントエンドのみビルド
go test ./internal/tmux/...      # パッケージ指定テスト
go test -v -run TestParseSession # 特定テスト
```

サーバー起動スクリプトを変更する場合は portman ガイドを参照:
https://raw.githubusercontent.com/tjst-t/port-manager/main/docs/CLAUDE_INTEGRATION.md

## 注意点

- `api_window.go` は単数形（`_windows` は Go の `GOOS=windows` ビルド制約と衝突するため）
- xterm.js のパッケージ名はスコープ付き: `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`
- WebSocket メッセージは JSON 形式。認証はクエリパラメータ `?token=xxx` でも可能
- `creack/pty` は Unix 系のみ対応
- ベースパス: `--base-path` で設定、`http.StripPrefix` で処理、`<meta name="base-path">` でフロントエンドに注入
