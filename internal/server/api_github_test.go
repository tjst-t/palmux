package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/git"
	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleGetGitHubURL(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
		wantURL    string
	}{
		{
			name:       "正常系: SSH形式のGitHub URL",
			session:    "main",
			cwd:        "/home/user/projects/app",
			gitOutput:  "git@github.com:owner/repo.git\n",
			wantStatus: http.StatusOK,
			wantURL:    "https://github.com/owner/repo",
		},
		{
			name:       "正常系: HTTPS形式のGitHub URL",
			session:    "main",
			cwd:        "/home/user/projects/app",
			gitOutput:  "https://github.com/owner/repo.git\n",
			wantStatus: http.StatusOK,
			wantURL:    "https://github.com/owner/repo",
		},
		{
			name:       "正常系: GitHub以外 → 空URL",
			session:    "main",
			cwd:        "/home/user/projects/app",
			gitOutput:  "git@gitlab.com:owner/repo.git\n",
			wantStatus: http.StatusOK,
			wantURL:    "",
		},
		{
			name:       "正常系: gitエラー → 空URL",
			session:    "main",
			cwd:        "/home/user/projects/app",
			gitErr:     errors.New("not a git repository"),
			wantStatus: http.StatusOK,
			wantURL:    "",
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
			tmuxMock := &configurableMock{
				cwd:    tt.cwd,
				cwdErr: tt.cwdErr,
			}
			gitMock := &mockGitCommandRunner{
				output: []byte(tt.gitOutput),
				err:    tt.gitErr,
			}
			srv, token := newTestServerWithGit(tmuxMock, gitMock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/github-url", token, "")

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
				if result["url"] != tt.wantURL {
					t.Errorf("url = %q, want %q", result["url"], tt.wantURL)
				}
			}
		})
	}
}

// mockGitCommandRunner が未定義の場合に備えて、api_git_test.go で定義済みか確認。
// api_git_test.go で定義されているため、ここでは再定義不要。
// newTestServerWithGit も api_git_test.go で定義済み。

// git.CommandRunner のインポートを使用するためのコンパイルチェック。
var _ git.CommandRunner = (*mockGitCommandRunner)(nil)
