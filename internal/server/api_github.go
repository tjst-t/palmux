package server

import (
	"errors"
	"net/http"

	"github.com/tjst-t/palmux/internal/git"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetGitHubURL は GET /api/sessions/{session}/github-url のハンドラ。
// セッションのプロジェクトディレクトリで git remote get-url origin を実行し、
// GitHub URL を返す。GitHub 以外の場合は空文字を返す。
func (s *Server) handleGetGitHubURL() http.Handler {
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
		remoteURL, err := g.RemoteURL(cwd)
		if err != nil {
			// git エラー（リポジトリでない、リモートなし等）は空URLを返す
			writeJSON(w, http.StatusOK, map[string]string{"url": ""})
			return
		}

		githubURL := git.ParseGitHubURL(remoteURL)
		writeJSON(w, http.StatusOK, map[string]string{"url": githubURL})
	})
}
