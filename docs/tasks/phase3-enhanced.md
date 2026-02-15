# Phase 3: Enhanced Features タスク一覧

Phase 2 (Mobile UX) が完了していることが前提。
運用に必要な堅牢性と利便性を追加するフェーズ。

---

## Task 1: セッション作成・削除 UI

**対象ファイル:**
- `frontend/js/drawer.js` (作成・削除 UI 追加)
- `frontend/css/style.css` (追記)

**依存:** Phase 2 Task 3 (Drawer UI)

**内容:**
- Drawer 下部の [New Session] ボタンで新規セッション作成
  - タップ → セッション名の入力ダイアログ表示
  - 入力確定 → `POST {basePath}api/sessions` を呼び出し
  - 作成成功 → セッション一覧を再取得し、新セッションに自動接続
- セッション名を長押し（またはスワイプ）で削除オプション表示
  - 確認ダイアログ: 「セッション "{name}" を削除しますか？」
  - 確認 → `DELETE {basePath}api/sessions/{name}` を呼び出し
  - 現在接続中のセッションは削除不可（エラー表示）
- 空のセッション名、既存名の重複バリデーション

**テスト:**
- [New Session] → 名前入力 → セッション作成 API が呼ばれる
- 空名 → バリデーションエラー表示
- セッション長押し → 削除確認 → 削除 API が呼ばれる
- 接続中セッションの削除 → エラー表示

**完了条件:**
- Drawer からセッションの作成・削除がスムーズに行える
- エラーケースが適切にハンドリングされる

---

## Task 2: ウィンドウ作成・削除 UI

**対象ファイル:**
- `frontend/js/drawer.js` (ウィンドウ作成・削除 UI 追加)
- `frontend/css/style.css` (追記)

**依存:** Phase 2 Task 3 (Drawer UI), Phase 3 Task 1

**内容:**
- セッション展開時のウィンドウ一覧に [+] ボタンで新規ウィンドウ作成
  - タップ → `POST {basePath}api/sessions/{session}/windows` を呼び出し
  - 作成成功 → ウィンドウ一覧再取得、新ウィンドウに切り替え
- ウィンドウ項目を長押し（またはスワイプ）で削除オプション表示
  - 確認ダイアログ: 「ウィンドウ "{index}: {name}" を削除しますか？」
  - 確認 → `DELETE {basePath}api/sessions/{session}/windows/{index}` を呼び出し
  - セッション内の最後のウィンドウは削除不可（tmux の制約）
- 削除後に表示中のウィンドウが消えた場合、前のウィンドウに自動切り替え

**テスト:**
- [+] タップ → ウィンドウ作成 API が呼ばれ、一覧が更新される
- ウィンドウ長押し → 削除確認 → 削除 API が呼ばれる
- 最後のウィンドウの削除 → エラー表示
- 表示中ウィンドウ削除後の自動切り替え

**完了条件:**
- Drawer からウィンドウの作成・削除が行える
- 最後のウィンドウの削除防止が動作する

---

## Task 3: ウィンドウリネーム

**対象ファイル:**
- `internal/tmux/tmux.go` (`RenameWindow` メソッド追加)
- `internal/tmux/tmux_test.go`
- `internal/server/api_windows.go` (`PATCH` エンドポイント追加)
- `internal/server/api_windows_test.go`
- `frontend/js/drawer.js` (リネーム UI 追加)

**内容:**

バックエンド:
- `Manager.RenameWindow(session string, index int, name string) error`
  - 実行コマンド: `tmux rename-window -t {session}:{index} {name}`
- `PATCH {basePath}api/sessions/{session}/windows/{index}`
  - Body: `{"name": "new-name"}`
  - Response: 200 + 更新後の Window JSON

フロントエンド:
- Drawer のウィンドウ名をタップでインライン編集可能にする
  - ウィンドウ名部分をタップ → `<input>` に切り替え
  - Enter で確定 → `PATCH` API を呼び出し
  - Esc でキャンセル
- リネーム成功後、ヘッダーの `session:window` 表示も更新

**テスト:**
- バックエンド: RenameWindow がモック Executor で正しい引数を渡す
- バックエンド: PATCH エンドポイントの正常系・異常系（空名、存在しないウィンドウ）
- フロントエンド: ウィンドウ名タップ → 編集 → Enter で API 呼び出し
- フロントエンド: Esc でキャンセル時に元の名前に戻る

**完了条件:**
- Drawer からウィンドウリネームが行える
- ヘッダー表示がリアルタイムに更新される

---

## Task 4: 接続状態表示・自動再接続

**対象ファイル:**
- `frontend/js/connection.js` (新規)
- `frontend/js/terminal.js` (再接続ロジック統合)
- `frontend/js/app.js` (接続状態 UI 統合)
- `frontend/css/style.css` (接続状態インジケーターのスタイル)

**内容:**

接続状態管理:
- 3 つの状態: `connected`, `connecting`, `disconnected`
- ヘッダーに状態インジケーター表示
  - `connected`: 緑ドット (●)
  - `connecting`: 黄ドット (●) + "再接続中..." テキスト
  - `disconnected`: 赤ドット (●) + "切断" テキスト

自動再接続:
- WebSocket 切断を `onclose` / `onerror` で検知
- 指数バックオフで再接続を試行: 1s → 2s → 4s → 8s → 16s → 30s (最大)
- 再接続成功時に状態を `connected` に戻す
- 再接続中はターミナルに「再接続中...」のオーバーレイ表示
- ネットワーク復帰検知: `navigator.onLine` / `online` イベントで即座に再接続試行
- 手動再接続ボタン: `disconnected` 状態時にヘッダーのインジケーターをタップで即座に再接続

**テスト:**
- WebSocket 切断 → 状態が `connecting` に遷移し再接続試行開始
- 再接続成功 → 状態が `connected` に遷移
- 最大リトライ間隔が 30s を超えない
- `online` イベントで即座に再接続試行
- 手動再接続ボタンの動作

**完了条件:**
- ネットワーク不安定時に自動再接続が動作する
- 接続状態が視覚的に常に確認できる

---

## Task 5: TLS サポート

**対象ファイル:**
- `main.go` (`--tls-cert`, `--tls-key` フラグの実装)
- `internal/server/server.go` (`ListenAndServeTLS` 対応)
- `internal/server/server_test.go` (TLS テスト追加)

**内容:**
- `--tls-cert` と `--tls-key` の両方が指定された場合、`http.ListenAndServeTLS` で起動
- どちらか片方のみ指定された場合はエラー終了
- 証明書ファイルの存在チェック（起動時）
- TLS 起動時のログ出力: `Palmux started on :8080 (TLS) (base path: /)`
- WebSocket の接続先も `wss://` になることをフロントエンドで自動判定
  - `location.protocol === 'https:' ? 'wss:' : 'ws:'`

**テスト:**
- `--tls-cert` のみ指定 → エラー終了
- `--tls-key` のみ指定 → エラー終了
- 両方指定 + 有効な証明書 → TLS で起動
- 存在しないファイルパス → エラー終了
- httptest + TLS テスト（自己署名証明書使用）

**完了条件:**
- `./palmux --tls-cert cert.pem --tls-key key.pem` で HTTPS 起動する
- ブラウザから `https://` でアクセスできる
- フロントエンドの WebSocket が自動で `wss://` に切り替わる

---

## Task 6: 複数端末からの同時接続

**対象ファイル:**
- `internal/server/ws.go` (接続管理の改善)
- `internal/server/ws_test.go`

**内容:**

現状の Phase 1 実装では WebSocket 接続が 1 対 1（1 セッション:1 ウィンドウに 1 接続）。
複数ブラウザ/タブから同じセッション・ウィンドウに同時接続できるようにする。

- 同一セッションへの複数 WebSocket 接続を許可
  - 各接続が独立した `tmux attach-session` の pty を持つ
  - tmux 側が複数 client をネイティブに処理するため、サーバー側の特別なロジックは最小限
- 接続数の制限: 同一セッションへの最大同時接続数（デフォルト 5）
  - 超過時は 429 Too Many Connections を返す
  - `--max-connections` フラグで設定可能
- 接続一覧 API: `GET {basePath}api/connections`
  - Response: 各接続のセッション名、接続時刻、リモート IP

**テスト:**
- 同一セッションに 2 つの WebSocket を同時接続 → 両方で入出力が動作する
- 片方の接続を閉じても他方は維持される
- 接続数制限超過 → 429 エラー
- 接続一覧 API が正しい情報を返す

**完了条件:**
- スマホとPCから同時に同じセッションに接続できる
- 接続数の上限が適切に機能する
