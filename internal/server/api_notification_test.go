package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlePostNotification(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantError  string
	}{
		{
			name:       "正常系: 201 Created",
			body:       `{"session":"main","window_index":1,"type":"stop"}`,
			wantStatus: http.StatusCreated,
		},
		{
			name:       "不正なJSON: 400 Bad Request",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid JSON",
		},
		{
			name:       "session が空: 400 Bad Request",
			body:       `{"session":"","window_index":1,"type":"stop"}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "session is required",
		},
		{
			name:       "type が空: 400 Bad Request",
			body:       `{"session":"main","window_index":1,"type":""}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "type is required",
		},
	}

	s := NewServer(Options{Tmux: &mockTmuxManager{}, Token: "test-token"})

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/notifications", strings.NewReader(tt.body))
			req.Header.Set("Authorization", "Bearer test-token")
			req.Header.Set("Content-Type", "application/json")

			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantError != "" {
				var resp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if resp["error"] != tt.wantError {
					t.Errorf("error = %q, want %q", resp["error"], tt.wantError)
				}
			}
		})
	}
}

func TestHandleDeleteNotification(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantStatus int
		wantError  string
	}{
		{
			name:       "正常系: 204 No Content",
			query:      "?session=main&window=1",
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "session パラメータなし: 400 Bad Request",
			query:      "?window=1",
			wantStatus: http.StatusBadRequest,
			wantError:  "session query parameter is required",
		},
		{
			name:       "window パラメータなし: 400 Bad Request",
			query:      "?session=main",
			wantStatus: http.StatusBadRequest,
			wantError:  "window query parameter is required",
		},
		{
			name:       "window が数値でない: 400 Bad Request",
			query:      "?session=main&window=abc",
			wantStatus: http.StatusBadRequest,
			wantError:  "window must be a number",
		},
	}

	s := NewServer(Options{Tmux: &mockTmuxManager{}, Token: "test-token"})

	// テスト前に通知を1件セットしておく（DELETE の正常系テスト用）
	postReq := httptest.NewRequest(http.MethodPost, "/api/notifications", strings.NewReader(`{"session":"main","window_index":1,"type":"stop"}`))
	postReq.Header.Set("Authorization", "Bearer test-token")
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusCreated {
		t.Fatalf("setup: POST notification failed with status %d", postRec.Code)
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodDelete, "/api/notifications"+tt.query, nil)
			req.Header.Set("Authorization", "Bearer test-token")

			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantError != "" {
				var resp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if resp["error"] != tt.wantError {
					t.Errorf("error = %q, want %q", resp["error"], tt.wantError)
				}
			}
		})
	}
}

func TestHandleGetNotifications(t *testing.T) {
	tests := []struct {
		name            string
		setupBody       string // POST する通知のボディ（空なら何もしない）
		wantStatus      int
		wantLen         int
		wantFirstType   string
		wantFirstSess   string
		wantFirstWindow int
	}{
		{
			name:       "空の場合: 200 + empty array",
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:            "通知あり: 200 + array with notification",
			setupBody:       `{"session":"dev","window_index":2,"type":"error"}`,
			wantStatus:      http.StatusOK,
			wantLen:         1,
			wantFirstType:   "error",
			wantFirstSess:   "dev",
			wantFirstWindow: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// 各テストケースで新しいサーバーを作成（状態を分離）
			s := NewServer(Options{Tmux: &mockTmuxManager{}, Token: "test-token"})

			if tt.setupBody != "" {
				postReq := httptest.NewRequest(http.MethodPost, "/api/notifications", strings.NewReader(tt.setupBody))
				postReq.Header.Set("Authorization", "Bearer test-token")
				postReq.Header.Set("Content-Type", "application/json")
				postRec := httptest.NewRecorder()
				s.Handler().ServeHTTP(postRec, postReq)
				if postRec.Code != http.StatusCreated {
					t.Fatalf("setup: POST notification failed with status %d", postRec.Code)
				}
			}

			req := httptest.NewRequest(http.MethodGet, "/api/notifications", nil)
			req.Header.Set("Authorization", "Bearer test-token")

			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			var notifications []Notification
			if err := json.NewDecoder(rec.Body).Decode(&notifications); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if len(notifications) != tt.wantLen {
				t.Fatalf("notifications length = %d, want %d", len(notifications), tt.wantLen)
			}

			if tt.wantLen > 0 {
				if notifications[0].Type != tt.wantFirstType {
					t.Errorf("type = %q, want %q", notifications[0].Type, tt.wantFirstType)
				}
				if notifications[0].Session != tt.wantFirstSess {
					t.Errorf("session = %q, want %q", notifications[0].Session, tt.wantFirstSess)
				}
				if notifications[0].WindowIndex != tt.wantFirstWindow {
					t.Errorf("window_index = %d, want %d", notifications[0].WindowIndex, tt.wantFirstWindow)
				}
			}
		})
	}
}

func TestHandleNotification_AuthRequired(t *testing.T) {
	s := NewServer(Options{Tmux: &mockTmuxManager{}, Token: "test-token"})

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/notifications"},
		{http.MethodDelete, "/api/notifications?session=main&window=1"},
		{http.MethodGet, "/api/notifications"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path+" 認証なしは401", func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}
