package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleGetSessionMode(t *testing.T) {
	t.Run("ghq セッション: claude_code true を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession:       true,
			ensureClaudeWindow: &tmux.Window{Index: 1, Name: "claude", Active: false},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/palmux/mode", token, "")

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		var result struct {
			ClaudeCode   bool `json:"claude_code"`
			ClaudeWindow int  `json:"claude_window"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if !result.ClaudeCode {
			t.Error("claude_code should be true")
		}
		if result.ClaudeWindow != 1 {
			t.Errorf("claude_window = %d, want 1", result.ClaudeWindow)
		}
	})

	t.Run("非 ghq セッション: claude_code false を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: false,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/local/mode", token, "")

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		var result struct {
			ClaudeCode   bool `json:"claude_code"`
			ClaudeWindow int  `json:"claude_window"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if result.ClaudeCode {
			t.Error("claude_code should be false")
		}
		if result.ClaudeWindow != -1 {
			t.Errorf("claude_window = %d, want -1", result.ClaudeWindow)
		}
	})

	t.Run("EnsureClaudeWindow エラー: 500 を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession:          true,
			ensureClaudeWindowErr: errors.New("failed to create window"),
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/palmux/mode", token, "")

		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
		}
	})
}

func TestHandleListWindows(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		windows    []tmux.Window
		windowsErr error
		wantStatus int
	}{
		{
			name:    "ウィンドウ一覧を返す",
			session: "main",
			windows: []tmux.Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "vim", Active: false},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "ウィンドウが空の場合: 空配列を返す",
			session:    "empty",
			windows:    []tmux.Window{},
			wantStatus: http.StatusOK,
		},
		{
			name:       "ウィンドウが nil の場合: 空配列を返す",
			session:    "nil",
			windows:    nil,
			wantStatus: http.StatusOK,
		},
		{
			name:       "tmux エラー: 500を返す",
			session:    "nonexistent",
			windowsErr: errors.New("session not found"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				windows:    tt.windows,
				windowsErr: tt.windowsErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/windows", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result []tmux.Window
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				wantLen := len(tt.windows)
				if tt.windows == nil {
					wantLen = 0
				}
				if len(result) != wantLen {
					t.Errorf("result length = %d, want %d", len(result), wantLen)
				}

				if tt.windows != nil && len(tt.windows) > 0 {
					if result[0].Index != tt.windows[0].Index {
						t.Errorf("result[0].Index = %d, want %d", result[0].Index, tt.windows[0].Index)
					}
					if result[0].Name != tt.windows[0].Name {
						t.Errorf("result[0].Name = %q, want %q", result[0].Name, tt.windows[0].Name)
					}
					if result[0].Active != tt.windows[0].Active {
						t.Errorf("result[0].Active = %v, want %v", result[0].Active, tt.windows[0].Active)
					}
				}

				if mock.calledListWindows != tt.session {
					t.Errorf("ListWindows called with %q, want %q", mock.calledListWindows, tt.session)
				}
			}

			if tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
			}
		})
	}
}

func TestHandleCreateWindow(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		body       string
		newWindow  *tmux.Window
		newWinErr  error
		wantStatus int
		wantName   string // NewWindow に渡される name
		wantCmd    string // NewWindow に渡される command
	}{
		{
			name:       "名前付きウィンドウを作成する",
			session:    "main",
			body:       `{"name": "new-window"}`,
			newWindow:  &tmux.Window{Index: 2, Name: "new-window", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "new-window",
		},
		{
			name:       "名前なしウィンドウを作成する（空ボディ）",
			session:    "main",
			body:       "",
			newWindow:  &tmux.Window{Index: 2, Name: "bash", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
		},
		{
			name:       "名前なしウィンドウを作成する（空名前）",
			session:    "main",
			body:       `{"name": ""}`,
			newWindow:  &tmux.Window{Index: 2, Name: "bash", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
		},
		{
			name:       "名前なしウィンドウを作成する（空JSON）",
			session:    "main",
			body:       `{}`,
			newWindow:  &tmux.Window{Index: 2, Name: "bash", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
		},
		{
			name:       "コマンド付きウィンドウを作成する（claude）",
			session:    "main",
			body:       `{"command": "claude"}`,
			newWindow:  &tmux.Window{Index: 3, Name: "claude", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
			wantCmd:    "claude",
		},
		{
			name:       "コマンド付きウィンドウを作成する（claude --continue）",
			session:    "main",
			body:       `{"command": "claude --continue"}`,
			newWindow:  &tmux.Window{Index: 4, Name: "claude", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
			wantCmd:    "claude --continue",
		},
		{
			name:       "コマンド付きウィンドウを作成する（claude --model opus）",
			session:    "main",
			body:       `{"command": "claude --model opus"}`,
			newWindow:  &tmux.Window{Index: 5, Name: "claude", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
			wantCmd:    "claude --model opus",
		},
		{
			name:       "コマンド付きウィンドウを作成する（claude --continue --model sonnet）",
			session:    "main",
			body:       `{"command": "claude --continue --model sonnet"}`,
			newWindow:  &tmux.Window{Index: 6, Name: "claude", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "",
			wantCmd:    "claude --continue --model sonnet",
		},
		{
			name:       "名前とコマンドの両方を指定",
			session:    "main",
			body:       `{"name": "ai", "command": "claude --model haiku"}`,
			newWindow:  &tmux.Window{Index: 7, Name: "ai", Active: true},
			wantStatus: http.StatusCreated,
			wantName:   "ai",
			wantCmd:    "claude --model haiku",
		},
		{
			name:       "不正JSON: 400を返す",
			session:    "main",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "tmux エラー: 500を返す",
			session:    "main",
			body:       `{"name": "test"}`,
			newWinErr:  errors.New("session not found"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				newWindow: tt.newWindow,
				newWinErr: tt.newWinErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/"+tt.session+"/windows", token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusCreated {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result tmux.Window
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result.Index != tt.newWindow.Index {
					t.Errorf("result.Index = %d, want %d", result.Index, tt.newWindow.Index)
				}

				if mock.calledNewWindow.session != tt.session {
					t.Errorf("NewWindow session = %q, want %q", mock.calledNewWindow.session, tt.session)
				}
				if mock.calledNewWindow.name != tt.wantName {
					t.Errorf("NewWindow name = %q, want %q", mock.calledNewWindow.name, tt.wantName)
				}
				if mock.calledNewWindow.command != tt.wantCmd {
					t.Errorf("NewWindow command = %q, want %q", mock.calledNewWindow.command, tt.wantCmd)
				}
			}
		})
	}
}

func TestHandleDeleteWindow(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		index      string
		killErr    error
		wantStatus int
		wantIndex  int
	}{
		{
			name:       "ウィンドウを削除する: 204を返す",
			session:    "main",
			index:      "1",
			wantStatus: http.StatusNoContent,
			wantIndex:  1,
		},
		{
			name:       "インデックス0を削除する: 204を返す",
			session:    "main",
			index:      "0",
			wantStatus: http.StatusNoContent,
			wantIndex:  0,
		},
		{
			name:       "不正なインデックス: 400を返す",
			session:    "main",
			index:      "abc",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "負のインデックス: 400を返す",
			session:    "main",
			index:      "-1",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "tmux エラー: 500を返す",
			session:    "main",
			index:      "99",
			killErr:    errors.New("window not found"),
			wantStatus: http.StatusInternalServerError,
			wantIndex:  99,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				killWinErr: tt.killErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodDelete, "/api/sessions/"+tt.session+"/windows/"+tt.index, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusNoContent {
				if mock.calledKillWindow.session != tt.session {
					t.Errorf("KillWindow session = %q, want %q", mock.calledKillWindow.session, tt.session)
				}
				if mock.calledKillWindow.index != tt.wantIndex {
					t.Errorf("KillWindow index = %d, want %d", mock.calledKillWindow.index, tt.wantIndex)
				}

				// 204 はボディが空であること
				if rec.Body.Len() != 0 {
					t.Errorf("body should be empty for 204, got %q", rec.Body.String())
				}
			}

			if tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
			}

			if tt.wantStatus == http.StatusBadRequest {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
			}
		})
	}
}

func TestHandleRenameWindow(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		index      string
		body       string
		renameErr  error
		windows    []tmux.Window
		windowsErr error
		wantStatus int
		wantName   string
		wantIndex  int
	}{
		{
			name:    "正常系: ウィンドウをリネームする",
			session: "main",
			index:   "1",
			body:    `{"name": "editor"}`,
			windows: []tmux.Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "editor", Active: false},
			},
			wantStatus: http.StatusOK,
			wantName:   "editor",
			wantIndex:  1,
		},
		{
			name:    "正常系: インデックス0のウィンドウをリネーム",
			session: "dev",
			index:   "0",
			body:    `{"name": "shell"}`,
			windows: []tmux.Window{
				{Index: 0, Name: "shell", Active: true},
			},
			wantStatus: http.StatusOK,
			wantName:   "shell",
			wantIndex:  0,
		},
		{
			name:       "異常系: 名前が空: 400を返す",
			session:    "main",
			index:      "1",
			body:       `{"name": ""}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: nameフィールドなし: 400を返す",
			session:    "main",
			index:      "1",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: 不正JSON: 400を返す",
			session:    "main",
			index:      "1",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: 不正なインデックス: 400を返す",
			session:    "main",
			index:      "abc",
			body:       `{"name": "test"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: 負のインデックス: 400を返す",
			session:    "main",
			index:      "-1",
			body:       `{"name": "test"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: tmux RenameWindow エラー: 500を返す",
			session:    "main",
			index:      "99",
			body:       `{"name": "test"}`,
			renameErr:  errors.New("window not found"),
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "異常系: tmux ListWindows エラー: 500を返す",
			session:    "main",
			index:      "1",
			body:       `{"name": "test"}`,
			windowsErr: errors.New("session not found"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				renameWinErr: tt.renameErr,
				windows:      tt.windows,
				windowsErr:   tt.windowsErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodPatch, "/api/sessions/"+tt.session+"/windows/"+tt.index, token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result tmux.Window
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result.Name != tt.wantName {
					t.Errorf("result.Name = %q, want %q", result.Name, tt.wantName)
				}
				if result.Index != tt.wantIndex {
					t.Errorf("result.Index = %d, want %d", result.Index, tt.wantIndex)
				}

				if mock.calledRenameWindow.session != tt.session {
					t.Errorf("RenameWindow session = %q, want %q", mock.calledRenameWindow.session, tt.session)
				}
				if mock.calledRenameWindow.name != tt.wantName {
					t.Errorf("RenameWindow name = %q, want %q", mock.calledRenameWindow.name, tt.wantName)
				}
			}

			if tt.wantStatus == http.StatusBadRequest || tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
			}
		})
	}
}

func TestHandleRestartClaudeWindow(t *testing.T) {
	t.Run("正常系: ghq セッションで claude ウィンドウを再起動", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession:        true,
			replaceClaudeWindow: &tmux.Window{Index: 2, Name: "claude", Active: true},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/claude/restart", token, `{"command": "claude --model opus"}`)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}

		var result tmux.Window
		if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if result.Index != 2 {
			t.Errorf("result.Index = %d, want 2", result.Index)
		}
		if result.Name != "claude" {
			t.Errorf("result.Name = %q, want %q", result.Name, "claude")
		}

		if mock.calledReplaceClaudeWindow.session != "palmux" {
			t.Errorf("ReplaceClaudeWindow session = %q, want %q", mock.calledReplaceClaudeWindow.session, "palmux")
		}
		if mock.calledReplaceClaudeWindow.name != "claude" {
			t.Errorf("ReplaceClaudeWindow name = %q, want %q", mock.calledReplaceClaudeWindow.name, "claude")
		}
		if mock.calledReplaceClaudeWindow.command != "claude --model opus" {
			t.Errorf("ReplaceClaudeWindow command = %q, want %q", mock.calledReplaceClaudeWindow.command, "claude --model opus")
		}
	})

	t.Run("非 ghq セッション: 403 を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: false,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/local/claude/restart", token, `{"command": "claude --model opus"}`)

		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
		}
	})

	t.Run("command が空: 400 を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/claude/restart", token, `{"command": ""}`)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	})

	t.Run("不正 JSON: 400 を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/claude/restart", token, `{invalid`)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
		}
	})

	t.Run("ReplaceClaudeWindow エラー: 500 を返す", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession:           true,
			replaceClaudeWindowErr: errors.New("replace failed"),
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/claude/restart", token, `{"command": "claude --model opus"}`)

		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
		}
	})
}

func TestHandleDeleteWindow_ClaudeCodeMode(t *testing.T) {
	t.Run("ghq セッションで claude ウィンドウ削除: 403", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
			windows: []tmux.Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "claude", Active: false},
			},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodDelete, "/api/sessions/palmux/windows/1", token, "")

		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
		}
	})

	t.Run("ghq セッションで bash ウィンドウ削除: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
			windows: []tmux.Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "claude", Active: false},
			},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodDelete, "/api/sessions/palmux/windows/0", token, "")

		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
	})

	t.Run("非 ghq セッションでの claude ウィンドウ削除: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: false,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodDelete, "/api/sessions/local/windows/1", token, "")

		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
		}
	})
}

func TestHandleCreateWindow_ClaudeCodeMode(t *testing.T) {
	t.Run("ghq セッションでコマンド付きウィンドウ作成: 403", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/windows", token, `{"command": "vim"}`)

		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
		}
	})

	t.Run("ghq セッションで shell ウィンドウ作成: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
			newWindow:    &tmux.Window{Index: 2, Name: "bash", Active: true},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/palmux/windows", token, `{}`)

		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
		}
	})

	t.Run("非 ghq セッションでコマンド付きウィンドウ作成: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: false,
			newWindow:    &tmux.Window{Index: 2, Name: "vim", Active: true},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions/local/windows", token, `{"command": "vim"}`)

		if rec.Code != http.StatusCreated {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
		}
	})
}

func TestHandleRenameWindow_ClaudeCodeMode(t *testing.T) {
	t.Run("ghq セッションで claude ウィンドウリネーム: 403", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
			windows: []tmux.Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "claude", Active: false},
			},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPatch, "/api/sessions/palmux/windows/1", token, `{"name": "renamed"}`)

		if rec.Code != http.StatusForbidden {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
		}
	})

	t.Run("ghq セッションで bash ウィンドウリネーム: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: true,
			windows: []tmux.Window{
				{Index: 0, Name: "renamed", Active: true},
				{Index: 1, Name: "claude", Active: false},
			},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPatch, "/api/sessions/palmux/windows/0", token, `{"name": "renamed"}`)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
	})

	t.Run("非 ghq セッションでの claude ウィンドウリネーム: 許可", func(t *testing.T) {
		mock := &configurableMock{
			isGhqSession: false,
			windows: []tmux.Window{
				{Index: 1, Name: "renamed", Active: false},
			},
		}
		srv, token := newTestServer(mock)
		rec := doRequest(t, srv.Handler(), http.MethodPatch, "/api/sessions/local/windows/1", token, `{"name": "renamed"}`)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
		}
	})
}

func TestHandleRenameWindow_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		windows: []tmux.Window{
			{Index: 1, Name: "renamed", Active: false},
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodPatch, "/palmux/api/sessions/main/windows/1", token, `{"name": "renamed"}`)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if mock.calledRenameWindow.session != "main" {
		t.Errorf("RenameWindow session = %q, want %q", mock.calledRenameWindow.session, "main")
	}
	if mock.calledRenameWindow.index != 1 {
		t.Errorf("RenameWindow index = %d, want %d", mock.calledRenameWindow.index, 1)
	}
	if mock.calledRenameWindow.name != "renamed" {
		t.Errorf("RenameWindow name = %q, want %q", mock.calledRenameWindow.name, "renamed")
	}
}

func TestHandleListWindows_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		windows: []tmux.Window{
			{Index: 0, Name: "bash", Active: true},
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/sessions/main/windows", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if mock.calledListWindows != "main" {
		t.Errorf("ListWindows called with %q, want %q", mock.calledListWindows, "main")
	}
}

func TestHandleDeleteWindow_WithBasePath(t *testing.T) {
	mock := &configurableMock{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/deep/nested/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodDelete, "/deep/nested/api/sessions/main/windows/2", token, "")

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	if mock.calledKillWindow.session != "main" {
		t.Errorf("KillWindow session = %q, want %q", mock.calledKillWindow.session, "main")
	}
	if mock.calledKillWindow.index != 2 {
		t.Errorf("KillWindow index = %d, want %d", mock.calledKillWindow.index, 2)
	}
}
