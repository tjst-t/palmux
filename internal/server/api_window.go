package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/tjst-t/palmux/internal/tmux"
)

// handleListWindows は GET /api/sessions/{session}/windows のハンドラ。
// 指定セッションのウィンドウ一覧を JSON 配列で返す。
func (s *Server) handleListWindows() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		windows, err := s.tmux.ListWindows(session)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// nil の場合は空配列を返す
		if windows == nil {
			windows = []tmux.Window{}
		}

		writeJSON(w, http.StatusOK, windows)
	})
}

// handleCreateWindow は POST /api/sessions/{session}/windows のハンドラ。
// リクエストボディの JSON から name を読み取り（省略可）、新しいウィンドウを作成する。
func (s *Server) handleCreateWindow() http.Handler {
	type createWindowRequest struct {
		Name string `json:"name"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		var req createWindowRequest

		// ボディがある場合のみデコードする（name は省略可）
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}
		}

		window, err := s.tmux.NewWindow(session, req.Name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, window)
	})
}

// handleDeleteWindow は DELETE /api/sessions/{session}/windows/{index} のハンドラ。
// パスパラメータの session と index で指定されたウィンドウを削除し、204 No Content を返す。
func (s *Server) handleDeleteWindow() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")
		indexStr := r.PathValue("index")

		index, err := strconv.Atoi(indexStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid window index: "+indexStr)
			return
		}

		if index < 0 {
			writeError(w, http.StatusBadRequest, "window index must be non-negative")
			return
		}

		if err := s.tmux.KillWindow(session, index); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}
