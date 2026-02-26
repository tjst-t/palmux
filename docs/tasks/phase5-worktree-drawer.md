# Phase 5: GHQ Project → Branch (Git Worktree) Drawer Restructure

## 概要

ドロワーを「Session → Windows」構成から「GHQ Project → Branch（git worktree）」構成に変更する。

## 完了タスク

### Phase 1: Git Worktree 操作
- `internal/git/git.go` — `Worktree` 型、`ListWorktrees`, `AddWorktree`, `RemoveWorktree` 追加
- `internal/git/parse.go` — `ParseWorktrees` 追加

### Phase 2: GhqResolver の `repo@branch` 対応
- `internal/tmux/ghq.go` — `ParseSessionName`, `ResolveRepo`, `Resolve` 拡張、`GitCmd` フィールド追加
- `main.go` — `GitCmd` 注入
- `internal/tmux/tmux.go` — `WorktreePath`, `ProjectWorktree`, `ListProjectWorktrees`, `NewWorktreeSession`, `DeleteWorktreeSession`, `GetProjectBranches`, `ResolveProject`

### Phase 3: API エンドポイント
- `internal/server/api_project.go` — 4 ハンドラ追加
- `internal/server/server.go` — `TmuxManager` インターフェース拡張、ルート登録

### Phase 4: フロントエンド
- `frontend/js/api.js` — 4 API クライアント関数追加
- `frontend/js/drawer.js` — プロジェクト→ブランチ構成にリファクタ
- `frontend/js/app.js` — コールバック更新

### Phase 5: 統合・仕上げ
- `frontend/css/style.css` — 新規 CSS クラス追加
- `docs/glossary.md` — 用語集更新
- `docs/tasks/phase5-worktree-drawer.md` — タスクファイル作成
