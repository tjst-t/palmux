package server

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// handlePostNotification は POST /api/notifications のハンドラ。
func (s *Server) handlePostNotification() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Session     string `json:"session"`
			WindowIndex int    `json:"window_index"`
			Type        string `json:"type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if req.Session == "" {
			writeError(w, http.StatusBadRequest, "session is required")
			return
		}
		if req.Type == "" {
			writeError(w, http.StatusBadRequest, "type is required")
			return
		}
		s.notifications.Set(req.Session, req.WindowIndex, req.Type)
		w.WriteHeader(http.StatusCreated)
	})
}

// handleDeleteNotification は DELETE /api/notifications のハンドラ。
func (s *Server) handleDeleteNotification() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.URL.Query().Get("session")
		if session == "" {
			writeError(w, http.StatusBadRequest, "session query parameter is required")
			return
		}
		windowStr := r.URL.Query().Get("window")
		if windowStr == "" {
			writeError(w, http.StatusBadRequest, "window query parameter is required")
			return
		}
		windowIndex, err := strconv.Atoi(windowStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "window must be a number")
			return
		}
		s.notifications.Clear(session, windowIndex)
		w.WriteHeader(http.StatusNoContent)
	})
}

// handleGetNotifications は GET /api/notifications のハンドラ。
func (s *Server) handleGetNotifications() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		notifications := s.notifications.List()
		if notifications == nil {
			notifications = []Notification{}
		}
		writeJSON(w, http.StatusOK, notifications)
	})
}
