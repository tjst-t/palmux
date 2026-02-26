package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetSessionMode は GET /api/sessions/{session}/mode のハンドラ。
// セッションが Claude Code モード（ghq セッション）かどうかを返す。
// ghq セッションの場合、claude ウィンドウの存在を保証して index を返す。
func (s *Server) handleGetSessionMode() http.Handler {
	type sessionModeResponse struct {
		ClaudeCode   bool `json:"claude_code"`
		ClaudeWindow int  `json:"claude_window"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		if !s.tmux.IsGhqSession(session) {
			writeJSON(w, http.StatusOK, sessionModeResponse{
				ClaudeCode:   false,
				ClaudeWindow: -1,
			})
			return
		}

		win, err := s.tmux.EnsureClaudeWindow(session, s.claudePath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, sessionModeResponse{
			ClaudeCode:   true,
			ClaudeWindow: win.Index,
		})
	})
}

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
// リクエストボディの JSON から name と command を読み取り（省略可）、新しいウィンドウを作成する。
func (s *Server) handleCreateWindow() http.Handler {
	type createWindowRequest struct {
		Name    string `json:"name"`
		Command string `json:"command"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		var req createWindowRequest

		// ボディがある場合のみデコードする（name, command は省略可）
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
				return
			}
		}

		// Claude Code モード: shell のみ許可（コマンド付きウィンドウ不可）
		if s.tmux.IsGhqSession(session) && req.Command != "" {
			writeError(w, http.StatusForbidden, "only shell windows can be created in Claude Code mode")
			return
		}

		window, err := s.tmux.NewWindow(session, req.Name, req.Command)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, window)
	})
}

// handleRenameWindow は PATCH /api/sessions/{session}/windows/{index} のハンドラ。
// リクエストボディの JSON から name を読み取り、ウィンドウをリネームする。
// リネーム成功後、ListWindows で最新のウィンドウ情報を取得して返す。
func (s *Server) handleRenameWindow() http.Handler {
	type renameWindowRequest struct {
		Name string `json:"name"`
	}

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

		var req renameWindowRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}

		if req.Name == "" {
			writeError(w, http.StatusBadRequest, "name must not be empty")
			return
		}

		// Claude Code モード: claude ウィンドウのリネームを禁止
		if s.tmux.IsGhqSession(session) {
			windows, err := s.tmux.ListWindows(session)
			if err == nil {
				for _, win := range windows {
					if win.Index == index && win.Name == "claude" {
						writeError(w, http.StatusForbidden, "cannot rename claude window in Claude Code mode")
						return
					}
				}
			}
		}

		if err := s.tmux.RenameWindow(session, index, req.Name); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// ListWindows で最新状態を取得し、該当ウィンドウを返す
		windows, err := s.tmux.ListWindows(session)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		for _, win := range windows {
			if win.Index == index {
				writeJSON(w, http.StatusOK, win)
				return
			}
		}

		// ウィンドウが見つからない場合（通常は起こらない）
		writeJSON(w, http.StatusOK, tmux.Window{Index: index, Name: req.Name, Active: false})
	})
}

// handleRestartClaudeWindow は POST /api/sessions/{session}/claude/restart のハンドラ。
// claude ウィンドウを kill して指定コマンドで再作成する。
// ghq セッションのみ許可。
func (s *Server) handleRestartClaudeWindow() http.Handler {
	type restartRequest struct {
		Command string `json:"command"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		if !s.tmux.IsGhqSession(session) {
			writeError(w, http.StatusForbidden, "claude restart is only available for ghq sessions")
			return
		}

		var req restartRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}

		if req.Command == "" {
			writeError(w, http.StatusBadRequest, "command is required")
			return
		}

		win, err := s.tmux.ReplaceClaudeWindow(session, "claude", req.Command)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, win)
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

		// Claude Code モード: claude ウィンドウの削除を禁止
		if s.tmux.IsGhqSession(session) {
			windows, err := s.tmux.ListWindows(session)
			if err == nil {
				for _, win := range windows {
					if win.Index == index && win.Name == "claude" {
						writeError(w, http.StatusForbidden, "cannot delete claude window in Claude Code mode")
						return
					}
				}
			}
		}

		if err := s.tmux.KillWindow(session, index); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}
