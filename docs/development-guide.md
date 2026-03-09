# 開発ガイド（詳細）

## 開発ワークフロー: subagent-driven-development

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

各フェーズの実装タスクは `docs/tasks/` 配下に配置する。Phase 1〜4 は全タスク実装済み。

## ディレクトリ構成

```
palmux/
├── CLAUDE.md / DESIGN.md / README.md
├── docs/                    # ドキュメント・タスク定義
├── main.go / go.mod / embed.go
├── internal/
│   ├── fileserver/          # ファイル一覧・読み取り・パス検証
│   ├── server/              # HTTP サーバー、API ハンドラ、WebSocket
│   │   ├── server.go        # Server 構造体、ルーティング、TmuxManager インターフェース
│   │   ├── auth.go          # Bearer token 認証ミドルウェア
│   │   ├── api_sessions.go  # セッション API ハンドラ
│   │   ├── api_window.go    # ウィンドウ API（※ _windows は Go ビルド制約と衝突）
│   │   ├── api_files.go     # cwd / files エンドポイント
│   │   └── ws.go            # WebSocket pty ブリッジ
│   └── tmux/                # tmux Manager、Executor、パーサー
├── frontend/
│   ├── index.html / css/ / js/  # 旧 Vanilla JS（段階的移行中）
│   ├── src/lib/             # Svelte コンポーネント + Adapter
│   ├── src/stores/          # Svelte stores
│   ├── manifest.json / sw.js / icons/
│   └── build/               # Vite 出力 (gitignore)
└── Makefile
```

## テスト詳細

### テスト方針

| パッケージ | 方針 |
|---|---|
| `internal/tmux` | `Executor` インターフェースのモック実装を注入。`testdata/` にフィクスチャ |
| `internal/server` | `httptest` でAPIテスト。tmux Manager もモック注入 |
| `internal/fileserver` | `t.TempDir()` でテスト用ディレクトリ構造を作成。パストラバーサル検証 |
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

## Router（ブラウザ履歴/ナビゲーション）詳細

**すべてのナビゲーションは `router.js` の `Router` クラス経由で行う。`history.pushState` / `replaceState` を直接呼んではならない。**

- `router.push(state)` — 新しい履歴エントリを追加
- `router.replace(state)` — 現在の履歴エントリを置換
- `router.navigateFromHash(hash)` — URL ハッシュから初期画面を復元
- `router.suppressDuring(fn)` — popstate 復元中の再 push を防止

**RouteState**: `{ view, session, window, filePath, previewFile, gitState, split, rightPanel }`
- URL ハッシュには `view`, `session`, `window`, `filePath`, `split`, `rightPanel` のみ反映
- `previewFile`, `gitState` は `history.state` にのみ保存

**サブコンポーネントのナビゲーション**:
- FileBrowser / GitBrowser の遷移は Panel → PanelManager → app.js のコールバックチェーン経由で `router.push()` を呼ぶ
- popstate 復元時は `{ push: false }` で show 関数を呼び、`suppressDuring` で二重 push を防止
- `navigateTo()` は呼び出し前にプレビューを閉じる
- 新しいビュータブ追加時は Router のハンドラに対応するハンドラを追加すること
