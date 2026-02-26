package git

import (
	"errors"
	"strings"
	"testing"
)

// mockCommandRunner はテスト用の CommandRunner モック。
type mockCommandRunner struct {
	output []byte
	err    error

	// 呼び出し記録
	calledDir  string
	calledArgs []string
}

func (m *mockCommandRunner) RunInDir(dir string, args ...string) ([]byte, error) {
	m.calledDir = dir
	m.calledArgs = args
	return m.output, m.err
}

// multiMockCommandRunner は複数の呼び出しに対して異なるレスポンスを返すモック。
type multiMockCommandRunner struct {
	calls    []mockCall
	callIdx  int
	fallback mockCall
}

type mockCall struct {
	output []byte
	err    error
}

func (m *multiMockCommandRunner) RunInDir(dir string, args ...string) ([]byte, error) {
	if m.callIdx < len(m.calls) {
		call := m.calls[m.callIdx]
		m.callIdx++
		return call.output, call.err
	}
	return m.fallback.output, m.fallback.err
}

func TestGit_Status(t *testing.T) {
	tests := []struct {
		name       string
		output     string
		err        error
		wantBranch string
		wantFiles  int
		wantErr    bool
	}{
		{
			name:       "正常系: ファイル変更あり",
			output:     "## main...origin/main\n M file.go\nA  new.go\n",
			wantBranch: "main",
			wantFiles:  2,
		},
		{
			name:       "正常系: 変更なし",
			output:     "## develop\n",
			wantBranch: "develop",
			wantFiles:  0,
		},
		{
			name:    "異常系: git リポジトリでない",
			err:     ErrNotGitRepo,
			wantErr: true,
		},
		{
			name:    "異常系: コマンドエラー",
			err:     errors.New("command failed"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			result, err := g.Status("/test/dir")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result.Branch != tt.wantBranch {
				t.Errorf("Branch = %q, want %q", result.Branch, tt.wantBranch)
			}
			if len(result.Files) != tt.wantFiles {
				t.Errorf("len(Files) = %d, want %d", len(result.Files), tt.wantFiles)
			}

			// コマンド引数の確認
			if mock.calledDir != "/test/dir" {
				t.Errorf("dir = %q, want %q", mock.calledDir, "/test/dir")
			}
			if !containsAll(mock.calledArgs, "status", "--porcelain=v1", "-b") {
				t.Errorf("args = %v, want to contain status --porcelain=v1 -b", mock.calledArgs)
			}
		})
	}
}

func TestGit_Log(t *testing.T) {
	tests := []struct {
		name      string
		branch    string
		limit     int
		output    string
		err       error
		wantCount int
		wantErr   bool
		wantArgs  []string
	}{
		{
			name:      "正常系: デフォルトブランチ",
			limit:     50,
			output:    "abc1234\tJohn\t2025-01-15T10:30:00+09:00\tFix bug\tHEAD -> main\n",
			wantCount: 1,
			wantArgs:  []string{"log", "-n", "50"},
		},
		{
			name:      "正常系: ブランチ指定",
			branch:    "feature/login",
			limit:     10,
			output:    "abc1234\tJohn\t2025-01-15T10:30:00+09:00\tFix bug\t\n",
			wantCount: 1,
			wantArgs:  []string{"log", "-n", "10", "feature/login"},
		},
		{
			name:      "正常系: limit が 0 の場合デフォルト50",
			limit:     0,
			output:    "",
			wantCount: 0,
			wantArgs:  []string{"log", "-n", "50"},
		},
		{
			name:    "異常系: エラー",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			entries, err := g.Log("/test/dir", tt.branch, tt.limit)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(entries) != tt.wantCount {
				t.Errorf("len(entries) = %d, want %d", len(entries), tt.wantCount)
			}

			if tt.wantArgs != nil {
				for _, wantArg := range tt.wantArgs {
					if !containsStr(mock.calledArgs, wantArg) {
						t.Errorf("args = %v, should contain %q", mock.calledArgs, wantArg)
					}
				}
			}
		})
	}
}

func TestGit_Diff(t *testing.T) {
	tests := []struct {
		name     string
		commit   string
		path     string
		output   string
		err      error
		wantDiff string
		wantErr  bool
	}{
		{
			name:     "正常系: ワーキングツリーの差分",
			output:   "diff --git a/file.go b/file.go\n+new line\n",
			wantDiff: "diff --git a/file.go b/file.go\n+new line\n",
		},
		{
			name:     "正常系: コミット指定の差分",
			commit:   "abc1234",
			output:   "diff --git a/file.go b/file.go\n-old line\n+new line\n",
			wantDiff: "diff --git a/file.go b/file.go\n-old line\n+new line\n",
		},
		{
			name:     "正常系: パス指定の差分",
			path:     "file.go",
			output:   "+added line\n",
			wantDiff: "+added line\n",
		},
		{
			name:    "異常系: エラー",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			diff, err := g.Diff("/test/dir", tt.commit, tt.path)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if diff != tt.wantDiff {
				t.Errorf("diff = %q, want %q", diff, tt.wantDiff)
			}
		})
	}
}

func TestGit_Diff_FallbackOnError(t *testing.T) {
	// ワーキングツリーの差分で HEAD が無い場合、diff --cached にフォールバック
	mock := &multiMockCommandRunner{
		calls: []mockCall{
			{err: errors.New("no HEAD")},                       // git diff HEAD 失敗
			{output: []byte("cached diff\n"), err: nil}, // git diff --cached 成功
		},
	}
	g := &Git{Cmd: mock}

	diff, err := g.Diff("/test/dir", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if diff != "cached diff\n" {
		t.Errorf("diff = %q, want %q", diff, "cached diff\n")
	}
}

func TestGit_CommitFiles(t *testing.T) {
	tests := []struct {
		name      string
		output    string
		err       error
		wantCount int
		wantErr   bool
	}{
		{
			name:      "正常系: ファイル一覧",
			output:    "M\tfile.go\nA\tnew.go\nD\told.go\n",
			wantCount: 3,
		},
		{
			name:      "正常系: 空の出力",
			output:    "",
			wantCount: 0,
		},
		{
			name:    "異常系: エラー",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			files, err := g.CommitFiles("/test/dir", "abc1234")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(files) != tt.wantCount {
				t.Errorf("len(files) = %d, want %d", len(files), tt.wantCount)
			}

			// diff-tree 引数の確認
			if !containsStr(mock.calledArgs, "diff-tree") {
				t.Errorf("args = %v, should contain diff-tree", mock.calledArgs)
			}
		})
	}
}

func TestGit_Branches(t *testing.T) {
	tests := []struct {
		name      string
		output    string
		err       error
		wantCount int
		wantErr   bool
	}{
		{
			name:      "正常系: ブランチ一覧",
			output:    "* main\n  develop\n  remotes/origin/main\n",
			wantCount: 3,
		},
		{
			name:      "正常系: 空の出力",
			output:    "",
			wantCount: 0,
		},
		{
			name:    "異常系: エラー",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			branches, err := g.Branches("/test/dir")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(branches) != tt.wantCount {
				t.Errorf("len(branches) = %d, want %d", len(branches), tt.wantCount)
			}
		})
	}
}

func TestGit_ListWorktrees(t *testing.T) {
	tests := []struct {
		name      string
		output    string
		err       error
		wantCount int
		wantErr   bool
	}{
		{
			name: "正常系: 複数の worktree",
			output: "worktree /home/user/projects/myapp\n" +
				"HEAD abc1234def5678901234567890123456789abcde\n" +
				"branch refs/heads/main\n\n" +
				"worktree /home/user/projects/myapp-feature\n" +
				"HEAD def5678abc1234567890123456789012345678901\n" +
				"branch refs/heads/feature/login\n\n",
			wantCount: 2,
		},
		{
			name:      "正常系: 空の出力",
			output:    "",
			wantCount: 0,
		},
		{
			name:    "異常系: コマンドエラー",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(tt.output),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			worktrees, err := g.ListWorktrees("/test/dir")
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(worktrees) != tt.wantCount {
				t.Errorf("len(worktrees) = %d, want %d", len(worktrees), tt.wantCount)
			}

			// コマンド引数の確認
			if mock.calledDir != "/test/dir" {
				t.Errorf("dir = %q, want %q", mock.calledDir, "/test/dir")
			}
			if !containsAll(mock.calledArgs, "worktree", "list", "--porcelain") {
				t.Errorf("args = %v, want to contain worktree list --porcelain", mock.calledArgs)
			}
		})
	}
}

func TestGit_AddWorktree(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		branch     string
		create     bool
		err        error
		wantErr    bool
		wantArgs   []string
		noWantArgs []string
	}{
		{
			name:     "正常系: 既存ブランチで worktree 追加",
			path:     "/home/user/projects/myapp-feature",
			branch:   "feature/login",
			create:   false,
			wantArgs: []string{"worktree", "add", "/home/user/projects/myapp-feature", "feature/login"},
		},
		{
			name:     "正常系: 新規ブランチ作成で worktree 追加",
			path:     "/home/user/projects/myapp-new",
			branch:   "feature/new",
			create:   true,
			wantArgs: []string{"worktree", "add", "-b", "feature/new", "/home/user/projects/myapp-new"},
		},
		{
			name:    "異常系: コマンドエラー",
			path:    "/home/user/projects/myapp-err",
			branch:  "main",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(""),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			err := g.AddWorktree("/test/dir", tt.path, tt.branch, tt.create)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// コマンド引数の確認
			if mock.calledDir != "/test/dir" {
				t.Errorf("dir = %q, want %q", mock.calledDir, "/test/dir")
			}
			if tt.wantArgs != nil {
				for _, wantArg := range tt.wantArgs {
					if !containsStr(mock.calledArgs, wantArg) {
						t.Errorf("args = %v, should contain %q", mock.calledArgs, wantArg)
					}
				}
			}
		})
	}
}

func TestGit_AddWorktree_CreateFlagArgs(t *testing.T) {
	// create=true の場合: git worktree add -b <branch> <path>
	mock := &mockCommandRunner{output: []byte(""), err: nil}
	g := &Git{Cmd: mock}

	err := g.AddWorktree("/test/dir", "/tmp/wt", "new-branch", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// -b フラグが含まれていることを確認
	if !containsExact(mock.calledArgs, "-b") {
		t.Errorf("args = %v, should contain -b for create=true", mock.calledArgs)
	}

	// create=false の場合: git worktree add <path> <branch>
	mock2 := &mockCommandRunner{output: []byte(""), err: nil}
	g2 := &Git{Cmd: mock2}

	err = g2.AddWorktree("/test/dir", "/tmp/wt", "mybranch", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// -b フラグが含まれていないことを確認
	if containsExact(mock2.calledArgs, "-b") {
		t.Errorf("args = %v, should not contain -b for create=false", mock2.calledArgs)
	}
}

func TestGit_RemoveWorktree(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		err     error
		wantErr bool
	}{
		{
			name: "正常系: worktree 削除",
			path: "/home/user/projects/myapp-feature",
		},
		{
			name:    "異常系: コマンドエラー",
			path:    "/home/user/projects/myapp-err",
			err:     errors.New("git error"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockCommandRunner{
				output: []byte(""),
				err:    tt.err,
			}
			g := &Git{Cmd: mock}

			err := g.RemoveWorktree("/test/dir", tt.path)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// コマンド引数の確認
			if mock.calledDir != "/test/dir" {
				t.Errorf("dir = %q, want %q", mock.calledDir, "/test/dir")
			}
			if !containsAll(mock.calledArgs, "worktree", "remove", tt.path) {
				t.Errorf("args = %v, want to contain worktree remove %s", mock.calledArgs, tt.path)
			}
		})
	}
}

func TestErrNotGitRepo(t *testing.T) {
	if !errors.Is(ErrNotGitRepo, ErrNotGitRepo) {
		t.Error("ErrNotGitRepo should be detectable with errors.Is")
	}
}

// containsAll はスライスにすべての文字列が含まれるか確認する。
func containsAll(slice []string, targets ...string) bool {
	for _, target := range targets {
		if !containsStr(slice, target) {
			return false
		}
	}
	return true
}

// containsStr はスライスに文字列が含まれるか確認する（部分一致）。
func containsStr(slice []string, target string) bool {
	for _, s := range slice {
		if strings.Contains(s, target) {
			return true
		}
	}
	return false
}

// containsExact はスライスに文字列が完全一致で含まれるか確認する。
func containsExact(slice []string, target string) bool {
	for _, s := range slice {
		if s == target {
			return true
		}
	}
	return false
}
