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
			output:    "abc1234\tJohn\t2025-01-15T10:30:00+09:00\tFix bug\n",
			wantCount: 1,
			wantArgs:  []string{"log", "-n", "50"},
		},
		{
			name:      "正常系: ブランチ指定",
			branch:    "feature/login",
			limit:     10,
			output:    "abc1234\tJohn\t2025-01-15T10:30:00+09:00\tFix bug\n",
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
			output:    "* main\n  develop\n  remotes/origin/feature-y\n",
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
