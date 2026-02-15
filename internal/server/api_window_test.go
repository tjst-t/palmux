package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/tmux"
)

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
