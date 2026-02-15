package server

import (
	"net/http"
	"strings"
)

// AuthMiddleware は Bearer token による認証ミドルウェアを返す。
// Authorization ヘッダーが "Bearer <token>" 形式で、
// 指定されたトークンと一致する場合のみ次のハンドラに委譲する。
// Authorization ヘッダーがない場合はクエリパラメータ "token" をフォールバックとして使用する。
// これは WebSocket 接続時にブラウザ JS からカスタムヘッダーを送れないための対応。
// 不正な場合は 401 Unauthorized を返す。
func AuthMiddleware(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")

			var reqToken string
			if strings.HasPrefix(authHeader, "Bearer ") {
				// "Bearer " 以降のトークンを取得
				reqToken = authHeader[len("Bearer "):]
			} else if authHeader == "" {
				// フォールバック: クエリパラメータ（WebSocket 接続用）
				reqToken = r.URL.Query().Get("token")
			}

			if reqToken == "" || reqToken != token {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
