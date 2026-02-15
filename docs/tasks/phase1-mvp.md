# Phase 1: MVP タスク一覧

各タスクを順番に subagent で実装する。
タスク間に依存関係があるため、番号順に実装すること。

---

## Task 1: プロジェクト初期化

**対象ファイル:**
- `go.mod`
- `Makefile`
- `.gitignore`
- ディレクトリ構成（空ファイルでもよい）

**内容:**
- `go mod init github.com/{owner}/palmux` （owner は適宜）
- 依存追加: `nhooyr.io/websocket`, `github.com/creack/pty`
- CLAUDE.md のディレクトリ構成に従いフォルダを作成
- Makefile の雛形（`frontend`, `build`, `build-linux`, `build-arm` ターゲット）
- `.gitignore` に `frontend/build/`, バイナリ等を追加

**完了条件:**
- `go mod tidy` がエラーなく完了する
- ディレクトリ構成が CLAUDE.md と一致する

---

## Task 2: tmux Executor インターフェース + パーサー

**対象ファイル:**
- `internal/tmux/executor.go`
- `internal/tmux/parse.go`
- `internal/tmux/parse_test.go`
- `internal/tmux/testdata/*.txt`

**参照:** DESIGN.md「tmux Manager」セクション

**内容:**
- `Executor` インターフェース: `Run(args ...string) ([]byte, error)`
- `RealExecutor` 構造体: 実際の tmux バイナリを実行
- パーサー関数: `ParseSessions(data []byte) ([]Session, error)`, `ParseWindows(data []byte) ([]Window, error)`
- tmux の `-F` フォーマット出力をタブ区切りでパース
- testdata に実際の tmux 出力例を配置

**テスト:**
- テーブル駆動テストで正常系・異常系・空出力を検証
- testdata フィクスチャを使ったパーステスト

**完了条件:**
- `go test ./internal/tmux/...` が全件パス

---

## Task 3: tmux Manager

**対象ファイル:**
- `internal/tmux/tmux.go`
- `internal/tmux/tmux_test.go`

**依存:** Task 2 (Executor, パーサー)
**参照:** DESIGN.md「tmux Manager」セクション

**内容:**
- `Manager` 構造体: `Exec Executor` フィールドを持つ
- メソッド: `ListSessions()`, `ListWindows(session)`, `NewSession(name)`, `KillSession(name)`, `NewWindow(session, name)`, `KillWindow(session, index)`
- 各メソッドは `Executor.Run()` を呼び出し、パーサーで結果を変換
- `Attach` メソッドは Task 7 で実装するためスキップ

**テスト:**
- モック Executor を注入（期待する引数の検証 + 固定出力を返す）
- 各メソッドの正常系・エラー系

**完了条件:**
- `go test ./internal/tmux/...` が全件パス

---

## Task 4: 認証ミドルウェア

**対象ファイル:**
- `internal/server/auth.go`
- `internal/server/auth_test.go`

**参照:** DESIGN.md「Security」セクション

**内容:**
- `AuthMiddleware(token string) func(http.Handler) http.Handler`
- `Authorization: Bearer <token>` ヘッダーを検証
- 不正な場合は 401 Unauthorized を返す

**テスト (httptest):**
- 正しいトークン → 200 (次のハンドラに委譲)
- トークンなし → 401
- 不正トークン → 401
- Bearer 以外のスキーム → 401

**完了条件:**
- `go test ./internal/server/...` が全件パス

---

## Task 5: HTTP サーバー + ベースパス処理

**対象ファイル:**
- `internal/server/server.go`
- `internal/server/server_test.go`

**依存:** Task 4 (認証ミドルウェア)
**参照:** DESIGN.md「Base Path」セクション

**内容:**
- `Server` 構造体: tmux Manager, token, basePath, フロント用FS 等を保持
- `NewServer(opts)` でサーバー生成
- ベースパス正規化: 必ず `/` で始まり `/` で終わる
- `http.StripPrefix(basePath, mux)` でベースパスを処理
- ルーティング登録（ハンドラの実装は Task 6, 7）
- フロントエンド配信（静的ファイル）

**テスト (httptest):**
- ベースパス `/` でのルーティング
- ベースパス `/palmux/` でのルーティング
- ベースパス `/deep/nested/path/` でのルーティング
- ベースパス正規化（`palmux` → `/palmux/`）

**完了条件:**
- `go test ./internal/server/...` が全件パス

---

## Task 6: REST API ハンドラ

**対象ファイル:**
- `internal/server/api_sessions.go`
- `internal/server/api_sessions_test.go`
- `internal/server/api_windows.go`
- `internal/server/api_windows_test.go`

**依存:** Task 3 (Manager), Task 5 (Server)
**参照:** DESIGN.md「REST API」セクション

**内容:**
- セッション API: `GET /api/sessions`, `POST /api/sessions`, `DELETE /api/sessions/{name}`
- ウィンドウ API: `GET /api/sessions/{session}/windows`, `POST /api/sessions/{session}/windows`, `DELETE /api/sessions/{session}/windows/{index}`
- JSON リクエスト/レスポンス
- エラーハンドリング（404, 400, 500）

**テスト (httptest):**
- モック tmux Manager を注入
- 各エンドポイントの正常系レスポンス検証（ステータスコード + JSON ボディ）
- エラー系（存在しないセッション、不正リクエスト等）

**完了条件:**
- `go test ./internal/server/...` が全件パス

---

## Task 7: WebSocket pty ブリッジ

**対象ファイル:**
- `internal/server/ws.go`
- `internal/server/ws_test.go`
- `internal/tmux/tmux.go` に `Attach` メソッドを追加

**依存:** Task 3 (Manager), Task 5 (Server)
**参照:** DESIGN.md「WebSocket」「pty attach 方式の詳細」セクション

**内容:**
- `Attach(session string) (*os.File, *exec.Cmd, error)` — `tmux attach-session -t {session}` を pty 内で実行
- WebSocket ハンドラ: 接続時に Attach を呼び、pty と WebSocket の双方向コピー
- メッセージフォーマット: `{"type": "input", "data": "..."}`, `{"type": "resize", "cols": 80, "rows": 24}`, `{"type": "output", "data": "..."}`
- 接続終了時のクリーンアップ（pty close, プロセス kill）

**テスト:**
- WebSocket テストクライアントでの接続・メッセージ送受信
- resize メッセージのハンドリング
- 接続切断時のクリーンアップ

**完了条件:**
- `go test ./internal/...` が全件パス

---

## Task 8: 最小限のフロントエンド

**対象ファイル:**
- `frontend/index.html`
- `frontend/js/app.js`
- `frontend/js/terminal.js`
- `frontend/js/api.js`
- `frontend/css/style.css`

**依存:** Task 5 (Server), Task 6 (API)
**参照:** DESIGN.md「Frontend Design」セクション

**内容:**
- `index.html`: SPA エントリ、`<meta name="base-path">` タグ、xterm.js/CSS の読み込み
- `api.js`: base-path 対応の REST API クライアント（sessions, windows の取得）
- `terminal.js`: xterm.js ラッパー（WebSocket 接続、resize 処理）
- `app.js`: セッション一覧→選択→ターミナル表示のフロー
- `style.css`: 基本レイアウト（モバイル対応は Phase 2 で本格化）
- 修飾キーツールバー、IME 入力フィールドは Phase 2 でやるためここでは不要

**完了条件:**
- esbuild でバンドルエラーなくビルドできる
- ブラウザでセッション一覧が表示され、選択するとターミナルに接続できる

---

## Task 9: バイナリ統合

**対象ファイル:**
- `embed.go`
- `main.go`
- `Makefile` の更新

**依存:** Task 1〜8 すべて

**内容:**
- `embed.go`: `//go:embed frontend/build/*` でフロントエンドを埋め込み
- `main.go`: CLI フラグ処理 (`--port`, `--host`, `--base-path`, `--tmux`, `--tls-cert`, `--tls-key`, `--token`)
- 起動時にトークン生成（`--token` 未指定時）して stdout に出力
- tmux の存在チェック（なければエラー終了）
- Makefile: `make build` で frontend ビルド → Go ビルドの一気通貫

**完了条件:**
- `make build` でシングルバイナリが生成される
- `./palmux --port 8080` で起動し、ブラウザからアクセスできる
- `./palmux --port 8080 --base-path /palmux/` でベースパス付き起動が動作する
