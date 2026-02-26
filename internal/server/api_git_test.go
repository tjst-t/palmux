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

// mockGitCommandRunner はテスト用の git CommandRunner モック。
type mockGitCommandRunner struct {
	output []byte
	err    error

	calledDir  string
	calledArgs []string
}

func (m *mockGitCommandRunner) RunInDir(dir string, args ...string) ([]byte, error) {
	m.calledDir = dir
	m.calledArgs = args
	return m.output, m.err
}

// newTestServerWithGit はテスト用 Server を git モック付きで作成するヘルパー。
func newTestServerWithGit(tmuxMock TmuxManager, gitMock git.CommandRunner) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     tmuxMock,
		GitCmd:   gitMock,
		Token:    token,
		BasePath: "/",
	})
	return srv, token
}

func TestHandleGitStatus(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
	}{
		{
			name:       "正常系: ステータスを返す",
			session:    "main",
			cwd:        "/home/user/project",
			gitOutput:  "## main...origin/main\n M file.go\n",
			wantStatus: http.StatusOK,
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: git リポジトリでない → 400",
			session:    "main",
			cwd:        "/home/user/no-git",
			gitErr:     git.ErrNotGitRepo,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: git コマンドエラー → 500",
			session:    "main",
			cwd:        "/home/user/project",
			gitErr:     errors.New("git command failed"),
			wantStatus: http.StatusInternalServerError,
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
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/git/status", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result git.StatusResult
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if result.Branch != "main" {
					t.Errorf("Branch = %q, want %q", result.Branch, "main")
				}
			}

			if tt.wantStatus >= 400 {
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

func TestHandleGitLog(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		query      string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
		wantCount  int
	}{
		{
			name:       "正常系: ログを返す",
			session:    "main",
			cwd:        "/home/user/project",
			gitOutput:  "abc1234\tJohn\t2025-01-15T10:00:00+09:00\tFix bug\ndef5678\tJane\t2025-01-14T10:00:00+09:00\tAdd feature\n",
			wantStatus: http.StatusOK,
			wantCount:  2,
		},
		{
			name:       "正常系: ブランチとlimit指定",
			session:    "main",
			query:      "?branch=develop&limit=10",
			cwd:        "/home/user/project",
			gitOutput:  "abc1234\tJohn\t2025-01-15T10:00:00+09:00\tFix bug\n",
			wantStatus: http.StatusOK,
			wantCount:  1,
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: git リポジトリでない → 400",
			session:    "main",
			cwd:        "/home/user/no-git",
			gitErr:     git.ErrNotGitRepo,
			wantStatus: http.StatusBadRequest,
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
			path := "/api/sessions/" + tt.session + "/git/log" + tt.query
			rec := doRequest(t, srv.Handler(), http.MethodGet, path, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result []git.LogEntry
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(result) != tt.wantCount {
					t.Errorf("len(result) = %d, want %d", len(result), tt.wantCount)
				}
			}
		})
	}
}

func TestHandleGitDiff(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		query      string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
	}{
		{
			name:       "正常系: ワーキングツリーの差分",
			session:    "main",
			cwd:        "/home/user/project",
			gitOutput:  "+new line\n-old line\n",
			wantStatus: http.StatusOK,
		},
		{
			name:       "正常系: コミット指定の差分",
			session:    "main",
			query:      "?commit=abc1234",
			cwd:        "/home/user/project",
			gitOutput:  "+added\n",
			wantStatus: http.StatusOK,
		},
		{
			name:       "正常系: パスとコミット指定",
			session:    "main",
			query:      "?commit=abc1234&path=file.go",
			cwd:        "/home/user/project",
			gitOutput:  "+line\n",
			wantStatus: http.StatusOK,
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: git リポジトリでない → 400",
			session:    "main",
			cwd:        "/home/user/no-git",
			gitErr:     git.ErrNotGitRepo,
			wantStatus: http.StatusBadRequest,
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
			path := "/api/sessions/" + tt.session + "/git/diff" + tt.query
			rec := doRequest(t, srv.Handler(), http.MethodGet, path, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if _, ok := result["diff"]; !ok {
					t.Error("response should contain 'diff' field")
				}
			}
		})
	}
}

func TestHandleGitShow(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		query      string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
		wantCount  int
	}{
		{
			name:       "正常系: コミットのファイル一覧",
			session:    "main",
			query:      "?commit=abc1234",
			cwd:        "/home/user/project",
			gitOutput:  "M\tfile.go\nA\tnew.go\n",
			wantStatus: http.StatusOK,
			wantCount:  2,
		},
		{
			name:       "異常系: commit パラメータ未指定 → 400",
			session:    "main",
			cwd:        "/home/user/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: git リポジトリでない → 400",
			session:    "main",
			query:      "?commit=abc1234",
			cwd:        "/home/user/no-git",
			gitErr:     git.ErrNotGitRepo,
			wantStatus: http.StatusBadRequest,
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
			path := "/api/sessions/" + tt.session + "/git/show" + tt.query
			rec := doRequest(t, srv.Handler(), http.MethodGet, path, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result []git.StatusFile
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(result) != tt.wantCount {
					t.Errorf("len(result) = %d, want %d", len(result), tt.wantCount)
				}
			}
		})
	}
}

func TestHandleGitBranches(t *testing.T) {
	tests := []struct {
		name       string
		session    string
		cwd        string
		cwdErr     error
		gitOutput  string
		gitErr     error
		wantStatus int
		wantCount  int
	}{
		{
			name:       "正常系: ブランチ一覧を返す",
			session:    "main",
			cwd:        "/home/user/project",
			gitOutput:  "* main\n  develop\n  remotes/origin/feature-y\n",
			wantStatus: http.StatusOK,
			wantCount:  3,
		},
		{
			name:       "異常系: セッションが存在しない → 404",
			session:    "nonexistent",
			cwdErr:     fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "異常系: git リポジトリでない → 400",
			session:    "main",
			cwd:        "/home/user/no-git",
			gitErr:     git.ErrNotGitRepo,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "異常系: git コマンドエラー → 500",
			session:    "main",
			cwd:        "/home/user/project",
			gitErr:     errors.New("git command failed"),
			wantStatus: http.StatusInternalServerError,
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
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/git/branches", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result []git.Branch
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if len(result) != tt.wantCount {
					t.Errorf("len(result) = %d, want %d", len(result), tt.wantCount)
				}
			}
		})
	}
}

func TestHandleGitStatus_WithBasePath(t *testing.T) {
	tmuxMock := &configurableMock{cwd: "/home/user/project"}
	gitMock := &mockGitCommandRunner{output: []byte("## main\n")}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     tmuxMock,
		GitCmd:   gitMock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/sessions/main/git/status", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if tmuxMock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", tmuxMock.calledGetProjectDir, "main")
	}
}

func TestHandleGitStatus_Authentication(t *testing.T) {
	tmuxMock := &configurableMock{cwd: "/home/user/project"}
	gitMock := &mockGitCommandRunner{output: []byte("## main\n")}
	srv, _ := newTestServerWithGit(tmuxMock, gitMock)

	// トークンなしでアクセス → 401
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/git/status", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// 不正なトークンでアクセス → 401
	rec = doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/git/status", "wrong-token", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
