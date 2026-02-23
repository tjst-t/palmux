package server

import (
	"encoding/json"
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

// handleCloneGhqRepo は POST /api/ghq/repos のハンドラ。
// ghq get でリポジトリをクローンし、クローンされたリポジトリ情報を返す。
func (s *Server) handleCloneGhqRepo() http.Handler {
	type request struct {
		URL string `json:"url"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		if req.URL == "" {
			writeError(w, http.StatusBadRequest, "url is required")
			return
		}

		repo, err := s.tmux.CloneGhqRepo(req.URL)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, repo)
	})
}

// handleDeleteGhqRepo は DELETE /api/ghq/repos のハンドラ。
// クエリパラメータ path で指定されたリポジトリを削除する。
func (s *Server) handleDeleteGhqRepo() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		if path == "" {
			writeError(w, http.StatusBadRequest, "path query parameter is required")
			return
		}

		if err := s.tmux.DeleteGhqRepo(path); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}
