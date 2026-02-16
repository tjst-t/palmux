package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/fileserver"
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

// setupFilesTestDir はファイル API テスト用のディレクトリ構造を作成する。
//
//	root/
//	  file.txt         (テキストファイル: "hello world")
//	  subdir/
//	    nested.txt     ("nested content")
//	  binary.png       (PNG ヘッダ)
func setupFilesTestDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "subdir"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "subdir", "nested.txt"), []byte("nested content"), 0644); err != nil {
		t.Fatal(err)
	}
	// PNG ヘッダ（バイナリファイル）
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	if err := os.WriteFile(filepath.Join(root, "binary.png"), pngHeader, 0644); err != nil {
		t.Fatal(err)
	}

	return root
}

func TestHandleGetFiles_DirectoryListing(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	// path=. でディレクトリ一覧を取得
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=.", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var listing fileserver.DirListing
	if err := json.NewDecoder(rec.Body).Decode(&listing); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if listing.Path != "." {
		t.Errorf("Path = %q, want %q", listing.Path, ".")
	}

	// エントリが含まれていることを確認
	names := make(map[string]bool)
	for _, e := range listing.Entries {
		names[e.Name] = true
	}
	for _, want := range []string{"file.txt", "subdir", "binary.png"} {
		if !names[want] {
			t.Errorf("listing should contain %q", want)
		}
	}

	if mock.calledGetCwd != "main" {
		t.Errorf("GetSessionCwd called with %q, want %q", mock.calledGetCwd, "main")
	}
}

func TestHandleGetFiles_DefaultPath(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	// path パラメータなし → デフォルトで "." を使用
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var listing fileserver.DirListing
	if err := json.NewDecoder(rec.Body).Decode(&listing); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if listing.Path != "." {
		t.Errorf("Path = %q, want %q", listing.Path, ".")
	}
}

func TestHandleGetFiles_SubdirectoryListing(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=subdir", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var listing fileserver.DirListing
	if err := json.NewDecoder(rec.Body).Decode(&listing); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if listing.Path != "subdir" {
		t.Errorf("Path = %q, want %q", listing.Path, "subdir")
	}

	if len(listing.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(listing.Entries))
	}
	if listing.Entries[0].Name != "nested.txt" {
		t.Errorf("entry name = %q, want %q", listing.Entries[0].Name, "nested.txt")
	}
}

func TestHandleGetFiles_FileContent(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=file.txt", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var fc fileserver.FileContent
	if err := json.NewDecoder(rec.Body).Decode(&fc); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if fc.Path != "file.txt" {
		t.Errorf("Path = %q, want %q", fc.Path, "file.txt")
	}
	if fc.IsDir {
		t.Error("IsDir should be false")
	}
	if fc.Content != "hello world" {
		t.Errorf("Content = %q, want %q", fc.Content, "hello world")
	}
	if fc.ContentType != "text" {
		t.Errorf("ContentType = %q, want %q", fc.ContentType, "text")
	}
}

func TestHandleGetFiles_RawFile(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=file.txt&raw=true", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/") {
		t.Errorf("Content-Type = %q, want text/* for text file", ct)
	}

	body, err := io.ReadAll(rec.Body)
	if err != nil {
		t.Fatalf("failed to read body: %v", err)
	}
	if string(body) != "hello world" {
		t.Errorf("body = %q, want %q", string(body), "hello world")
	}
}

func TestHandleGetFiles_RawBinaryFile(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=binary.png&raw=true", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "image") {
		t.Errorf("Content-Type = %q, should contain 'image'", ct)
	}

	body, err := io.ReadAll(rec.Body)
	if err != nil {
		t.Fatalf("failed to read body: %v", err)
	}
	// PNG ヘッダの長さ
	if len(body) != 8 {
		t.Errorf("body length = %d, want 8", len(body))
	}
}

func TestHandleGetFiles_SessionNotFound(t *testing.T) {
	mock := &configurableMock{
		cwdErr: fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
	}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/nonexistent/files?path=.", token, "")

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}

	var errResp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}
	if errResp["error"] == "" {
		t.Error("error response should contain 'error' field")
	}
}

func TestHandleGetFiles_PathTraversal(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	attacks := []string{
		"../../etc/passwd",
		"../../../etc/shadow",
		"/etc/passwd",
	}

	for _, path := range attacks {
		t.Run(path, func(t *testing.T) {
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path="+path, token, "")

			// パストラバーサルは 403 または 400 を期待
			if rec.Code == http.StatusOK {
				t.Errorf("path traversal should not return 200 for path %q, got %d", path, rec.Code)
			}
		})
	}
}

func TestHandleGetFiles_NonexistentFile(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=nonexistent.txt", token, "")

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestHandleGetFiles_WithBasePath(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/sessions/main/files?path=.", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if mock.calledGetCwd != "main" {
		t.Errorf("GetSessionCwd called with %q, want %q", mock.calledGetCwd, "main")
	}
}

func TestHandleGetFiles_Authentication(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, _ := newTestServer(mock)

	// トークンなしでアクセス → 401
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=.", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// 不正なトークンでアクセス → 401
	rec = doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files?path=.", "wrong-token", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
