# Phase 4: セッション内蔵ファイラー タスク一覧

Phase 3 が完了していることが前提。
tmux セッションのカレントディレクトリをルートにした読み取り専用ファイルブラウザを Palmux に組み込む。
Claude Code が生成したコード・ドキュメントをスマホからプレビューする用途。

---

## 設計概要

### コンセプト

- セッションごとに📁ボタン → そのセッションのアクティブ pane の `pane_current_path` をルートにしたファイラーを表示
- 読み取り専用（プレビュー用途。ファイルの作成・編集・削除はしない）
- Markdown は HTML レンダリング、コードはシンタックスハイライト、画像はインライン表示

### API

```
GET {basePath}api/sessions/{session}/cwd
Response: { "path": "/home/user/projects/palmux" }

GET {basePath}api/sessions/{session}/files?path=.
Response: {
  "path": ".",
  "abs_path": "/home/user/projects/palmux",
  "entries": [
    { "name": "main.go", "size": 1234, "is_dir": false, "mod_time": "...", "extension": ".go" },
    { "name": "internal", "size": 4096, "is_dir": true, "mod_time": "..." },
    ...
  ]
}

GET {basePath}api/sessions/{session}/files?path=README.md
Response: {
  "path": "README.md",
  "abs_path": "/home/user/projects/palmux/README.md",
  "is_dir": false,
  "size": 5678,
  "extension": ".md",
  "content": "# Palmux\n\n...",
  "content_type": "text"
}

GET {basePath}api/sessions/{session}/files?path=screenshot.png&raw=true
Response: (バイナリ、Content-Type: image/png)
```

### セキュリティ

- パストラバーサル防止: `filepath.Clean` + ルートディレクトリの外に出ないことを検証
- シンボリックリンク: `filepath.EvalSymlinks` で解決後にルート内か検証
- ファイルサイズ制限: テキストコンテンツは最大 1MB まで返す（超過時は先頭のみ + truncated フラグ）
- バイナリファイル: raw パラメータなしの場合はメタデータのみ返す

---

## Task 1: tmux カレントパス取得 API

**対象ファイル:**
- `internal/tmux/tmux.go` (`GetSessionCwd` メソッド追加)
- `internal/tmux/tmux_test.go`
- `internal/server/api_files.go` (新規: cwd エンドポイント)
- `internal/server/api_files_test.go` (新規)

**内容:**

バックエンド tmux Manager:
- `GetSessionCwd(session string) (string, error)`
  - 実行コマンド: `tmux display-message -p -t {session} '#{pane_current_path}'`
  - アクティブウィンドウのアクティブ pane のカレントパスを返す

REST API:
- `GET {basePath}api/sessions/{session}/cwd`
  - Response: `{"path": "/home/user/projects/palmux"}`
  - セッションが存在しない → 404
  - tmux エラー → 500

**テスト:**
- モック Executor で `display-message` の引数と出力をテスト
- httptest で cwd エンドポイントの正常系・404・500

**完了条件:**
- `go test ./...` パス
- 実際の tmux セッションで正しいパスが返る

---

## Task 2: ファイル一覧・読み取り API

**対象ファイル:**
- `internal/fileserver/fileserver.go` (新規パッケージ)
- `internal/fileserver/fileserver_test.go` (新規)
- `internal/server/api_files.go` (files エンドポイント追加)
- `internal/server/api_files_test.go` (追記)

**内容:**

`internal/fileserver` パッケージ:
- `FileServer` 構造体: `RootDir string` を保持
- `List(relPath string) (*DirListing, error)` — ディレクトリ一覧を返す
  - ソート: ディレクトリ優先、名前昇順
  - 隠しファイル（`.` 始まり）は含めるが、`.git` ディレクトリの中身は除外
- `Read(relPath string) (*FileContent, error)` — ファイル内容を返す
  - テキストファイル: UTF-8 として内容を返す（最大 1MB）
  - バイナリ判定: 先頭 512 バイトの `http.DetectContentType` で判定
  - 1MB 超過時: 先頭 1MB + `"truncated": true`
- `RawFile(relPath string) (io.ReadCloser, string, error)` — バイナリそのまま返す（画像等用）
- `ValidatePath(relPath string) (string, error)` — パストラバーサル防止
  - `filepath.Clean` → `filepath.Join(root, cleaned)` → `filepath.EvalSymlinks` → ルート外なら error

セキュリティ:
- `../` によるルート外アクセスを拒否
- シンボリックリンク解決後のパスがルート内であることを検証
- ルート自体が存在しない場合はエラー

型定義:
```go
type DirEntry struct {
    Name      string    `json:"name"`
    Size      int64     `json:"size"`
    IsDir     bool      `json:"is_dir"`
    ModTime   time.Time `json:"mod_time"`
    Extension string    `json:"extension,omitempty"`
}

type DirListing struct {
    Path    string     `json:"path"`
    AbsPath string    `json:"abs_path"`
    Entries []DirEntry `json:"entries"`
}

type FileContent struct {
    Path        string `json:"path"`
    AbsPath     string `json:"abs_path"`
    IsDir       bool   `json:"is_dir"`
    Size        int64  `json:"size"`
    Extension   string `json:"extension,omitempty"`
    Content     string `json:"content,omitempty"`
    ContentType string `json:"content_type"` // "text", "image", "binary"
    Truncated   bool   `json:"truncated,omitempty"`
}
```

REST API:
- `GET {basePath}api/sessions/{session}/files?path=.` → DirListing
- `GET {basePath}api/sessions/{session}/files?path=README.md` → FileContent
- `GET {basePath}api/sessions/{session}/files?path=img.png&raw=true` → バイナリ (Content-Type 付き)
- cwd は Task 1 で取得済みのものを FileServer の RootDir として使用

**テスト:**
- `t.TempDir()` にテスト用ディレクトリ構造を作成してテスト
- ディレクトリ一覧: ソート順、隠しファイル、.git 除外
- ファイル読み取り: テキスト、大きいファイル（truncated）、バイナリ判定
- パストラバーサル: `../../etc/passwd` → エラー
- シンボリックリンク: ルート外へのリンク → エラー、ルート内リンク → OK
- 存在しないパス → 404

**完了条件:**
- `go test ./...` パス
- パストラバーサル攻撃が確実にブロックされる

---

## Task 3: ファイラーUI — ディレクトリブラウズ

**対象ファイル:**
- `frontend/js/filebrowser.js` (新規)
- `frontend/js/api.js` (ファイル API クライアント追加)
- `frontend/css/filebrowser.css` (新規)
- `frontend/index.html` (ファイラーパネル用 HTML 追加)
- `frontend/js/app.js` (ファイラーパネルの表示/非表示統合)
- `frontend/js/drawer.js` (セッション横の📁ボタン追加)

**内容:**

Drawer の変更:
- 各セッション名の横に📁アイコンボタンを追加
- タップ → drawer を閉じ、ファイラーパネルに切り替え

ファイラーパネル:
- ターミナルパネルと排他表示（ターミナル ↔ ファイラー の切り替え）
- ヘッダーに表示切り替えボタン: [Terminal] [Files] のタブ、またはトグルアイコン
- パンくずリスト: `palmux / internal / server /` — 各階層をタップで移動
- ファイル一覧: アイコン + ファイル名 + サイズ + 更新日時
  - ディレクトリ: 📁 アイコン、タップで中に入る
  - テキストファイル: 📄 アイコン、タップで Task 4 のプレビューを開く
  - 画像ファイル: 🖼 アイコン
  - その他: 📎 アイコン
- ソート: ディレクトリ優先、名前昇順（API レスポンスの順序をそのまま使用）
- 戻るボタン: パンくずリストの親ディレクトリへ

API 呼び出し:
- 📁タップ時: `GET {basePath}api/sessions/{session}/cwd` でルートパス取得
- ディレクトリ表示: `GET {basePath}api/sessions/{session}/files?path={relative}`

**テスト:**
- 📁タップ → ファイラーパネル表示、ターミナルパネル非表示
- [Terminal] タップ → ターミナルに戻る
- ディレクトリタップ → 中のファイル一覧が表示される
- パンくずリストの親階層タップ → 上位ディレクトリに移動

**完了条件:**
- セッションのカレントディレクトリからファイルツリーをブラウズできる
- ターミナル ↔ ファイラーの切り替えがスムーズ

---

## Task 4: ファイルプレビュー — Markdown・コード・画像

**対象ファイル:**
- `frontend/js/file-preview.js` (新規)
- `frontend/css/filebrowser.css` (プレビュースタイル追記)
- `frontend/js/filebrowser.js` (プレビュー表示呼び出し追加)

**依存ライブラリ (CDN or esbuild バンドル):**
- `marked` — Markdown → HTML レンダリング
- `highlight.js` — コードのシンタックスハイライト

**内容:**

プレビューパネル:
- ファイラー一覧でファイルをタップ → プレビューパネルに切り替え
- ヘッダーにファイル名とサイズ、[← 戻る] ボタン

ファイル種類別のプレビュー:

| 拡張子 | 表示方式 |
|---|---|
| `.md` | marked でHTML変換 + highlight.js でコードブロックハイライト |
| `.go`, `.js`, `.py`, `.sh`, `.yaml`, `.json`, `.toml`, `.css`, `.html`, `.sql`, `.rs`, `.ts`, `.tsx`, `.jsx`, `.c`, `.h`, `.cpp`, `.java`, `.rb`, `.php`, `.swift`, `.kt` | highlight.js でシンタックスハイライト + 行番号 |
| `.txt`, `.log`, `.csv`, `.env`, `.gitignore`, `Makefile`, `Dockerfile` | プレーンテキスト表示（等幅フォント） |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.ico` | `<img>` タグでインライン表示（raw API 使用） |
| `.pdf` | `<iframe>` で表示、または「ダウンロード」リンク |
| その他 | 「プレビュー不可」メッセージ + ファイル情報（サイズ、更新日時） |

Markdown レンダリングの設定:
- GFM (GitHub Flavored Markdown) 有効
- テーブル、チェックボックス、コードブロック対応
- 画像リンクは相対パスを raw API URL に変換
  - `![alt](./docs/arch.png)` → `<img src="{basePath}api/sessions/{session}/files?path=docs/arch.png&raw=true">`
- highlight.js の言語自動検出

大きいファイルの処理:
- API が `truncated: true` を返した場合、末尾に「ファイルが大きいため途中までの表示です」と注記

**テスト:**
- .md ファイルタップ → Markdown が HTML にレンダリングされる
- .go ファイルタップ → Go のシンタックスハイライトが適用される
- .png ファイルタップ → 画像がインライン表示される
- 未対応ファイル → プレビュー不可メッセージ
- 戻るボタン → ファイル一覧に戻る

**完了条件:**
- Markdown がきれいにレンダリングされる（テーブル、コードブロック、画像含む）
- コードファイルにシンタックスハイライトが付く
- 画像がインライン表示される
- スマホで読みやすいレイアウト

---

## Task 5: フロントエンドビルド統合 + テスト

**対象ファイル:**
- `Makefile` (marked, highlight.js の依存追加)
- `frontend/js/app.js` (最終統合)
- `embed.go` (新しい CSS ファイルの埋め込み確認)

**内容:**
- esbuild で marked, highlight.js をバンドルに含める
  - `npm install marked highlight.js` (frontend/ 配下)
  - esbuild の entrypoint に filebrowser.js, file-preview.js を追加
- highlight.js のテーマ CSS をバンドルに含める（github-dark テーマ推奨）
- `make build` でファイラー込みのシングルバイナリが生成されることを確認
- ファイラーのスタイルがターミナルのスタイルと干渉しないことを検証

**テスト:**
- `make build` がエラーなく完了する
- バイナリ起動 → ブラウザでターミナル接続 → ファイラー切り替え → Markdown プレビューの一連の操作が動作する
- esbuild のバンドルサイズが妥当（highlight.js は言語を絞る: go, javascript, python, bash, yaml, json, html, css, sql, typescript — 全言語バンドルは避ける）

**完了条件:**
- `make build` でシングルバイナリが生成される
- ファイラー機能がバイナリに含まれ、追加インストール不要で動作する
