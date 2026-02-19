package server

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/tjst-t/palmux/internal/tmux"
)

// mockTmuxManager は TmuxManager のモック実装。
type mockTmuxManager struct{}

func (m *mockTmuxManager) ListSessions() ([]tmux.Session, error) { return nil, nil }
func (m *mockTmuxManager) NewSession(name string) (*tmux.Session, error) {
	return &tmux.Session{}, nil
}
func (m *mockTmuxManager) KillSession(name string) error                     { return nil }
func (m *mockTmuxManager) ListWindows(session string) ([]tmux.Window, error) { return nil, nil }
func (m *mockTmuxManager) NewWindow(session, name string) (*tmux.Window, error) {
	return &tmux.Window{}, nil
}
func (m *mockTmuxManager) KillWindow(session string, index int) error { return nil }
func (m *mockTmuxManager) RenameWindow(session string, index int, name string) error {
	return nil
}
func (m *mockTmuxManager) Attach(session string, windowIndex int) (*os.File, *exec.Cmd, error) {
	return nil, nil, nil
}
func (m *mockTmuxManager) GetSessionCwd(session string) (string, error) { return "", nil }
func (m *mockTmuxManager) GetSessionProjectDir(session string) (string, error) {
	return "", nil
}
func (m *mockTmuxManager) ListGhqRepos() ([]tmux.GhqRepo, error) { return nil, nil }

func TestNormalizeBasePath(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "既に正規化済み: そのまま返す",
			in:   "/",
			want: "/",
		},
		{
			name: "先頭と末尾にスラッシュあり: そのまま返す",
			in:   "/palmux/",
			want: "/palmux/",
		},
		{
			name: "スラッシュなし: 前後にスラッシュを追加",
			in:   "palmux",
			want: "/palmux/",
		},
		{
			name: "先頭のスラッシュのみ: 末尾にスラッシュを追加",
			in:   "/palmux",
			want: "/palmux/",
		},
		{
			name: "末尾のスラッシュのみ: 先頭にスラッシュを追加",
			in:   "palmux/",
			want: "/palmux/",
		},
		{
			name: "深いネストパス: 正規化される",
			in:   "deep/nested/path",
			want: "/deep/nested/path/",
		},
		{
			name: "深いネストパスが既に正規化済み: そのまま返す",
			in:   "/deep/nested/path/",
			want: "/deep/nested/path/",
		},
		{
			name: "空文字列: ルートに正規化",
			in:   "",
			want: "/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeBasePath(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeBasePath(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// testIndexHTML は テスト用の index.html テンプレート。
// 実際のフロントエンドと同じ meta タグ構造を持つ。
const testIndexHTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="base-path" content="/">
  <meta name="auth-token" content="">
  <title>Palmux</title>
</head>
<body>Palmux</body>
</html>`

// newTestFrontendFS は テスト用の静的ファイル FS を返す。
func newTestFrontendFS() fs.FS {
	return fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(testIndexHTML),
		},
	}
}

func TestNewServer_ReturnsNonNilServer(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	if srv == nil {
		t.Fatal("NewServer returned nil")
	}
}

func TestNewServer_NormalizesBasePath(t *testing.T) {
	tests := []struct {
		name         string
		basePath     string
		wantBasePath string
	}{
		{
			name:         "ルートパス",
			basePath:     "/",
			wantBasePath: "/",
		},
		{
			name:         "スラッシュなし",
			basePath:     "palmux",
			wantBasePath: "/palmux/",
		},
		{
			name:         "正規化済み",
			basePath:     "/palmux/",
			wantBasePath: "/palmux/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := NewServer(Options{
				Tmux:     &mockTmuxManager{},
				Token:    "test-token",
				BasePath: tt.basePath,
				Frontend: newTestFrontendFS(),
			})

			if srv.basePath != tt.wantBasePath {
				t.Errorf("basePath = %q, want %q", srv.basePath, tt.wantBasePath)
			}
		})
	}
}

// testRoute はルーティングテスト用のヘルパー。
// method, path にリクエストして、wantStatus をチェックする。
// 404 以外ならルートにマッチしたとみなす。
func testRoute(t *testing.T, handler http.Handler, method, path, token string, wantStatus int) {
	t.Helper()

	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Errorf("%s %s: status = %d, want %d", method, path, rec.Code, wantStatus)
	}
}

func TestServer_RoutingWithBasePathRoot(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	handler := srv.Handler()

	// API ルートが認証付きでアクセス可能（認証なしは 401）
	tests := []struct {
		name       string
		method     string
		path       string
		withToken  bool
		wantStatus int
	}{
		{
			name:       "GET /api/sessions: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /api/sessions: 認証なし → 401",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "POST /api/sessions: 認証あり → 400 (ボディなし)",
			method:     http.MethodPost,
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "DELETE /api/sessions/main: 認証あり → 204",
			method:     http.MethodDelete,
			path:       "/api/sessions/main",
			withToken:  true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "GET /api/sessions/main/windows: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/api/sessions/main/windows",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "POST /api/sessions/main/windows: 認証あり → 201 (名前省略可)",
			method:     http.MethodPost,
			path:       "/api/sessions/main/windows",
			withToken:  true,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "DELETE /api/sessions/main/windows/0: 認証あり → 204",
			method:     http.MethodDelete,
			path:       "/api/sessions/main/windows/0",
			withToken:  true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "GET /api/sessions/main/windows/0/attach: 認証あり → 426 (WebSocket Upgrade Required)",
			method:     http.MethodGet,
			path:       "/api/sessions/main/windows/0/attach",
			withToken:  true,
			wantStatus: http.StatusUpgradeRequired,
		},
		{
			name:       "GET /api/connections: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/api/connections",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /api/connections: 認証なし → 401",
			method:     http.MethodGet,
			path:       "/api/connections",
			withToken:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "GET /: 静的ファイル → 200 (認証不要)",
			method:     http.MethodGet,
			path:       "/",
			withToken:  false,
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tk := ""
			if tt.withToken {
				tk = token
			}
			testRoute(t, handler, tt.method, tt.path, tk, tt.wantStatus)
		})
	}
}

func TestServer_RoutingWithBasePathPalmux(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/palmux/",
		Frontend: newTestFrontendFS(),
	})

	handler := srv.Handler()

	tests := []struct {
		name       string
		method     string
		path       string
		withToken  bool
		wantStatus int
	}{
		{
			name:       "GET /palmux/api/sessions: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/palmux/api/sessions",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /palmux/api/sessions: 認証なし → 401",
			method:     http.MethodGet,
			path:       "/palmux/api/sessions",
			withToken:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "POST /palmux/api/sessions: 認証あり → 400 (ボディなし)",
			method:     http.MethodPost,
			path:       "/palmux/api/sessions",
			withToken:  true,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "DELETE /palmux/api/sessions/main: 認証あり → 204",
			method:     http.MethodDelete,
			path:       "/palmux/api/sessions/main",
			withToken:  true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "GET /palmux/api/sessions/main/windows: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/palmux/api/sessions/main/windows",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "POST /palmux/api/sessions/main/windows: 認証あり → 201 (名前省略可)",
			method:     http.MethodPost,
			path:       "/palmux/api/sessions/main/windows",
			withToken:  true,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "DELETE /palmux/api/sessions/main/windows/0: 認証あり → 204",
			method:     http.MethodDelete,
			path:       "/palmux/api/sessions/main/windows/0",
			withToken:  true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "GET /palmux/api/sessions/main/windows/0/attach: 認証あり → 426 (WebSocket Upgrade Required)",
			method:     http.MethodGet,
			path:       "/palmux/api/sessions/main/windows/0/attach",
			withToken:  true,
			wantStatus: http.StatusUpgradeRequired,
		},
		{
			name:       "GET /palmux/api/connections: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/palmux/api/connections",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /palmux/: 静的ファイル → 200 (認証不要)",
			method:     http.MethodGet,
			path:       "/palmux/",
			withToken:  false,
			wantStatus: http.StatusOK,
		},
		{
			name:       "ベースパスなしの /api/sessions: 404",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tk := ""
			if tt.withToken {
				tk = token
			}
			testRoute(t, handler, tt.method, tt.path, tk, tt.wantStatus)
		})
	}
}

func TestServer_RoutingWithDeepNestedBasePath(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/deep/nested/path/",
		Frontend: newTestFrontendFS(),
	})

	handler := srv.Handler()

	tests := []struct {
		name       string
		method     string
		path       string
		withToken  bool
		wantStatus int
	}{
		{
			name:       "GET /deep/nested/path/api/sessions: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/deep/nested/path/api/sessions",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /deep/nested/path/api/sessions: 認証なし → 401",
			method:     http.MethodGet,
			path:       "/deep/nested/path/api/sessions",
			withToken:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "DELETE /deep/nested/path/api/sessions/main: 認証あり → 204",
			method:     http.MethodDelete,
			path:       "/deep/nested/path/api/sessions/main",
			withToken:  true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "GET /deep/nested/path/api/sessions/main/windows: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/deep/nested/path/api/sessions/main/windows",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /deep/nested/path/api/connections: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/deep/nested/path/api/connections",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "GET /deep/nested/path/: 静的ファイル → 200 (認証不要)",
			method:     http.MethodGet,
			path:       "/deep/nested/path/",
			withToken:  false,
			wantStatus: http.StatusOK,
		},
		{
			name:       "ベースパスなしの /api/sessions: 404",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tk := ""
			if tt.withToken {
				tk = token
			}
			testRoute(t, handler, tt.method, tt.path, tk, tt.wantStatus)
		})
	}
}

func TestServer_StaticFileServing(t *testing.T) {
	frontFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(testIndexHTML),
		},
		"css/style.css": &fstest.MapFile{
			Data: []byte("body { margin: 0; }"),
		},
	}

	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: frontFS,
	})

	handler := srv.Handler()

	t.Run("GET / は index.html を返す", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		body := rec.Body.String()
		if !strings.Contains(body, "Palmux") {
			t.Errorf("body should contain 'Palmux', got %q", body)
		}
	})

	t.Run("GET /css/style.css は CSS を返す", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/css/style.css", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		body := rec.Body.String()
		if !strings.Contains(body, "body") {
			t.Errorf("body should contain CSS content, got %q", body)
		}
	})
}

func TestServer_StaticFileServingWithBasePath(t *testing.T) {
	frontFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(testIndexHTML),
		},
	}

	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/palmux/",
		Frontend: frontFS,
	})

	handler := srv.Handler()

	t.Run("GET /palmux/ は index.html を返す", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/palmux/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
		}

		body := rec.Body.String()
		if !strings.Contains(body, "Palmux") {
			t.Errorf("body should contain 'Palmux', got %q", body)
		}
	})
}

func TestServer_IndexHTMLInjection(t *testing.T) {
	tests := []struct {
		name         string
		basePath     string
		token        string
		requestPath  string
		wantBasePath string
		wantToken    string
	}{
		{
			name:         "ルートパス: basePathとtokenが注入される",
			basePath:     "/",
			token:        "my-secret-token",
			requestPath:  "/",
			wantBasePath: `content="/"`,
			wantToken:    `content="my-secret-token"`,
		},
		{
			name:         "/index.html でもbasePathとtokenが注入される",
			basePath:     "/",
			token:        "my-secret-token",
			requestPath:  "/index.html",
			wantBasePath: `content="/"`,
			wantToken:    `content="my-secret-token"`,
		},
		{
			name:         "カスタムbasePath: basePathが注入される",
			basePath:     "/palmux/",
			token:        "abc123",
			requestPath:  "/palmux/",
			wantBasePath: `content="/palmux/"`,
			wantToken:    `content="abc123"`,
		},
		{
			name:         "深いネストパス: basePathが注入される",
			basePath:     "/deep/nested/path/",
			token:        "deep-token",
			requestPath:  "/deep/nested/path/",
			wantBasePath: `content="/deep/nested/path/"`,
			wantToken:    `content="deep-token"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			frontFS := fstest.MapFS{
				"index.html": &fstest.MapFile{
					Data: []byte(testIndexHTML),
				},
			}

			srv := NewServer(Options{
				Tmux:     &mockTmuxManager{},
				Token:    tt.token,
				BasePath: tt.basePath,
				Frontend: frontFS,
			})

			handler := srv.Handler()

			req := httptest.NewRequest(http.MethodGet, tt.requestPath, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}

			body := rec.Body.String()

			// base-path meta タグの値が注入されている
			if !strings.Contains(body, `name="base-path"`) {
				t.Errorf("body should contain base-path meta tag, got %q", body)
			}
			if !strings.Contains(body, tt.wantBasePath) {
				t.Errorf("body should contain %q for base-path, got %q", tt.wantBasePath, body)
			}

			// auth-token meta タグの値が注入されている
			if !strings.Contains(body, `name="auth-token"`) {
				t.Errorf("body should contain auth-token meta tag, got %q", body)
			}
			if !strings.Contains(body, tt.wantToken) {
				t.Errorf("body should contain %q for auth-token, got %q", tt.wantToken, body)
			}

			// Content-Type が text/html
			ct := rec.Header().Get("Content-Type")
			if !strings.Contains(ct, "text/html") {
				t.Errorf("Content-Type = %q, want text/html", ct)
			}
		})
	}
}

func TestServer_IndexHTMLInjection_OtherFilesNotAffected(t *testing.T) {
	frontFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte(testIndexHTML),
		},
		"style.css": &fstest.MapFile{
			Data: []byte("body { margin: 0; }"),
		},
	}

	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: frontFS,
	})

	handler := srv.Handler()

	// CSS ファイルは注入処理の影響を受けない
	req := httptest.NewRequest(http.MethodGet, "/style.css", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	body := rec.Body.String()
	if body != "body { margin: 0; }" {
		t.Errorf("CSS file should not be modified, got %q", body)
	}
}

func TestServer_NilFrontend(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: nil,
	})

	handler := srv.Handler()

	// API ルートは動作する
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestServer_Handler_ImplementsHTTPHandler(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	// Handler() が http.Handler を返すことを確認
	var h http.Handler = srv.Handler()
	if h == nil {
		t.Fatal("Handler() returned nil")
	}
}

func TestServer_APIRoutesRequireAuth(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	handler := srv.Handler()

	// 認証が必要な全 API ルート
	apiRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/sessions"},
		{http.MethodPost, "/api/sessions"},
		{http.MethodDelete, "/api/sessions/test"},
		{http.MethodGet, "/api/sessions/test/windows"},
		{http.MethodPost, "/api/sessions/test/windows"},
		{http.MethodDelete, "/api/sessions/test/windows/0"},
		{http.MethodPatch, "/api/sessions/test/windows/0"},
		{http.MethodGet, "/api/sessions/test/windows/0/attach"},
		{http.MethodGet, "/api/connections"},
	}

	for _, route := range apiRoutes {
		t.Run(route.method+" "+route.path+" 認証なしは401", func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

// --- TLS テスト ---

func TestServer_TLS_APIAccessOverTLS(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	// httptest.NewTLSServer は自己署名証明書で TLS サーバーを起動する
	ts := httptest.NewTLSServer(srv.Handler())
	defer ts.Close()

	client := ts.Client()

	tests := []struct {
		name       string
		method     string
		path       string
		withToken  bool
		wantStatus int
	}{
		{
			name:       "TLS経由でGET /api/sessions: 認証あり → 200",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "TLS経由でGET /api/sessions: 認証なし → 401",
			method:     http.MethodGet,
			path:       "/api/sessions",
			withToken:  false,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "TLS経由でGET /: 静的ファイル → 200",
			method:     http.MethodGet,
			path:       "/",
			withToken:  false,
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest(tt.method, ts.URL+tt.path, nil)
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			if tt.withToken {
				req.Header.Set("Authorization", "Bearer "+token)
			}

			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}

func TestServer_TLS_WithBasePath(t *testing.T) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/palmux/",
		Frontend: newTestFrontendFS(),
	})

	ts := httptest.NewTLSServer(srv.Handler())
	defer ts.Close()

	client := ts.Client()

	tests := []struct {
		name       string
		path       string
		withToken  bool
		wantStatus int
	}{
		{
			name:       "TLS + basePath: GET /palmux/api/sessions 認証あり → 200",
			path:       "/palmux/api/sessions",
			withToken:  true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "TLS + basePath: GET /palmux/ 静的ファイル → 200",
			path:       "/palmux/",
			withToken:  false,
			wantStatus: http.StatusOK,
		},
		{
			name:       "TLS + basePath: ベースパスなし → 404",
			path:       "/api/sessions",
			withToken:  true,
			wantStatus: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, ts.URL+tt.path, nil)
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			if tt.withToken {
				req.Header.Set("Authorization", "Bearer "+token)
			}

			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
		})
	}
}

func TestServer_TLS_IndexHTMLInjectionOverTLS(t *testing.T) {
	const token = "tls-test-token"
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    token,
		BasePath: "/secure/",
		Frontend: newTestFrontendFS(),
	})

	ts := httptest.NewTLSServer(srv.Handler())
	defer ts.Close()

	client := ts.Client()

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/secure/", nil)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	bodyBytes := make([]byte, 4096)
	n, _ := resp.Body.Read(bodyBytes)
	body := string(bodyBytes[:n])

	// base-path と token が注入されている
	if !strings.Contains(body, `content="/secure/"`) {
		t.Errorf("body should contain injected base-path '/secure/', got %q", body)
	}
	if !strings.Contains(body, `content="tls-test-token"`) {
		t.Errorf("body should contain injected token, got %q", body)
	}
}

func TestServer_ListenAndServe_MethodExists(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	// ListenAndServe メソッドが存在することを確認
	// ポート 0 で起動して即座に閉じるテストはできないが、
	// メソッドのシグネチャが正しいことをコンパイル時に確認する
	var fn func(string) error = srv.ListenAndServe
	if fn == nil {
		t.Fatal("ListenAndServe method should not be nil")
	}
}

func TestServer_ListenAndServeTLS_MethodExists(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	// ListenAndServeTLS メソッドが存在することを確認
	var fn func(string, string, string) error = srv.ListenAndServeTLS
	if fn == nil {
		t.Fatal("ListenAndServeTLS method should not be nil")
	}
}
