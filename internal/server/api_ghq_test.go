package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleListGhqRepos(t *testing.T) {
	tests := []struct {
		name       string
		repos      []tmux.GhqRepo
		reposErr   error
		wantStatus int
	}{
		{
			name: "repos を正常に返す",
			repos: []tmux.GhqRepo{
				{Name: "palmux", Path: "github.com/tjst-t/palmux", FullPath: "/home/user/ghq/github.com/tjst-t/palmux"},
				{Name: "go", Path: "github.com/golang/go", FullPath: "/home/user/ghq/github.com/golang/go"},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "空配列を返す",
			repos:      []tmux.GhqRepo{},
			wantStatus: http.StatusOK,
		},
		{
			name:       "nil の場合: 空配列を返す",
			repos:      nil,
			wantStatus: http.StatusOK,
		},
		{
			name:       "エラー時に 500 を返す",
			reposErr:   errors.New("ghq not found"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				ghqRepos:    tt.repos,
				ghqReposErr: tt.reposErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/ghq/repos", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result []tmux.GhqRepo
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				wantLen := len(tt.repos)
				if tt.repos == nil {
					wantLen = 0
				}
				if len(result) != wantLen {
					t.Errorf("result length = %d, want %d", len(result), wantLen)
				}

				if tt.repos != nil && len(tt.repos) > 0 {
					if result[0].Name != tt.repos[0].Name {
						t.Errorf("result[0].Name = %q, want %q", result[0].Name, tt.repos[0].Name)
					}
					if result[0].Path != tt.repos[0].Path {
						t.Errorf("result[0].Path = %q, want %q", result[0].Path, tt.repos[0].Path)
					}
					if result[0].FullPath != tt.repos[0].FullPath {
						t.Errorf("result[0].FullPath = %q, want %q", result[0].FullPath, tt.repos[0].FullPath)
					}
				}
			}

			if tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
				var errResp map[string]string
				if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
					t.Fatalf("failed to decode error response: %v", err)
				}
				if errResp["error"] == "" {
					t.Error("error response should contain 'error' field")
				}
			}

			if !mock.calledListGhqRepos {
				t.Error("ListGhqRepos was not called")
			}
		})
	}
}

func TestHandleListGhqRepos_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		ghqRepos: []tmux.GhqRepo{
			{Name: "palmux", Path: "github.com/tjst-t/palmux", FullPath: "/home/user/ghq/github.com/tjst-t/palmux"},
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/palmux/api/ghq/repos", token, "")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !mock.calledListGhqRepos {
		t.Error("ListGhqRepos was not called")
	}
}
