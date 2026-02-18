package server

import (
	"net/http"

	"github.com/tjst-t/palmux/internal/tmux"
)

// handleListGhqRepos は GET /api/ghq/repos のハンドラ。
// ghq リポジトリ一覧を JSON 配列で返す。
func (s *Server) handleListGhqRepos() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		repos, err := s.tmux.ListGhqRepos()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if repos == nil {
			repos = []tmux.GhqRepo{}
		}
		writeJSON(w, http.StatusOK, repos)
	})
}
