package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tjst-t/palmux/internal/tmux"
)

// configurableMock は設定可能な TmuxManager モック。
// 各メソッドの戻り値をフィールドで指定できる。
type configurableMock struct {
	sessions    []tmux.Session
	sessionsErr error
	newSession  *tmux.Session
	newSessErr  error
	killSessErr error
	windows     []tmux.Window
	windowsErr  error
	newWindow   *tmux.Window
	newWinErr   error
	killWinErr   error
	renameWinErr error
	cwd          string
	cwdErr       error
	projectDir    string
	projectDirErr error

	// 呼び出し記録
	calledListSessions bool
	calledNewSession   string
	calledKillSession  string
	calledListWindows  string
	calledNewWindow    struct{ session, name, command string }
	calledKillWindow   struct {
		session string
		index   int
	}
	calledRenameWindow struct {
		session string
		index   int
		name    string
	}
	calledGetCwd        string
	calledGetProjectDir string
	ghqRepos    []tmux.GhqRepo
	ghqReposErr error
	calledListGhqRepos bool
	cloneGhqRepo    *tmux.GhqRepo
	cloneGhqRepoErr error
	calledCloneGhqRepo string
	deleteGhqRepoErr    error
	calledDeleteGhqRepo string
}

func (m *configurableMock) ListSessions() ([]tmux.Session, error) {
	m.calledListSessions = true
	return m.sessions, m.sessionsErr
}

func (m *configurableMock) NewSession(name string) (*tmux.Session, error) {
	m.calledNewSession = name
	return m.newSession, m.newSessErr
}

func (m *configurableMock) KillSession(name string) error {
	m.calledKillSession = name
	return m.killSessErr
}

func (m *configurableMock) ListWindows(session string) ([]tmux.Window, error) {
	m.calledListWindows = session
	return m.windows, m.windowsErr
}

func (m *configurableMock) NewWindow(session, name, command string) (*tmux.Window, error) {
	m.calledNewWindow = struct{ session, name, command string }{session, name, command}
	return m.newWindow, m.newWinErr
}

func (m *configurableMock) KillWindow(session string, index int) error {
	m.calledKillWindow = struct {
		session string
		index   int
	}{session, index}
	return m.killWinErr
}

func (m *configurableMock) RenameWindow(session string, index int, name string) error {
	m.calledRenameWindow = struct {
		session string
		index   int
		name    string
	}{session, index, name}
	return m.renameWinErr
}

func (m *configurableMock) Attach(session string, windowIndex int) (*os.File, *exec.Cmd, error) {
	return nil, nil, nil
}

func (m *configurableMock) CreateGroupedSession(target string) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (m *configurableMock) DestroyGroupedSession(name string) error { return nil }

func (m *configurableMock) GetSessionCwd(session string) (string, error) {
	m.calledGetCwd = session
	return m.cwd, m.cwdErr
}

func (m *configurableMock) GetSessionProjectDir(session string) (string, error) {
	m.calledGetProjectDir = session
	// projectDir が設定されている場合はそちらを返す。
	// 未設定の場合は cwd にフォールバック（既存テストとの互換性）。
	if m.projectDir != "" || m.projectDirErr != nil {
		return m.projectDir, m.projectDirErr
	}
	return m.cwd, m.cwdErr
}

func (m *configurableMock) ListGhqRepos() ([]tmux.GhqRepo, error) {
	m.calledListGhqRepos = true
	return m.ghqRepos, m.ghqReposErr
}

func (m *configurableMock) CloneGhqRepo(url string) (*tmux.GhqRepo, error) {
	m.calledCloneGhqRepo = url
	return m.cloneGhqRepo, m.cloneGhqRepoErr
}

func (m *configurableMock) DeleteGhqRepo(fullPath string) error {
	m.calledDeleteGhqRepo = fullPath
	return m.deleteGhqRepoErr
}

func (m *configurableMock) GetClientSessionWindow(tty string) (string, int, error) {
	return "", -1, fmt.Errorf("not implemented")
}

// newTestServer はテスト用 Server を作成するヘルパー。
func newTestServer(mock TmuxManager) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
	})
	return srv, token
}

// doRequest はテスト用リクエストを実行するヘルパー。
func doRequest(t *testing.T, handler http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()

	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestHandleListSessions(t *testing.T) {
	created := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		sessions   []tmux.Session
		sessErr    error
		wantStatus int
		wantBody   string // JSON 部分一致（空文字なら未チェック）
	}{
		{
			name: "セッション一覧を返す",
			sessions: []tmux.Session{
				{Name: "main", Windows: 3, Attached: true, Created: created},
				{Name: "dev", Windows: 1, Attached: false, Created: created},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "セッションが空の場合: 空配列を返す",
			sessions:   []tmux.Session{},
			wantStatus: http.StatusOK,
		},
		{
			name:       "セッションが nil の場合: 空配列を返す",
			sessions:   nil,
			wantStatus: http.StatusOK,
		},
		{
			name:       "tmux エラー: 500を返す",
			sessErr:    errors.New("tmux not running"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				sessions:    tt.sessions,
				sessionsErr: tt.sessErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				// Content-Type チェック
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				// JSON デコード
				var result []tmux.Session
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				wantLen := len(tt.sessions)
				if tt.sessions == nil {
					wantLen = 0
				}
				if len(result) != wantLen {
					t.Errorf("result length = %d, want %d", len(result), wantLen)
				}

				if tt.sessions != nil && len(tt.sessions) > 0 {
					if result[0].Name != tt.sessions[0].Name {
						t.Errorf("result[0].Name = %q, want %q", result[0].Name, tt.sessions[0].Name)
					}
					if result[0].Windows != tt.sessions[0].Windows {
						t.Errorf("result[0].Windows = %d, want %d", result[0].Windows, tt.sessions[0].Windows)
					}
					if result[0].Attached != tt.sessions[0].Attached {
						t.Errorf("result[0].Attached = %v, want %v", result[0].Attached, tt.sessions[0].Attached)
					}
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

			if !mock.calledListSessions {
				t.Error("ListSessions was not called")
			}
		})
	}
}

func TestHandleCreateSession(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		newSession *tmux.Session
		newSessErr error
		wantStatus int
	}{
		{
			name:       "セッションを作成する",
			body:       `{"name": "new-session"}`,
			newSession: &tmux.Session{Name: "new-session", Windows: 1},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "名前が空: 400を返す",
			body:       `{"name": ""}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "リクエストボディなし: 400を返す",
			body:       "",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "不正JSON: 400を返す",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "nameフィールドなし: 400を返す",
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "tmux エラー: 500を返す",
			body:       `{"name": "test"}`,
			newSessErr: errors.New("session already exists"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				newSession: tt.newSession,
				newSessErr: tt.newSessErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions", token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusCreated {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result tmux.Session
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result.Name != "new-session" {
					t.Errorf("result.Name = %q, want %q", result.Name, "new-session")
				}

				if mock.calledNewSession != "new-session" {
					t.Errorf("NewSession called with %q, want %q", mock.calledNewSession, "new-session")
				}
			}
		})
	}
}

func TestHandleDeleteSession(t *testing.T) {
	tests := []struct {
		name        string
		sessionName string
		killErr     error
		wantStatus  int
	}{
		{
			name:        "セッションを削除する: 204を返す",
			sessionName: "main",
			wantStatus:  http.StatusNoContent,
		},
		{
			name:        "tmux エラー: 500を返す",
			sessionName: "nonexistent",
			killErr:     errors.New("session not found"),
			wantStatus:  http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				killSessErr: tt.killErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodDelete, "/api/sessions/"+tt.sessionName, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusNoContent {
				if mock.calledKillSession != tt.sessionName {
					t.Errorf("KillSession called with %q, want %q", mock.calledKillSession, tt.sessionName)
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
		})
	}
}

func TestHandleCreateSession_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		newSession: &tmux.Session{Name: "test-session", Windows: 1},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodPost, "/palmux/api/sessions", token, `{"name": "test-session"}`)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if mock.calledNewSession != "test-session" {
		t.Errorf("NewSession called with %q, want %q", mock.calledNewSession, "test-session")
	}
}
