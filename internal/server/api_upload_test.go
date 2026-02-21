package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// doMultipartRequest はテスト用のマルチパートリクエストを実行するヘルパー。
func doMultipartRequest(t *testing.T, handler http.Handler, path, token, fieldName, fileName string, content []byte) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	if fieldName != "" {
		part, err := writer.CreateFormFile(fieldName, fileName)
		if err != nil {
			t.Fatalf("failed to create form file: %v", err)
		}
		if _, err := part.Write(content); err != nil {
			t.Fatalf("failed to write content: %v", err)
		}
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// pngHeader は最小限の有効な PNG ファイルヘッダー。
var pngHeader = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
	0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
	0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
	0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
	0x44, 0xAE, 0x42, 0x60, 0x82,
}

// jpegHeader は最小限の有効な JPEG ファイルヘッダー。
var jpegHeader = []byte{
	0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
	0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
	0x00, 0x01, 0x00, 0x00,
}

// gifHeader は最小限の有効な GIF ファイルヘッダー。
var gifHeader = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
	0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, // 1x1, no GCT
	0x3B, // trailer
}

// webpHeader は最小限の有効な WebP ファイルヘッダー。
var webpHeader = []byte{
	0x52, 0x49, 0x46, 0x46, // RIFF
	0x24, 0x00, 0x00, 0x00, // file size
	0x57, 0x45, 0x42, 0x50, // WEBP
	0x56, 0x50, 0x38, 0x20, // VP8
	0x18, 0x00, 0x00, 0x00, // chunk size
	0x30, 0x01, 0x00, 0x9D, 0x01, 0x2A, 0x01, 0x00,
	0x01, 0x00, 0x01, 0x40, 0x25, 0xA4, 0x00, 0x03,
	0x70, 0x00, 0xFE, 0xFB, 0x94, 0x00, 0x00,
}

func TestHandleUploadImage(t *testing.T) {
	tests := []struct {
		name       string
		token      string
		fieldName  string
		fileName   string
		content    []byte
		wantStatus int
		wantExt    string // 期待する拡張子（成功時のみ）
		wantError  string // エラーメッセージの部分文字列（エラー時のみ）
	}{
		{
			name:       "PNG の正常アップロード",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "screenshot.png",
			content:    pngHeader,
			wantStatus: http.StatusOK,
			wantExt:    ".png",
		},
		{
			name:       "JPEG の正常アップロード",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "photo.jpg",
			content:    jpegHeader,
			wantStatus: http.StatusOK,
			wantExt:    ".jpg",
		},
		{
			name:       "GIF の正常アップロード",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "anim.gif",
			content:    gifHeader,
			wantStatus: http.StatusOK,
			wantExt:    ".gif",
		},
		{
			name:       "WebP の正常アップロード",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "image.webp",
			content:    webpHeader,
			wantStatus: http.StatusOK,
			wantExt:    ".webp",
		},
		{
			name:       "非画像ファイル（テキスト）は 400",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "readme.txt",
			content:    []byte("Hello, world!"),
			wantStatus: http.StatusBadRequest,
			wantError:  "unsupported image type",
		},
		{
			name:       "非画像ファイル（ELF バイナリ）は 400",
			token:      "test-token",
			fieldName:  "file",
			fileName:   "binary",
			content:    []byte{0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00},
			wantStatus: http.StatusBadRequest,
			wantError:  "unsupported image type",
		},
		{
			name:       "file フィールドなしは 400",
			token:      "test-token",
			fieldName:  "",
			fileName:   "",
			content:    nil,
			wantStatus: http.StatusBadRequest,
			wantError:  "file field is required",
		},
		{
			name:       "認証なしは 401",
			token:      "",
			fieldName:  "file",
			fileName:   "screenshot.png",
			content:    pngHeader,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "不正トークンは 401",
			token:      "wrong-token",
			fieldName:  "file",
			fileName:   "screenshot.png",
			content:    pngHeader,
			wantStatus: http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{}
			srv, _ := newTestServer(mock)

			rec := doMultipartRequest(t, srv.Handler(), "/api/upload", tt.token, tt.fieldName, tt.fileName, tt.content)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
				return
			}

			if tt.wantStatus == http.StatusOK {
				var resp struct {
					Path string `json:"path"`
				}
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				// パスが /tmp/palmux- で始まることを確認
				if !strings.HasPrefix(resp.Path, "/tmp/palmux-") {
					t.Errorf("path = %q, want prefix /tmp/palmux-", resp.Path)
				}

				// 拡張子を確認
				if !strings.HasSuffix(resp.Path, tt.wantExt) {
					t.Errorf("path = %q, want suffix %q", resp.Path, tt.wantExt)
				}

				// ファイルが実際に存在し内容が一致することを確認
				data, err := os.ReadFile(resp.Path)
				if err != nil {
					t.Fatalf("failed to read uploaded file: %v", err)
				}
				if !bytes.Equal(data, tt.content) {
					t.Errorf("file content mismatch: got %d bytes, want %d bytes", len(data), len(tt.content))
				}

				// テスト後にクリーンアップ
				os.Remove(resp.Path)
			}

			if tt.wantError != "" {
				body := rec.Body.String()
				if !strings.Contains(body, tt.wantError) {
					t.Errorf("body = %q, want substring %q", body, tt.wantError)
				}
			}
		})
	}
}

func TestHandleUploadImage_サイズ超過(t *testing.T) {
	mock := &configurableMock{}
	srv, _ := newTestServer(mock)

	// 11MB のデータを作成（制限は 10MB）
	bigContent := make([]byte, 11*1024*1024)
	// PNG ヘッダーを先頭にセット
	copy(bigContent, pngHeader)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "big.png")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(part, bytes.NewReader(bigContent)); err != nil {
		t.Fatalf("failed to write content: %v", err)
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer test-token")

	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
}
