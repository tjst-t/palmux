package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleGetCwd(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		cwd        string
		cwdErr     error
		wantStatus int
		wantPath   string
	}{
		{
			name:       "正常系: カレントパスを返す",
			session:    "main",
			cwd:        "/home/user/projects/palmux",
			wantStatus: http.StatusOK,
			wantPath:   "/home/user/projects/palmux",
		},
		{
			name:       "正常系: ルートパスを返す",
			session:    "root",
			cwd:        "/",
			wantStatus: http.StatusOK,
			wantPath:   "/",
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: tmuxエラー → 500",
			session:    "main",
			cwdErr:     errors.New("tmux connection failed"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				cwd:    tt.cwd,
				cwdErr: tt.cwdErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/cwd", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result["path"] != tt.wantPath {
					t.Errorf("path = %q, want %q", result["path"], tt.wantPath)
				}

				if mock.calledGetCwd != tt.session {
					t.Errorf("GetSessionCwd called with %q, want %q", mock.calledGetCwd, tt.session)
				}
			}

			if tt.wantStatus == http.StatusNotFound {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
				var errResp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
					t.Fatalf("failed to decode error response: %v", err)
				}
				if errResp["error"] == "" {
					t.Error("error response should contain 'error' field")
				}
			}

			if tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
				var errResp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
					t.Fatalf("failed to decode error response: %v", err)
				}
				if errResp["error"] == "" {
					t.Error("error response should contain 'error' field")
				}
			}
		})
	}
}

func TestHandleGetCwd_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		cwd: "/home/user/projects",
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/sessions/main/cwd", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if mock.calledGetCwd != "main" {
		t.Errorf("GetSessionCwd called with %q, want %q", mock.calledGetCwd, "main")
	}
}

func TestHandleGetCwd_Authentication(t *testing.T) {
	mock := &configurableMock{
		cwd: "/home/user",
	}
	srv, _ := newTestServer(mock)

	// トークンなしでアクセス → 401
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/cwd", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// 不正なトークンでアクセス → 401
	rec = doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/cwd", "wrong-token", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
