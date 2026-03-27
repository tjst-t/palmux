package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/portman"
	"github.com/tjst-t/palmux/internal/tmux"
)

// mockPortmanRunner は portman.Runner のテスト用モック。
type mockPortmanRunner struct {
	leases []portman.Lease
	err    error
}

func (m *mockPortmanRunner) ListCurrentDir(dir string) ([]portman.Lease, error) {
	return m.leases, m.err
}

func TestHandleGetPortmanURLs(t *testing.T) {
	tests := []struct {
		name        string
		session     string
		cwd         string
		cwdErr      error
		leases      []portman.Lease
		portmanErr  error
		wantStatus  int
		wantCount   int
		wantFirstURL string
	}{
		{
			name:    "正常系: exposeされた1件のリースを返す",
			session: "main",
			cwd:     "/home/user/projects/app",
			leases: []portman.Lease{
				{Name: "app", URL: "https://app.example.com", Status: "listening", Expose: true},
			},
			wantStatus:   http.StatusOK,
			wantCount:    1,
			wantFirstURL: "https://app.example.com",
		},
		{
			name:    "正常系: expose=falseのリースは除外される",
			session: "main",
			cwd:     "/home/user/projects/app",
			leases: []portman.Lease{
				{Name: "web", URL: "https://web.example.com", Expose: true},
				{Name: "internal", URL: "https://internal.example.com", Expose: false},
				{Name: "api", URL: "https://api.example.com", Expose: true},
			},
			wantStatus:   http.StatusOK,
			wantCount:    2,
			wantFirstURL: "https://web.example.com",
		},
		{
			name:       "正常系: リースなし → 空配列",
			session:    "main",
			cwd:        "/home/user/projects/app",
			leases:     []portman.Lease{},
			wantStatus: http.StatusOK,
			wantCount:  0,
		},
		{
			name:    "正常系: 全てexpose=false → 空配列",
			session: "main",
			cwd:     "/home/user/projects/app",
			leases: []portman.Lease{
				{Name: "internal", URL: "https://internal.example.com", Expose: false},
			},
			wantStatus: http.StatusOK,
			wantCount:  0,
		},
		{
			name:       "正常系: portmanエラー → 空配列で200",
			session:    "main",
			cwd:        "/home/user/projects/app",
			portmanErr: errors.New("portman not found"),
			wantStatus: http.StatusOK,
			wantCount:  0,
		},
		{
			name:       "異常系: セッション不明 → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				cwd:    tt.cwd,
				cwdErr: tt.cwdErr,
			}
			portmanMock := &mockPortmanRunner{
				leases: tt.leases,
				err:    tt.portmanErr,
			}
			srv, token := newTestServerWithPortman(mock, portmanMock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/portman-urls", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result []portman.Lease
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(result) != tt.wantCount {
					t.Errorf("got %d leases, want %d", len(result), tt.wantCount)
				}
				if tt.wantFirstURL != "" && len(result) > 0 {
					if result[0].URL != tt.wantFirstURL {
						t.Errorf("first URL = %q, want %q", result[0].URL, tt.wantFirstURL)
					}
				}
			}
		})
	}
}

func newTestServerWithPortman(mock TmuxManager, portmanRunner portman.Runner) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:    mock,
		Token:   token,
		BasePath: "/",
		Portman: portmanRunner,
	})
	return srv, token
}
