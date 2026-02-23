package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"

	"github.com/tjst-t/palmux/internal/fileserver"
	"github.com/tjst-t/palmux/internal/tmux"
)

// handleGetCwd は GET /api/sessions/{session}/cwd のハンドラ。
// セッションの ghq プロジェクトディレクトリ（フォールバック: アクティブ pane のカレントパス）を返す。
func (s *Server) handleGetCwd() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
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

		cwd, err := s.tmux.GetSessionProjectDir(session)
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

// handlePutFile は PUT /api/sessions/{session}/files のハンドラ。
// クエリパラメータ path で指定されたファイルの内容を上書きする。
// リクエストボディ: {"content": "..."}
// レスポンス: {"path": "...", "size": N}
func (s *Server) handlePutFile() http.Handler {
	type putFileRequest struct {
		Content string `json:"content"`
	}
	type putFileResponse struct {
		Path string `json:"path"`
		Size int    `json:"size"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
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
			writeError(w, http.StatusBadRequest, "path parameter is required")
			return
		}

		var req putFileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		content := []byte(req.Content)
		if err := fs.Write(path, content); err != nil {
			writeFilesError(w, err, path)
			return
		}

		writeJSON(w, http.StatusOK, putFileResponse{
			Path: path,
			Size: len(content),
		})
	})
}

// handleSearchFiles は GET /api/sessions/{session}/files/search のハンドラ。
// クエリパラメータ q で検索文字列、path で検索起点ディレクトリを指定する。
// カレントディレクトリ以下のファイル名を再帰的に検索し、マッチしたエントリを返す。
func (s *Server) handleSearchFiles() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		cwd, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		fs := &fileserver.FileServer{RootDir: cwd}

		query := r.URL.Query().Get("q")
		basePath := r.URL.Query().Get("path")
		if basePath == "" {
			basePath = "."
		}

		results, err := fs.Search(query, basePath)
		if err != nil {
			writeFilesError(w, err, basePath)
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"query":   query,
			"results": results,
		})
	})
}

// writeFilesError はファイル操作のエラーを適切な HTTP ステータスコードで返す。
func writeFilesError(w http.ResponseWriter, err error, path string) {
	// パストラバーサル系エラー
	if errors.Is(err, fileserver.ErrPathOutsideRoot) || errors.Is(err, fileserver.ErrAbsolutePath) {
		writeError(w, http.StatusForbidden, "access denied: "+path)
		return
	}

	// ファイル/ディレクトリが見つからない
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "not found: "+path)
		return
	}

	// ディレクトリへの書き込み
	if errors.Is(err, fileserver.ErrIsDirectory) {
		writeError(w, http.StatusBadRequest, "is a directory: "+path)
		return
	}

	// ファイルサイズ超過
	if errors.Is(err, fileserver.ErrFileTooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large: "+path)
		return
	}

	writeError(w, http.StatusInternalServerError, err.Error())
}
