package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/tjst-t/palmux/internal/fileserver"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetCwd は GET /api/sessions/{session}/cwd のハンドラ。
// セッションのアクティブ pane のカレントパスを返す。
func (s *Server) handleGetCwd() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"path": cwd})
	})
}

// handleGetFiles は GET /api/sessions/{session}/files のハンドラ。
// クエリパラメータ path でファイルまたはディレクトリを指定する（デフォルト: "."）。
//   - ディレクトリの場合: DirListing JSON を返す
//   - ファイルの場合: FileContent JSON を返す
//   - raw=true の場合: ファイルの生データを Content-Type ヘッダ付きでストリームする
func (s *Server) handleGetFiles() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionCwd(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		fs := &fileserver.FileServer{RootDir: cwd}

		path := r.URL.Query().Get("path")
		if path == "" {
			path = "."
		}

		raw := r.URL.Query().Get("raw") == "true"

		// raw=true の場合: ファイルの生データをストリーム
		if raw {
			rc, contentType, err := fs.RawFile(path)
			if err != nil {
				writeFilesError(w, err, path)
				return
			}
			defer rc.Close()

			w.Header().Set("Content-Type", contentType)
			if _, err := io.Copy(w, rc); err != nil {
				// レスポンスヘッダは既に送信済みなのでログのみ
				return
			}
			return
		}

		// まず Read を試みる
		fc, err := fs.Read(path)
		if err != nil {
			writeFilesError(w, err, path)
			return
		}

		// ディレクトリの場合は List に切り替える
		if fc.IsDir {
			listing, err := fs.List(path)
			if err != nil {
				writeFilesError(w, err, path)
				return
			}
			writeJSON(w, http.StatusOK, listing)
			return
		}

		writeJSON(w, http.StatusOK, fc)
	})
}

// writeFilesError はファイル操作のエラーを適切な HTTP ステータスコードで返す。
func writeFilesError(w http.ResponseWriter, err error, path string) {
	errMsg := err.Error()

	// パストラバーサル系エラー
	if strings.Contains(errMsg, "path outside root") ||
		strings.Contains(errMsg, "absolute path not allowed") {
		writeError(w, http.StatusForbidden, "access denied: "+path)
		return
	}

	// ファイル/ディレクトリが見つからない
	if os.IsNotExist(err) || strings.Contains(errMsg, "resolve path") {
		writeError(w, http.StatusNotFound, "not found: "+path)
		return
	}

	writeError(w, http.StatusInternalServerError, err.Error())
}
