package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthMiddleware(t *testing.T) {
	const validToken = "test-secret-token-12345"

	// innerHandler は認証成功時に呼ばれるダミーハンドラ。
	// 200 OK を返し、ボディに "ok" を書き込む。
	innerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	tests := []struct {
		name       string
		token      string
		authHeader string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "正しいトークン: 200を返しハンドラに委譲",
			token:      validToken,
			authHeader: "Bearer " + validToken,
			wantStatus: http.StatusOK,
			wantBody:   "ok",
		},
		{
			name:       "トークンなし: 401を返す",
			token:      validToken,
			authHeader: "",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "不正トークン: 401を返す",
			token:      validToken,
			authHeader: "Bearer wrong-token",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "Bearer以外のスキーム(Basic): 401を返す",
			token:      validToken,
			authHeader: "Basic dXNlcjpwYXNz",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "Bearer以外のスキーム(Token): 401を返す",
			token:      validToken,
			authHeader: "Token " + validToken,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "Bearerのみでトークンが空: 401を返す",
			token:      validToken,
			authHeader: "Bearer ",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "bearerの小文字: 401を返す",
			token:      validToken,
			authHeader: "bearer " + validToken,
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "Bearerキーワードのみ(スペースなし): 401を返す",
			token:      validToken,
			authHeader: "Bearer",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware := AuthMiddleware(tt.token)
			handler := middleware(innerHandler)

			req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

func TestAuthMiddleware_DoesNotCallNextOnFailure(t *testing.T) {
	const validToken = "secret"

	called := false
	innerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := AuthMiddleware(validToken)
	handler := middleware(innerHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	req.Header.Set("Authorization", "Bearer wrong")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if called {
		t.Error("inner handler should not be called when authentication fails")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestAuthMiddleware_CallsNextOnSuccess(t *testing.T) {
	const validToken = "secret"

	called := false
	innerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	middleware := AuthMiddleware(validToken)
	handler := middleware(innerHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Error("inner handler should be called when authentication succeeds")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestAuthMiddleware_QueryParamToken(t *testing.T) {
	const validToken = "test-secret-token-12345"

	innerHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	tests := []struct {
		name       string
		queryToken string
		authHeader string
		wantStatus int
		wantBody   string
	}{
		{
			name:       "クエリパラメータのトークンのみ: 200を返しハンドラに委譲",
			queryToken: validToken,
			authHeader: "",
			wantStatus: http.StatusOK,
			wantBody:   "ok",
		},
		{
			name:       "不正なクエリパラメータトークン: 401を返す",
			queryToken: "wrong-token",
			authHeader: "",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "空のクエリパラメータトークン: 401を返す",
			queryToken: "",
			authHeader: "",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
		{
			name:       "Authorizationヘッダーが優先される: ヘッダー正しい場合は200",
			queryToken: "wrong-token",
			authHeader: "Bearer " + validToken,
			wantStatus: http.StatusOK,
			wantBody:   "ok",
		},
		{
			name:       "Authorizationヘッダーが優先される: ヘッダー不正でもクエリ正しい場合は401",
			queryToken: validToken,
			authHeader: "Bearer wrong-token",
			wantStatus: http.StatusUnauthorized,
			wantBody:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			middleware := AuthMiddleware(validToken)
			handler := middleware(innerHandler)

			url := "/api/sessions"
			if tt.queryToken != "" {
				url += "?token=" + tt.queryToken
			}
			req := httptest.NewRequest(http.MethodGet, url, nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}

			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}
