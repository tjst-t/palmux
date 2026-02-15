package server

import (
	"encoding/json"
	"net/http"

	"github.com/tjst-t/palmux/internal/tmux"
)

// writeJSON は JSON レスポンスを書き込むヘルパー。
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeError はエラーレスポンスを JSON 形式で書き込むヘルパー。
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// handleListSessions は GET /api/sessions のハンドラ。
// tmux セッション一覧を JSON 配列で返す。
func (s *Server) handleListSessions() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sessions, err := s.tmux.ListSessions()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// nil の場合は空配列を返す
		if sessions == nil {
			sessions = []tmux.Session{}
		}

		writeJSON(w, http.StatusOK, sessions)
	})
}

// handleCreateSession は POST /api/sessions のハンドラ。
// リクエストボディの JSON から name を読み取り、新しいセッションを作成する。
func (s *Server) handleCreateSession() http.Handler {
	type createSessionRequest struct {
		Name string `json:"name"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req createSessionRequest

		if r.Body == nil || r.ContentLength == 0 {
			writeError(w, http.StatusBadRequest, "request body is required")
			return
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}

		if req.Name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}

		session, err := s.tmux.NewSession(req.Name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, session)
	})
}

// handleDeleteSession は DELETE /api/sessions/{name} のハンドラ。
// パスパラメータの name で指定されたセッションを削除し、204 No Content を返す。
func (s *Server) handleDeleteSession() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")

		if err := s.tmux.KillSession(name); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}
