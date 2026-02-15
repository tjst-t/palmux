package server

import (
	"net/http"
	"strings"
)

// AuthMiddleware は Bearer token による認証ミドルウェアを返す。
// Authorization ヘッダーが "Bearer <token>" 形式で、
// 指定されたトークンと一致する場合のみ次のハンドラに委譲する。
// 不正な場合は 401 Unauthorized を返す。
func AuthMiddleware(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")

			// "Bearer " プレフィックスを検証（大文字小文字を区別する）
			if !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			// "Bearer " 以降のトークンを取得
			reqToken := authHeader[len("Bearer "):]

			if reqToken == "" || reqToken != token {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
