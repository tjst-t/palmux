package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

const maxUploadSize = 10 << 20 // 10MB

// allowedImageTypes は許可する MIME タイプと対応する拡張子のマッピング。
var allowedImageTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

// handleUploadImage は POST /api/upload のハンドラ。
// multipart/form-data の file フィールドから画像を受け取り、
// /tmp/palmux-<hex>.ext に保存してパスを JSON で返す。
func (s *Server) handleUploadImage() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// リクエストボディのサイズ制限
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

		file, _, err := r.FormFile("file")
		if err != nil {
			if err.Error() == "http: request body too large" {
				writeError(w, http.StatusRequestEntityTooLarge, "file too large (max 10MB)")
				return
			}
			writeError(w, http.StatusBadRequest, "file field is required")
			return
		}
		defer file.Close()

		// ファイル内容を読み取り
		data, err := io.ReadAll(file)
		if err != nil {
			if err.Error() == "http: request body too large" {
				writeError(w, http.StatusRequestEntityTooLarge, "file too large (max 10MB)")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to read file")
			return
		}

		// MIME タイプを検出しバリデーション
		contentType := http.DetectContentType(data)
		ext, ok := allowedImageTypes[contentType]
		if !ok {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("unsupported image type: %s", contentType))
			return
		}

		// UUID 風のランダムファイル名を生成
		randBytes := make([]byte, 16)
		if _, err := rand.Read(randBytes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate filename")
			return
		}
		hexName := hex.EncodeToString(randBytes)
		destPath := filepath.Join("/tmp", "palmux-"+hexName+ext)

		// アトミック書き込み: temp ファイルに書いてから rename
		tmpFile, err := os.CreateTemp("/tmp", "palmux-upload-*")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create temp file")
			return
		}
		tmpName := tmpFile.Name()

		if _, err := tmpFile.Write(data); err != nil {
			tmpFile.Close()
			os.Remove(tmpName)
			writeError(w, http.StatusInternalServerError, "failed to write file")
			return
		}
		tmpFile.Close()

		if err := os.Rename(tmpName, destPath); err != nil {
			os.Remove(tmpName)
			writeError(w, http.StatusInternalServerError, "failed to save file")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"path": destPath})
	})
}
