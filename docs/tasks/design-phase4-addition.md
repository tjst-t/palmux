# DESIGN.md 追記: Phase 4 セッション内蔵ファイラー

以下の内容を DESIGN.md に追記してください。

---

## REST API に追記: Files

```
GET    {basePath}api/sessions/{session}/cwd
Response: { "path": "/home/user/projects/palmux" }

GET    {basePath}api/sessions/{session}/files?path=.
Response: {
  "path": ".",
  "abs_path": "/home/user/projects/palmux",
  "entries": [
    { "name": "main.go", "size": 1234, "is_dir": false, "mod_time": "2025-01-15T10:30:00Z", "extension": ".go" },
    { "name": "internal", "size": 4096, "is_dir": true, "mod_time": "2025-01-15T09:00:00Z" }
  ]
}

GET    {basePath}api/sessions/{session}/files?path=README.md
Response: {
  "path": "README.md",
  "abs_path": "/home/user/projects/palmux/README.md",
  "is_dir": false,
  "size": 5678,
  "extension": ".md",
  "content": "# Palmux\n\n...",
  "content_type": "text",
  "truncated": false
}

GET    {basePath}api/sessions/{session}/files?path=screenshot.png&raw=true
Response: (バイナリ、Content-Type: image/png)
```

## tmux Manager に追記

```go
func (m *Manager) GetSessionCwd(session string) (string, error)
// tmux display-message -p -t {session} '#{pane_current_path}'
```

## Implementation Phases に追記

### Phase 4: Session File Browser

- [ ] tmux カレントパス取得 API (`GetSessionCwd` + `GET /cwd`)
- [ ] ファイル一覧・読み取り API (`internal/fileserver` パッケージ + パストラバーサル防止)
- [ ] ファイラー UI — ディレクトリブラウズ (パンくずリスト、ターミナル↔ファイラー切り替え)
- [ ] ファイルプレビュー — Markdown (marked)・コード (highlight.js)・画像
- [ ] フロントエンドビルド統合 (marked, highlight.js バンドル)

## Frontend Design に追記: File Browser

### ファイラーパネル

```
┌──────────────────────────┐
│ ☰  main:0  [Terminal][📁] │  <- タブ切り替え
├──────────────────────────┤
│ palmux / internal / server│  <- パンくずリスト
├──────────────────────────┤
│ 📁 server_test.go   1.2K │
│ 📄 api_files.go     3.4K │
│ 📄 api_sessions.go  2.1K │
│ 📄 auth.go          1.8K │
│ 📄 server.go        4.5K │
│ 📄 ws.go            3.2K │
└──────────────────────────┘
```

### ファイルプレビュー

```
┌──────────────────────────┐
│ ← README.md        5.6K  │
├──────────────────────────┤
│                          │
│  # Palmux               │
│                          │
│  Palmux は、スマホから    │
│  快適に tmux を操作できる │
│  Web ベースのターミナル   │
│  クライアント。           │
│                          │
│  ## Features             │
│  - セッション管理         │
│  - 修飾キーツールバー     │
│                          │
└──────────────────────────┘
```

## Directory Structure に追記

```
palmux/
├── internal/
│   ├── fileserver/
│   │   ├── fileserver.go       # ファイル一覧・読み取り・パス検証
│   │   └── fileserver_test.go
│   ├── server/
│   │   ├── api_files.go        # cwd / files エンドポイント
│   │   ├── api_files_test.go
│   │   ...
│   └── tmux/
│       ...
├── frontend/
│   ├── js/
│   │   ├── filebrowser.js      # ディレクトリブラウズ UI
│   │   ├── file-preview.js     # Markdown / コード / 画像プレビュー
│   │   ...
│   ├── css/
│   │   ├── filebrowser.css     # ファイラー用スタイル
│   │   ...
│   ...
```
