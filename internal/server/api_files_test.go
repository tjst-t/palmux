package server

import (
	"context"
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
	"github.com/tjst-t/palmux/internal/grep"
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

				if mock.calledGetProjectDir != tt.session {
					t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, tt.session)
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

	if mock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, "main")
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

	if mock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, "main")
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

	if mock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, "main")
	}
}

// --- PUT /api/sessions/{session}/files テスト ---

func TestHandlePutFile(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	tests := []struct {
		name       string
		path       string
		body       string
		wantStatus int
	}{
		{
			name:       "正常: テキストファイル書き込み",
			path:       "file.txt",
			body:       `{"content":"updated content"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "正常: ネストファイル書き込み",
			path:       "subdir/nested.txt",
			body:       `{"content":"new nested"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "正常: 空コンテンツ",
			path:       "file.txt",
			body:       `{"content":""}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "エラー: pathパラメータなし",
			path:       "",
			body:       `{"content":"data"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "エラー: ディレクトリ",
			path:       "subdir",
			body:       `{"content":"data"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "エラー: 存在しないファイル",
			path:       "nonexistent.txt",
			body:       `{"content":"data"}`,
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "エラー: 絶対パス",
			path:       "/etc/passwd",
			body:       `{"content":"data"}`,
			wantStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := "/api/sessions/main/files"
			if tt.path != "" {
				url += "?path=" + tt.path
			}
			rec := doRequest(t, srv.Handler(), http.MethodPut, url, token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var resp struct {
					Path string `json:"path"`
					Size int    `json:"size"`
				}
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if resp.Path != tt.path {
					t.Errorf("path = %q, want %q", resp.Path, tt.path)
				}
			}
		})
	}
}

func TestHandlePutFile_VerifyContent(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	// 書き込み
	rec := doRequest(t, srv.Handler(), http.MethodPut,
		"/api/sessions/main/files?path=file.txt", token,
		`{"content":"hello updated"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	// 読み取りで検証
	data, err := os.ReadFile(filepath.Join(root, "file.txt"))
	if err != nil {
		t.Fatalf("ReadFile = %v", err)
	}
	if string(data) != "hello updated" {
		t.Errorf("content = %q, want %q", string(data), "hello updated")
	}
}

func TestHandlePutFile_InvalidBody(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodPut,
		"/api/sessions/main/files?path=file.txt", token,
		"not json")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandlePutFile_SessionNotFound(t *testing.T) {
	mock := &configurableMock{
		cwdErr: fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
	}
	srv, token := newTestServer(mock)

	rec := doRequest(t, srv.Handler(), http.MethodPut,
		"/api/sessions/nonexistent/files?path=file.txt", token,
		`{"content":"data"}`)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestHandlePutFile_PathTraversal(t *testing.T) {
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
			rec := doRequest(t, srv.Handler(), http.MethodPut,
				"/api/sessions/main/files?path="+path, token,
				`{"content":"malicious"}`)

			if rec.Code == http.StatusOK {
				t.Errorf("path traversal should not return 200 for path %q, got %d", path, rec.Code)
			}
		})
	}
}

func TestHandlePutFile_Authentication(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	srv, _ := newTestServer(mock)

	// トークンなし → 401
	rec := doRequest(t, srv.Handler(), http.MethodPut,
		"/api/sessions/main/files?path=file.txt", "",
		`{"content":"data"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestHandlePutFile_WithBasePath(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodPut,
		"/palmux/api/sessions/main/files?path=file.txt", token,
		`{"content":"updated via basepath"}`)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if mock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, "main")
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

// --- GET /api/sessions/{session}/files/grep テスト ---

// mockSearcher は grep.Searcher のモック実装。
type mockSearcher struct {
	results     []grep.Result
	err         error
	name        string
	calledQuery string
	calledDir   string
	calledOpts  grep.Options
}

func (m *mockSearcher) Search(ctx context.Context, query, dir string, opts grep.Options) ([]grep.Result, error) {
	m.calledQuery = query
	m.calledDir = dir
	m.calledOpts = opts
	return m.results, m.err
}

func (m *mockSearcher) Name() string {
	if m.name != "" {
		return m.name
	}
	return "mock"
}

func TestHandleGrepSearch_Basic(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{
		results: []grep.Result{
			{Path: "file.txt", LineNumber: 1, LineText: "hello world", MatchStart: 0, MatchEnd: 5},
		},
		name: "mock",
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=hello", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp grep.Response
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Query != "hello" {
		t.Errorf("Query = %q, want %q", resp.Query, "hello")
	}
	if len(resp.Results) != 1 {
		t.Fatalf("Results len = %d, want 1", len(resp.Results))
	}
	if resp.Results[0].Path != "file.txt" {
		t.Errorf("Results[0].Path = %q, want %q", resp.Results[0].Path, "file.txt")
	}
	if resp.Results[0].LineText != "hello world" {
		t.Errorf("Results[0].LineText = %q, want %q", resp.Results[0].LineText, "hello world")
	}

	// Searcher に正しいクエリが渡されたか
	if searcher.calledQuery != "hello" {
		t.Errorf("searcher.calledQuery = %q, want %q", searcher.calledQuery, "hello")
	}
	// デフォルトオプション確認
	if searcher.calledOpts.CaseSensitive {
		t.Error("CaseSensitive should be false by default")
	}
	if searcher.calledOpts.Regex {
		t.Error("Regex should be false by default")
	}
	if searcher.calledOpts.MaxResults != 500 {
		t.Errorf("MaxResults = %d, want 500", searcher.calledOpts.MaxResults)
	}
}

func TestHandleGrepSearch_WithPath(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{
		results: []grep.Result{
			{Path: "nested.txt", LineNumber: 1, LineText: "nested content", MatchStart: 0, MatchEnd: 6},
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=nested&path=subdir", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp grep.Response
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Results) != 1 {
		t.Fatalf("Results len = %d, want 1", len(resp.Results))
	}

	// 検索ディレクトリが subdir のフルパスであることを確認
	expectedDir := filepath.Join(root, "subdir")
	if searcher.calledDir != expectedDir {
		t.Errorf("searcher.calledDir = %q, want %q", searcher.calledDir, expectedDir)
	}
}

func TestHandleGrepSearch_EmptyQuery(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=", token, "")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestHandleGrepSearch_NoQueryParam(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep", token, "")

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestHandleGrepSearch_SessionNotFound(t *testing.T) {
	mock := &configurableMock{
		cwdErr: fmt.Errorf("get session cwd: %w", tmux.ErrSessionNotFound),
	}
	searcher := &mockSearcher{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/nonexistent/files/grep?q=hello", token, "")

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

func TestHandleGrepSearch_PathTraversal(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	attacks := []string{
		"../../etc",
		"../../../etc",
		"/etc",
	}

	for _, path := range attacks {
		t.Run(path, func(t *testing.T) {
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=hello&path="+path, token, "")

			if rec.Code == http.StatusOK {
				t.Errorf("path traversal should not return 200 for path %q, got %d", path, rec.Code)
			}
		})
	}
}

func TestHandleGrepSearch_EngineField(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{
		name:    "ripgrep",
		results: []grep.Result{},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=hello", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp grep.Response
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Engine != "ripgrep" {
		t.Errorf("Engine = %q, want %q", resp.Engine, "ripgrep")
	}
}

func TestHandleGrepSearch_Authentication(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{}

	srv := NewServer(Options{
		Tmux:     mock,
		Token:    "test-token",
		BasePath: "/",
		Searcher: searcher,
	})

	// トークンなしでアクセス → 401
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=hello", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}

	// 不正なトークンでアクセス → 401
	rec = doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/files/grep?q=hello", "wrong-token", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestHandleGrepSearch_WithBasePath(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{
		results: []grep.Result{
			{Path: "file.txt", LineNumber: 1, LineText: "hello world", MatchStart: 0, MatchEnd: 5},
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
		Searcher: searcher,
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/sessions/main/files/grep?q=hello", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if mock.calledGetProjectDir != "main" {
		t.Errorf("GetSessionProjectDir called with %q, want %q", mock.calledGetProjectDir, "main")
	}
}

func TestHandleGrepSearch_QueryOptions(t *testing.T) {
	root := setupFilesTestDir(t)
	mock := &configurableMock{cwd: root}
	searcher := &mockSearcher{results: []grep.Result{}}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		Searcher: searcher,
	})

	// case=true, regex=true, glob=*.go, limit=100 を指定
	rec := doRequest(t, srv.Handler(), http.MethodGet,
		"/api/sessions/main/files/grep?q=hello&case=true&regex=true&glob=*.go&limit=100",
		token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	if !searcher.calledOpts.CaseSensitive {
		t.Error("CaseSensitive should be true")
	}
	if !searcher.calledOpts.Regex {
		t.Error("Regex should be true")
	}
	if searcher.calledOpts.Glob != "*.go" {
		t.Errorf("Glob = %q, want %q", searcher.calledOpts.Glob, "*.go")
	}
	if searcher.calledOpts.MaxResults != 100 {
		t.Errorf("MaxResults = %d, want 100", searcher.calledOpts.MaxResults)
	}
}
