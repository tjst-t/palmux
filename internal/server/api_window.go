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
