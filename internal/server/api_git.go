package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/tjst-t/palmux/internal/git"
	"github.com/tjst-t/palmux/internal/tmux"
)

// pathsRequest は paths を含む POST リクエストボディ。
type pathsRequest struct {
	Paths []string `json:"paths"`
}

// patchRequest は patch を含む POST リクエストボディ。
type patchRequest struct {
	Patch string `json:"patch"`
}

// handleGitStatus は GET /api/sessions/{session}/git/status のハンドラ。
// セッションの CWD における git status を返す。
func (s *Server) handleGitStatus() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
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

		cwd, err := s.tmux.GetSessionProjectDir(session)
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
// クエリパラメータ: path (ファイルパス), commit (コミットハッシュ), structured (構造化差分)
func (s *Server) handleGitDiff() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
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
		structured := r.URL.Query().Get("structured") == "true"

		g := &git.Git{Cmd: s.gitCmd}
		if structured {
			result, err := g.StructuredDiff(cwd, commit, path)
			if err != nil {
				writeGitError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, result)
			return
		}

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

		cwd, err := s.tmux.GetSessionProjectDir(session)
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

		cwd, err := s.tmux.GetSessionProjectDir(session)
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
	if errors.Is(err, git.ErrInvalidPath) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, git.ErrEmptyPatch) {
		writeError(w, http.StatusBadRequest, "patch must not be empty")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

// handleGitDiscard は POST /api/sessions/{session}/git/discard のハンドラ。
// 指定ファイルの変更を破棄する（git checkout -- <paths>）。
func (s *Server) handleGitDiscard() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req pathsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.DiscardChanges(cwd, req.Paths); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// handleGitDiscardHunk は POST /api/sessions/{session}/git/discard-hunk のハンドラ。
// hunk 単位で変更を破棄する（git apply --reverse）。
func (s *Server) handleGitDiscardHunk() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req patchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.DiscardHunk(cwd, req.Patch); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// handleGitStage は POST /api/sessions/{session}/git/stage のハンドラ。
// 指定ファイルをステージする（git add <paths>）。
func (s *Server) handleGitStage() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req pathsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.Stage(cwd, req.Paths); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// handleGitUnstage は POST /api/sessions/{session}/git/unstage のハンドラ。
// 指定ファイルをアンステージする（git reset HEAD <paths>）。
func (s *Server) handleGitUnstage() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req pathsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.Unstage(cwd, req.Paths); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// handleGitStageHunk は POST /api/sessions/{session}/git/stage-hunk のハンドラ。
// hunk 単位でステージする（git apply --cached）。
func (s *Server) handleGitStageHunk() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req patchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.StageHunk(cwd, req.Patch); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// handleGitUnstageHunk は POST /api/sessions/{session}/git/unstage-hunk のハンドラ。
// hunk 単位でアンステージする（git apply --cached --reverse）。
func (s *Server) handleGitUnstageHunk() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		var req patchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		g := &git.Git{Cmd: s.gitCmd}
		if err := g.UnstageHunk(cwd, req.Patch); err != nil {
			writeGitError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}
