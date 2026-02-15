package server

import (
	"io/fs"
	"net/http"
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
}

// Server は Palmux の HTTP サーバーを表す。
type Server struct {
	tmux     TmuxManager
	token    string
	basePath string
	handler  http.Handler
}

// Options は Server の生成オプション。
type Options struct {
	Tmux     TmuxManager
	Token    string
	BasePath string
	Frontend fs.FS // 静的ファイル配信用 FS（テスト時は nil 可）
}

// NewServer は Options を元に新しい Server を生成する。
// ベースパスの正規化、ルーティング登録、認証ミドルウェアの適用を行う。
func NewServer(opts Options) *Server {
	s := &Server{
		tmux:     opts.Tmux,
		token:    opts.Token,
		basePath: NormalizeBasePath(opts.BasePath),
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
	mux.Handle("GET /api/sessions/{session}/windows/{index}/attach", auth(s.handleAttach()))

	// 静的ファイル配信
	if opts.Frontend != nil {
		mux.Handle("/", http.FileServerFS(opts.Frontend))
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

// handleAttach は WebSocket pty ブリッジのスタブハンドラ。実際の実装は Task 7 で行う。
func (s *Server) handleAttach() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}
