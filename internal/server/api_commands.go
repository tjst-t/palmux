package server

import (
	"errors"
	"net/http"

	"github.com/tjst-t/palmux/internal/cmddetect"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetCommands は GET /api/sessions/{session}/commands のハンドラ。
// セッションのプロジェクトディレクトリからコマンドを検出して返す。
func (s *Server) handleGetCommands() http.Handler {
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

		commands, err := cmddetect.Detect(cwd)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if commands == nil {
			commands = []cmddetect.Command{}
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"commands": commands,
		})
	})
}
