package server

import (
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/tjst-t/palmux/internal/tmux"
)

// TmuxManager は tmux の操作を抽象化する。
// テスト時にはモック実装を注入する。
type TmuxManager interface {
	ListSessions() ([]tmux.Session, error)
	NewSession(name string) (*tmux.Session, error)
	KillSession(name string) error
	ListWindows(session string) ([]tmux.Window, error)
	NewWindow(session, name string) (*tmux.Window, error)
	KillWindow(session string, index int) error
	RenameWindow(session string, index int, name string) error
	Attach(session string) (*os.File, *exec.Cmd, error)
}

// Server は Palmux の HTTP サーバーを表す。
type Server struct {
	tmux        TmuxManager
	token       string
	basePath    string
	handler     http.Handler
	connTracker *connectionTracker
}

// Options は Server の生成オプション。
type Options struct {
	Tmux           TmuxManager
	Token          string
	BasePath       string
	Frontend       fs.FS // 静的ファイル配信用 FS（テスト時は nil 可）
	MaxConnections int   // 同一セッションへの最大同時接続数（デフォルト: 5）
}

// NewServer は Options を元に新しい Server を生成する。
// ベースパスの正規化、ルーティング登録、認証ミドルウェアの適用を行う。
func NewServer(opts Options) *Server {
	s := &Server{
		tmux:        opts.Tmux,
		token:       opts.Token,
		basePath:    NormalizeBasePath(opts.BasePath),
		connTracker: newConnectionTracker(opts.MaxConnections),
	}

	mux := http.NewServeMux()

	// 認証ミドルウェア
	auth := AuthMiddleware(s.token)

	// API ルート
	mux.Handle("GET /api/sessions", auth(s.handleListSessions()))
	mux.Handle("POST /api/sessions", auth(s.handleCreateSession()))
	mux.Handle("DELETE /api/sessions/{name}", auth(s.handleDeleteSession()))
	mux.Handle("GET /api/sessions/{session}/windows", auth(s.handleListWindows()))
	mux.Handle("POST /api/sessions/{session}/windows", auth(s.handleCreateWindow()))
	mux.Handle("DELETE /api/sessions/{session}/windows/{index}", auth(s.handleDeleteWindow()))
	mux.Handle("PATCH /api/sessions/{session}/windows/{index}", auth(s.handleRenameWindow()))
	mux.Handle("GET /api/sessions/{session}/windows/{index}/attach", auth(s.handleAttach()))
	mux.Handle("GET /api/connections", auth(s.handleListConnections()))

	// 静的ファイル配信
	if opts.Frontend != nil {
		fileServer := http.FileServerFS(opts.Frontend)
		mux.Handle("/", &indexInjector{
			fs:       opts.Frontend,
			basePath: s.basePath,
			token:    s.token,
			fallback: fileServer,
		})
	}

	// ベースパスが "/" の場合は StripPrefix 不要
	if s.basePath == "/" {
		s.handler = mux
	} else {
		s.handler = http.StripPrefix(strings.TrimSuffix(s.basePath, "/"), mux)
	}

	return s
}

// Handler は Server の http.Handler を返す。
func (s *Server) Handler() http.Handler {
	return s.handler
}

// ListenAndServe は指定アドレスで HTTP サーバーを起動する。
func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.handler)
}

// ListenAndServeTLS は指定アドレスで TLS 付き HTTP サーバーを起動する。
func (s *Server) ListenAndServeTLS(addr, certFile, keyFile string) error {
	return http.ListenAndServeTLS(addr, certFile, keyFile, s.handler)
}

// indexInjector は index.html のリクエストを横取りして、
// base-path と auth-token の meta タグに実際の値を注入するハンドラ。
// それ以外のリクエストは fallback ハンドラに委譲する。
type indexInjector struct {
	fs       fs.FS
	basePath string
	token    string
	fallback http.Handler
}

// ServeHTTP は "/" と "/index.html" へのリクエストを横取りして meta タグを注入する。
func (h *indexInjector) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" || r.URL.Path == "/index.html" {
		data, err := fs.ReadFile(h.fs, "index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusInternalServerError)
			return
		}

		html := string(data)
		// base-path meta タグの content 属性を置換
		html = strings.Replace(html,
			`<meta name="base-path" content="/">`,
			`<meta name="base-path" content="`+h.basePath+`">`,
			1)
		// auth-token meta タグの content 属性を置換
		html = strings.Replace(html,
			`<meta name="auth-token" content="">`,
			`<meta name="auth-token" content="`+h.token+`">`,
			1)

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
		return
	}

	h.fallback.ServeHTTP(w, r)
}

// NormalizeBasePath はベースパスを正規化する。
// 必ず "/" で始まり "/" で終わるように変換する。
// 例: "palmux" → "/palmux/", "/palmux" → "/palmux/", "" → "/"
func NormalizeBasePath(path string) string {
	if path == "" || path == "/" {
		return "/"
	}

	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	if !strings.HasSuffix(path, "/") {
		path = path + "/"
	}

	return path
}
