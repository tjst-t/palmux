package server

import (
	"encoding/json"
	"net/http"
)

// handleListProjectWorktrees は GET /api/projects/{project}/worktrees のハンドラ。
// プロジェクトの worktree 一覧とセッション状態を JSON 配列で返す。
func (s *Server) handleListProjectWorktrees() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		project := r.PathValue("project")
		worktrees, err := s.tmux.ListProjectWorktrees(project)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, worktrees)
	})
}

// handleCreateProjectWorktree は POST /api/projects/{project}/worktrees のハンドラ。
// リクエストボディの JSON から branch と create_branch を読み取り、worktree セッションを作成する。
func (s *Server) handleCreateProjectWorktree() http.Handler {
	type request struct {
		Branch       string `json:"branch"`
		CreateBranch bool   `json:"create_branch"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		project := r.PathValue("project")

		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		if req.Branch == "" {
			writeError(w, http.StatusBadRequest, "branch is required")
			return
		}

		session, err := s.tmux.NewWorktreeSession(project, req.Branch, req.CreateBranch)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// ghq セッションなら claude ウィンドウ作成（ベストエフォート）
		sessionName := project + "@" + req.Branch
		if s.tmux.IsGhqSession(sessionName) {
			s.tmux.EnsureClaudeWindow(sessionName, s.claudePath)
		}

		writeJSON(w, http.StatusCreated, session)
	})
}

// handleDeleteProjectWorktree は DELETE /api/projects/{project}/worktrees/{branch...} のハンドラ。
// パスパラメータの project と branch でセッション名を構築し、セッションを削除する。
// クエリパラメータ remove_worktree=true で worktree ディレクトリも削除する。
func (s *Server) handleDeleteProjectWorktree() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		project := r.PathValue("project")
		branch := r.PathValue("branch")

		// クエリパラメータで remove_worktree を受け取る
		removeWorktree := r.URL.Query().Get("remove_worktree") == "true"

		sessionName := project + "@" + branch
		if err := s.tmux.DeleteWorktreeSession(sessionName, removeWorktree); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

// handleListProjectBranches は GET /api/projects/{project}/branches のハンドラ。
// プロジェクトのブランチ一覧を JSON 配列で返す。
func (s *Server) handleListProjectBranches() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		project := r.PathValue("project")
		branches, err := s.tmux.GetProjectBranches(project)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, branches)
	})
}
