package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/tjst-t/palmux/internal/git"
	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleListProjectWorktrees(t *testing.T) {
	tests := []struct {
		name       string
		project    string
		worktrees  []tmux.ProjectWorktree
		err        error
		wantStatus int
	}{
		{
			name:    "ワークツリー一覧を返す",
			project: "palmux",
			worktrees: []tmux.ProjectWorktree{
				{Branch: "main", Path: "/home/user/ghq/github.com/tjst-t/palmux", Head: "abc1234", HasSession: true, SessionName: "palmux", IsDefault: true},
				{Branch: "feature-x", Path: "/home/user/ghq/github.com/tjst-t/palmux/.palmux-worktrees/feature-x", Head: "def5678", HasSession: false, SessionName: "palmux@feature-x", IsDefault: false},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "エラー時は500を返す",
			project:    "palmux",
			err:        errors.New("git command runner is not configured"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				projectWorktrees:    tt.worktrees,
				projectWorktreesErr: tt.err,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/projects/"+tt.project+"/worktrees", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result []tmux.ProjectWorktree
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if len(result) != len(tt.worktrees) {
					t.Errorf("result length = %d, want %d", len(result), len(tt.worktrees))
				}

				if len(result) > 0 {
					if result[0].Branch != tt.worktrees[0].Branch {
						t.Errorf("result[0].Branch = %q, want %q", result[0].Branch, tt.worktrees[0].Branch)
					}
					if result[0].IsDefault != tt.worktrees[0].IsDefault {
						t.Errorf("result[0].IsDefault = %v, want %v", result[0].IsDefault, tt.worktrees[0].IsDefault)
					}
				}
			}

			if mock.calledListProjectWorktrees != tt.project {
				t.Errorf("ListProjectWorktrees called with %q, want %q", mock.calledListProjectWorktrees, tt.project)
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
		})
	}
}

func TestHandleCreateProjectWorktree(t *testing.T) {
	tests := []struct {
		name       string
		project    string
		body       string
		session    *tmux.Session
		err        error
		wantStatus int
	}{
		{
			name:       "ワークツリーセッションを作成する",
			project:    "palmux",
			body:       `{"branch": "feature-x", "create_branch": false}`,
			session:    &tmux.Session{Name: "palmux@feature-x", Windows: 1},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "新しいブランチを作成する",
			project:    "palmux",
			body:       `{"branch": "new-feature", "create_branch": true}`,
			session:    &tmux.Session{Name: "palmux@new-feature", Windows: 1},
			wantStatus: http.StatusCreated,
		},
		{
			name:       "branchが空の場合: 400を返す",
			project:    "palmux",
			body:       `{"branch": ""}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "不正なJSON: 400を返す",
			project:    "palmux",
			body:       `{invalid`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "tmuxエラー: 500を返す",
			project:    "palmux",
			body:       `{"branch": "feature-x"}`,
			err:        errors.New("project not found"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				newWorktreeSession:    tt.session,
				newWorktreeSessionErr: tt.err,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/projects/"+tt.project+"/worktrees", token, tt.body)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusCreated {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result tmux.Session
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if result.Name != tt.session.Name {
					t.Errorf("result.Name = %q, want %q", result.Name, tt.session.Name)
				}

				if mock.calledNewWorktreeSession.project != tt.project {
					t.Errorf("NewWorktreeSession project = %q, want %q", mock.calledNewWorktreeSession.project, tt.project)
				}
			}

			if tt.wantStatus == http.StatusBadRequest {
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
		})
	}
}

func TestHandleCreateProjectWorktree_GhqSession_CreatesClaudeWindow(t *testing.T) {
	mock := &configurableMock{
		newWorktreeSession: &tmux.Session{Name: "palmux@feature-x", Windows: 1},
		isGhqSession:       true,
		ensureClaudeWindow: &tmux.Window{Index: 1, Name: "claude"},
	}
	srv, token := newTestServer(mock)
	rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/projects/palmux/worktrees", token, `{"branch": "feature-x"}`)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if mock.calledEnsureClaudeWindow.session != "palmux@feature-x" {
		t.Errorf("EnsureClaudeWindow session = %q, want %q", mock.calledEnsureClaudeWindow.session, "palmux@feature-x")
	}
}

func TestHandleDeleteProjectWorktree(t *testing.T) {
	tests := []struct {
		name            string
		project         string
		branch          string
		removeWorktree  bool
		err             error
		wantStatus      int
		wantSessionName string
	}{
		{
			name:            "ワークツリーセッションを削除する: 204を返す",
			project:         "palmux",
			branch:          "feature-x",
			removeWorktree:  false,
			wantStatus:      http.StatusNoContent,
			wantSessionName: "palmux@feature-x",
		},
		{
			name:            "remove_worktree=trueでworktreeも削除する",
			project:         "palmux",
			branch:          "feature-x",
			removeWorktree:  true,
			wantStatus:      http.StatusNoContent,
			wantSessionName: "palmux@feature-x",
		},
		{
			name:            "tmuxエラー: 500を返す",
			project:         "palmux",
			branch:          "feature-x",
			err:             errors.New("session not found"),
			wantStatus:      http.StatusInternalServerError,
			wantSessionName: "palmux@feature-x",
		},
		{
			name:            "スラッシュ付きブランチ名: feature/loginを正しく処理する",
			project:         "palmux",
			branch:          "feature/login",
			removeWorktree:  false,
			wantStatus:      http.StatusNoContent,
			wantSessionName: "palmux@feature/login",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				deleteWorktreeSessionErr: tt.err,
			}
			srv, token := newTestServer(mock)

			path := "/api/projects/" + tt.project + "/worktrees/" + tt.branch
			if tt.removeWorktree {
				path += "?remove_worktree=true"
			}
			rec := doRequest(t, srv.Handler(), http.MethodDelete, path, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusNoContent {
				if mock.calledDeleteWorktreeSession.sessionName != tt.wantSessionName {
					t.Errorf("DeleteWorktreeSession sessionName = %q, want %q", mock.calledDeleteWorktreeSession.sessionName, tt.wantSessionName)
				}
				if mock.calledDeleteWorktreeSession.removeWorktree != tt.removeWorktree {
					t.Errorf("DeleteWorktreeSession removeWorktree = %v, want %v", mock.calledDeleteWorktreeSession.removeWorktree, tt.removeWorktree)
				}

				if rec.Body.Len() != 0 {
					t.Errorf("body should be empty for 204, got %q", rec.Body.String())
				}
			}

			if tt.wantStatus == http.StatusInternalServerError {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}
			}
		})
	}
}

func TestHandleIsProjectBranchMerged(t *testing.T) {
	tests := []struct {
		name       string
		project    string
		branch     string
		merged     bool
		err        error
		wantStatus int
	}{
		{
			name:       "マージ済みブランチ: merged=true を返す",
			project:    "palmux",
			branch:     "feature-x",
			merged:     true,
			wantStatus: http.StatusOK,
		},
		{
			name:       "未マージブランチ: merged=false を返す",
			project:    "palmux",
			branch:     "feature-y",
			merged:     false,
			wantStatus: http.StatusOK,
		},
		{
			name:       "エラー時は500を返す",
			project:    "palmux",
			branch:     "feature-z",
			err:        errors.New("git error"),
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "スラッシュ付きブランチ名",
			project:    "palmux",
			branch:     "feature/login",
			merged:     true,
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				isBranchMerged:    tt.merged,
				isBranchMergedErr: tt.err,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/projects/"+tt.project+"/branch-merged/"+tt.branch, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result map[string]bool
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}
				if result["merged"] != tt.merged {
					t.Errorf("merged = %v, want %v", result["merged"], tt.merged)
				}
			}

			if mock.calledIsProjectBranchMerged.project != tt.project {
				t.Errorf("IsProjectBranchMerged project = %q, want %q", mock.calledIsProjectBranchMerged.project, tt.project)
			}
			if mock.calledIsProjectBranchMerged.branch != tt.branch {
				t.Errorf("IsProjectBranchMerged branch = %q, want %q", mock.calledIsProjectBranchMerged.branch, tt.branch)
			}
		})
	}
}

func TestHandleDeleteProjectBranch(t *testing.T) {
	tests := []struct {
		name       string
		project    string
		branch     string
		force      bool
		err        error
		wantStatus int
	}{
		{
			name:       "ブランチ削除: 204を返す",
			project:    "palmux",
			branch:     "feature-x",
			force:      false,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "force=trueで強制削除",
			project:    "palmux",
			branch:     "feature-x",
			force:      true,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "スラッシュ付きブランチ名",
			project:    "palmux",
			branch:     "feature/login",
			force:      false,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "エラー時は500を返す",
			project:    "palmux",
			branch:     "feature-x",
			err:        errors.New("delete failed"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				deleteProjectBranchErr: tt.err,
			}
			srv, token := newTestServer(mock)

			path := "/api/projects/" + tt.project + "/branches/" + tt.branch
			if tt.force {
				path += "?force=true"
			}
			rec := doRequest(t, srv.Handler(), http.MethodDelete, path, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusNoContent {
				if mock.calledDeleteProjectBranch.project != tt.project {
					t.Errorf("DeleteProjectBranch project = %q, want %q", mock.calledDeleteProjectBranch.project, tt.project)
				}
				if mock.calledDeleteProjectBranch.branch != tt.branch {
					t.Errorf("DeleteProjectBranch branch = %q, want %q", mock.calledDeleteProjectBranch.branch, tt.branch)
				}
				if mock.calledDeleteProjectBranch.force != tt.force {
					t.Errorf("DeleteProjectBranch force = %v, want %v", mock.calledDeleteProjectBranch.force, tt.force)
				}
				if rec.Body.Len() != 0 {
					t.Errorf("body should be empty for 204, got %q", rec.Body.String())
				}
			}
		})
	}
}

func TestHandleListProjectBranches(t *testing.T) {
	tests := []struct {
		name       string
		project    string
		branches   []git.Branch
		err        error
		wantStatus int
	}{
		{
			name:    "ブランチ一覧を返す",
			project: "palmux",
			branches: []git.Branch{
				{Name: "main", Current: true, Remote: false},
				{Name: "develop", Current: false, Remote: false},
				{Name: "remotes/origin/main", Current: false, Remote: true},
			},
			wantStatus: http.StatusOK,
		},
		{
			name:       "エラー時は500を返す",
			project:    "palmux",
			err:        errors.New("git command runner is not configured"),
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				projectBranches:    tt.branches,
				projectBranchesErr: tt.err,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/projects/"+tt.project+"/branches", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			if tt.wantStatus == http.StatusOK {
				ct := rec.Header().Get("Content-Type")
				if !strings.Contains(ct, "application/json") {
					t.Errorf("Content-Type = %q, want application/json", ct)
				}

				var result []git.Branch
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if len(result) != len(tt.branches) {
					t.Errorf("result length = %d, want %d", len(result), len(tt.branches))
				}

				if len(result) > 0 {
					if result[0].Name != tt.branches[0].Name {
						t.Errorf("result[0].Name = %q, want %q", result[0].Name, tt.branches[0].Name)
					}
					if result[0].Current != tt.branches[0].Current {
						t.Errorf("result[0].Current = %v, want %v", result[0].Current, tt.branches[0].Current)
					}
				}
			}

			if mock.calledGetProjectBranches != tt.project {
				t.Errorf("GetProjectBranches called with %q, want %q", mock.calledGetProjectBranches, tt.project)
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
		})
	}
}
