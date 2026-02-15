package server

import (
	"errors"
	"net/http"

	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetCwd は GET /api/sessions/{session}/cwd のハンドラ。
// セッションのアクティブ pane のカレントパスを返す。
func (s *Server) handleGetCwd() http.Handler {
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

		writeJSON(w, http.StatusOK, map[string]string{"path": cwd})
	})
}
