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

func TestHandleCloneGhqRepo(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		cloneRepo  *tmux.GhqRepo
		cloneErr   error
		wantStatus int
	}{
		{
			name: "正常系: 201を返す",
			body: `{"url": "https://github.com/alice/utils"}`,
			cloneRepo: &tmux.GhqRepo{
				Name:     "utils",
				Path:     "github.com/alice/utils",
				FullPath: "/home/user/ghq/github.com/alice/utils",
			},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "空URL: 400を返す",
			body:       `{"url": ""}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "ボディなし: 400を返す",
			body:       "",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "clone 失敗: 500を返す",
			body:       `{"url": "https://github.com/invalid/repo"}`,
			cloneErr:   errors.New("clone failed"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				cloneGhqRepo:    tt.cloneRepo,
				cloneGhqRepoErr: tt.cloneErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/ghq/repos", token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusCreated {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result tmux.GhqRepo
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result.Name != tt.cloneRepo.Name {
					t.Errorf("result.Name = %q, want %q", result.Name, tt.cloneRepo.Name)
				}
			}
		})
	}
}

func TestHandleDeleteGhqRepo(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		deleteErr  error
		wantStatus int
	}{
		{
			name:       "正常系: 204を返す",
			path:       "/home/user/ghq/github.com/alice/utils",
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "パスなし: 400を返す",
			path:       "",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "削除失敗: 500を返す",
			path:       "/home/user/ghq/github.com/invalid/repo",
			deleteErr:  errors.New("delete failed"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				deleteGhqRepoErr: tt.deleteErr,
			}
			srv, token := newTestServer(mock)

			url := "/api/ghq/repos"
			if tt.path != "" {
				url += "?path=" + tt.path
			}
			rec := doRequest(t, srv.Handler(), http.MethodDelete, url, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusNoContent {
				if mock.calledDeleteGhqRepo != tt.path {
					t.Errorf("DeleteGhqRepo called with %q, want %q", mock.calledDeleteGhqRepo, tt.path)
				}
				if rec.Body.Len() != 0 {
					t.Errorf("body should be empty for 204, got %q", rec.Body.String())
				}
			}
		})
	}
}

func TestHandleCloneGhqRepo_WithBasePath(t *testing.T) {
	mock := &configurableMock{
		cloneGhqRepo: &tmux.GhqRepo{
			Name:     "utils",
			Path:     "github.com/alice/utils",
			FullPath: "/home/user/ghq/github.com/alice/utils",
		},
	}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodPost, "/palmux/api/ghq/repos", token, `{"url": "https://github.com/alice/utils"}`)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if mock.calledCloneGhqRepo != "https://github.com/alice/utils" {
		t.Errorf("CloneGhqRepo called with %q, want %q", mock.calledCloneGhqRepo, "https://github.com/alice/utils")
	}
}

func TestHandleDeleteGhqRepo_WithBasePath(t *testing.T) {
	mock := &configurableMock{}

	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/palmux/",
	})

	rec := doRequest(t, srv.Handler(), http.MethodDelete, "/palmux/api/ghq/repos?path=/home/user/ghq/github.com/alice/utils", token, "")

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	if mock.calledDeleteGhqRepo != "/home/user/ghq/github.com/alice/utils" {
		t.Errorf("DeleteGhqRepo called with %q, want %q", mock.calledDeleteGhqRepo, "/home/user/ghq/github.com/alice/utils")
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
