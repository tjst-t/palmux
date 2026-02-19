package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/tjst-t/palmux/internal/git"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGitStatus は GET /api/sessions/{session}/git/status のハンドラ。
// セッションの CWD における git status を返す。
func (s *Server) handleGitStatus() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		result, err := g.Status(cwd)
		if err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, result)
	})
}

// handleGitLog は GET /api/sessions/{session}/git/log のハンドラ。
// セッションの CWD における git log を返す。
// クエリパラメータ: branch (ブランチ名), limit (件数、デフォルト50)
func (s *Server) handleGitLog() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		branch := r.URL.Query().Get("branch")
		limit := 50
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
				limit = parsed
			}
		}

		g := &git.Git{Cmd: s.gitCmd}
		entries, err := g.Log(cwd, branch, limit)
		if err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, entries)
	})
}

// handleGitDiff は GET /api/sessions/{session}/git/diff のハンドラ。
// セッションの CWD における差分を返す。
// クエリパラメータ: path (ファイルパス), commit (コミットハッシュ)
func (s *Server) handleGitDiff() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		path := r.URL.Query().Get("path")
		commit := r.URL.Query().Get("commit")

		g := &git.Git{Cmd: s.gitCmd}
		diff, err := g.Diff(cwd, commit, path)
		if err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"diff": diff})
	})
}

// handleGitShow は GET /api/sessions/{session}/git/show のハンドラ。
// 指定コミットで変更されたファイル一覧を返す。
// クエリパラメータ: commit (コミットハッシュ、必須)
func (s *Server) handleGitShow() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		commit := r.URL.Query().Get("commit")
		if commit == "" {
			writeError(w, http.StatusBadRequest, "commit parameter is required")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		files, err := g.CommitFiles(cwd, commit)
		if err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, files)
	})
}

// handleGitBranches は GET /api/sessions/{session}/git/branches のハンドラ。
// セッションの CWD におけるブランチ一覧を返す。
func (s *Server) handleGitBranches() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		branches, err := g.Branches(cwd)
		if err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, branches)
	})
}

// writeGitError は git 操作のエラーを適切な HTTP ステータスコードで返す。
func writeGitError(w http.ResponseWriter, err error) {
	if errors.Is(err, git.ErrNotGitRepo) {
		writeError(w, http.StatusBadRequest, "not a git repository")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}
