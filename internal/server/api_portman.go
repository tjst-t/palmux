package server

import (
	"errors"
	"net/http"

	"github.com/tjst-t/palmux/internal/portman"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetPortmanURLs は GET /api/sessions/{session}/portman-urls のハンドラ。
// セッションのプロジェクトディレクトリで portman list -c --json を実行し、リース一覧を返す。
// portman エラー時（未インストール等）は空配列を返す。
func (s *Server) handleGetPortmanURLs() http.Handler {
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

		leases, err := s.portman.ListCurrentDir(cwd)
		if err != nil {
			// portman エラー（未インストール等）は空配列を返す
			writeJSON(w, http.StatusOK, []portman.Lease{})
			return
		}

		if leases == nil {
			leases = []portman.Lease{}
		}

		writeJSON(w, http.StatusOK, leases)
	})
}
