package git

import (
	"os"
	"testing"
)

func readTestdata(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("failed to read testdata/%s: %v", name, err)
	}
	return string(data)
}

func TestParseStatus(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantBranch string
		wantFiles  int
	}{
		{
			name:       "フィクスチャファイルからパース",
			input:      readTestdata(t, "status_porcelain.txt"),
			wantBranch: "main",
			wantFiles:  6,
		},
		{
			name:       "変更なしのステータス",
			input:      readTestdata(t, "status_empty.txt"),
			wantBranch: "main",
			wantFiles:  0,
		},
		{
			name:       "空の出力",
			input:      "",
			wantBranch: "",
			wantFiles:  0,
		},
		{
			name:       "ブランチのみ（追跡なし）",
			input:      "## feature/new\n",
			wantBranch: "feature/new",
			wantFiles:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseStatus(tt.input)

			if result.Branch != tt.wantBranch {
				t.Errorf("Branch = %q, want %q", result.Branch, tt.wantBranch)
			}
			if len(result.Files) != tt.wantFiles {
				t.Errorf("len(Files) = %d, want %d", len(result.Files), tt.wantFiles)
			}
		})
	}
}

func TestParseStatus_FileDetails(t *testing.T) {
	input := readTestdata(t, "status_porcelain.txt")
	result := ParseStatus(input)

	// 各ファイルのステータスを確認
	tests := []struct {
		path       string
		status     string
		statusText string
	}{
		{"internal/server/server.go", "M", "modified"},
		{"internal/git/git.go", "A", "added"},
		{"old_file.go", "D", "deleted"},
		{"untracked.txt", "?", "untracked"},
		{"new_name.go", "R", "renamed"},
		{"both_modified.go", "M", "modified"},
	}

	if len(result.Files) != len(tests) {
		t.Fatalf("len(Files) = %d, want %d", len(result.Files), len(tests))
	}

	for i, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			f := result.Files[i]
			if f.Path != tt.path {
				t.Errorf("Path = %q, want %q", f.Path, tt.path)
			}
			if f.Status != tt.status {
				t.Errorf("Status = %q, want %q", f.Status, tt.status)
			}
			if f.StatusText != tt.statusText {
				t.Errorf("StatusText = %q, want %q", f.StatusText, tt.statusText)
			}
		})
	}
}

func TestParseLog(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
	}{
		{
			name:      "フィクスチャファイルからパース",
			input:     readTestdata(t, "log_output.txt"),
			wantCount: 3,
		},
		{
			name:      "空の出力",
			input:     "",
			wantCount: 0,
		},
		{
			name:      "不正な行（タブ不足）",
			input:     "abc1234\tJohn Doe\n",
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			entries := ParseLog(tt.input)
			if len(entries) != tt.wantCount {
				t.Errorf("len(entries) = %d, want %d", len(entries), tt.wantCount)
			}
		})
	}
}

func TestParseLog_EntryDetails(t *testing.T) {
	input := readTestdata(t, "log_output.txt")
	entries := ParseLog(input)

	if len(entries) < 1 {
		t.Fatal("expected at least 1 entry")
	}

	first := entries[0]
	if first.Hash != "abc1234" {
		t.Errorf("Hash = %q, want %q", first.Hash, "abc1234")
	}
	if first.AuthorName != "John Doe" {
		t.Errorf("AuthorName = %q, want %q", first.AuthorName, "John Doe")
	}
	if first.Date != "2025-01-15T10:30:00+09:00" {
		t.Errorf("Date = %q, want %q", first.Date, "2025-01-15T10:30:00+09:00")
	}
	if first.Subject != "Fix login bug" {
		t.Errorf("Subject = %q, want %q", first.Subject, "Fix login bug")
	}
}

func TestParseDiffTree(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
	}{
		{
			name:      "フィクスチャファイルからパース",
			input:     readTestdata(t, "diff_tree_output.txt"),
			wantCount: 3,
		},
		{
			name:      "空の出力",
			input:     "",
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			files := ParseDiffTree(tt.input)
			if len(files) != tt.wantCount {
				t.Errorf("len(files) = %d, want %d", len(files), tt.wantCount)
			}
		})
	}
}

func TestParseDiffTree_FileDetails(t *testing.T) {
	input := readTestdata(t, "diff_tree_output.txt")
	files := ParseDiffTree(input)

	expected := []struct {
		path       string
		status     string
		statusText string
	}{
		{"internal/server/server.go", "M", "modified"},
		{"internal/git/git.go", "A", "added"},
		{"old_file.go", "D", "deleted"},
	}

	if len(files) != len(expected) {
		t.Fatalf("len(files) = %d, want %d", len(files), len(expected))
	}

	for i, want := range expected {
		t.Run(want.path, func(t *testing.T) {
			f := files[i]
			if f.Path != want.path {
				t.Errorf("Path = %q, want %q", f.Path, want.path)
			}
			if f.Status != want.status {
				t.Errorf("Status = %q, want %q", f.Status, want.status)
			}
			if f.StatusText != want.statusText {
				t.Errorf("StatusText = %q, want %q", f.StatusText, want.statusText)
			}
		})
	}
}

func TestParseBranches(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
	}{
		{
			name:      "フィクスチャファイルからパース",
			input:     readTestdata(t, "branches_output.txt"),
			wantCount: 5,
		},
		{
			name:      "空の出力",
			input:     "",
			wantCount: 0,
		},
		{
			name:      "HEAD参照を除外",
			input:     "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n",
			wantCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			branches := ParseBranches(tt.input)
			if len(branches) != tt.wantCount {
				t.Errorf("len(branches) = %d, want %d", len(branches), tt.wantCount)
			}
		})
	}
}

func TestParseWorktrees(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
	}{
		{
			name:      "複数の worktree",
			input:     readTestdata(t, "worktree_list.txt"),
			wantCount: 3,
		},
		{
			name: "単一の worktree",
			input: "worktree /home/user/projects/myapp\n" +
				"HEAD abc1234def5678901234567890123456789abcde\n" +
				"branch refs/heads/main\n\n",
			wantCount: 1,
		},
		{
			name:      "空の出力",
			input:     "",
			wantCount: 0,
		},
		{
			name: "bare worktree",
			input: "worktree /home/user/projects/myapp.git\n" +
				"HEAD abc1234def5678901234567890123456789abcde\n" +
				"bare\n\n",
			wantCount: 1,
		},
		{
			name: "detached HEAD",
			input: "worktree /home/user/projects/myapp-detached\n" +
				"HEAD abc1234def5678901234567890123456789abcde\n" +
				"detached\n\n",
			wantCount: 1,
		},
		{
			name: "スラッシュ含むブランチ名",
			input: "worktree /home/user/projects/myapp-feature\n" +
				"HEAD def5678abc1234567890123456789012345678901\n" +
				"branch refs/heads/feature/login/oauth\n\n",
			wantCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			worktrees := ParseWorktrees(tt.input)
			if len(worktrees) != tt.wantCount {
				t.Errorf("len(worktrees) = %d, want %d", len(worktrees), tt.wantCount)
			}
		})
	}
}

func TestParseWorktrees_Details(t *testing.T) {
	input := readTestdata(t, "worktree_list.txt")
	worktrees := ParseWorktrees(input)

	expected := []struct {
		path   string
		branch string
		head   string
		bare   bool
	}{
		{"/home/user/projects/myapp", "main", "abc1234def5678901234567890123456789abcde", false},
		{"/home/user/projects/myapp-feature", "feature/login", "def5678abc1234567890123456789012345678901", false},
		{"/home/user/projects/myapp-fix", "fix-typo", "1234567890abcdef1234567890abcdef12345678", false},
	}

	if len(worktrees) != len(expected) {
		t.Fatalf("len(worktrees) = %d, want %d", len(worktrees), len(expected))
	}

	for i, want := range expected {
		t.Run(want.path, func(t *testing.T) {
			w := worktrees[i]
			if w.Path != want.path {
				t.Errorf("Path = %q, want %q", w.Path, want.path)
			}
			if w.Branch != want.branch {
				t.Errorf("Branch = %q, want %q", w.Branch, want.branch)
			}
			if w.Head != want.head {
				t.Errorf("Head = %q, want %q", w.Head, want.head)
			}
			if w.Bare != want.bare {
				t.Errorf("Bare = %v, want %v", w.Bare, want.bare)
			}
		})
	}
}

func TestParseWorktrees_BareWorktree(t *testing.T) {
	input := "worktree /home/user/projects/myapp.git\n" +
		"HEAD abc1234def5678901234567890123456789abcde\n" +
		"bare\n\n"

	worktrees := ParseWorktrees(input)
	if len(worktrees) != 1 {
		t.Fatalf("len(worktrees) = %d, want 1", len(worktrees))
	}

	w := worktrees[0]
	if w.Path != "/home/user/projects/myapp.git" {
		t.Errorf("Path = %q, want %q", w.Path, "/home/user/projects/myapp.git")
	}
	if w.Bare != true {
		t.Errorf("Bare = %v, want true", w.Bare)
	}
	if w.Branch != "" {
		t.Errorf("Branch = %q, want empty", w.Branch)
	}
	if w.Head != "abc1234def5678901234567890123456789abcde" {
		t.Errorf("Head = %q, want %q", w.Head, "abc1234def5678901234567890123456789abcde")
	}
}

func TestParseWorktrees_DetachedHead(t *testing.T) {
	input := "worktree /home/user/projects/myapp-detached\n" +
		"HEAD abc1234def5678901234567890123456789abcde\n" +
		"detached\n\n"

	worktrees := ParseWorktrees(input)
	if len(worktrees) != 1 {
		t.Fatalf("len(worktrees) = %d, want 1", len(worktrees))
	}

	w := worktrees[0]
	if w.Path != "/home/user/projects/myapp-detached" {
		t.Errorf("Path = %q, want %q", w.Path, "/home/user/projects/myapp-detached")
	}
	if w.Branch != "" {
		t.Errorf("Branch = %q, want empty for detached HEAD", w.Branch)
	}
	if w.Bare != false {
		t.Errorf("Bare = %v, want false for detached HEAD", w.Bare)
	}
}

func TestParseWorktrees_SlashInBranch(t *testing.T) {
	input := "worktree /home/user/projects/myapp-feature\n" +
		"HEAD def5678abc1234567890123456789012345678901\n" +
		"branch refs/heads/feature/login/oauth\n\n"

	worktrees := ParseWorktrees(input)
	if len(worktrees) != 1 {
		t.Fatalf("len(worktrees) = %d, want 1", len(worktrees))
	}

	w := worktrees[0]
	if w.Branch != "feature/login/oauth" {
		t.Errorf("Branch = %q, want %q", w.Branch, "feature/login/oauth")
	}
}

func TestParseBranches_Details(t *testing.T) {
	input := readTestdata(t, "branches_output.txt")
	branches := ParseBranches(input)

	expected := []struct {
		name    string
		current bool
		remote  bool
	}{
		{"main", true, false},
		{"feature/login", false, false},
		{"fix/typo", false, false},
		{"origin/main", false, true},
		{"origin/feature/login", false, true},
	}

	if len(branches) != len(expected) {
		t.Fatalf("len(branches) = %d, want %d", len(branches), len(expected))
	}

	for i, want := range expected {
		t.Run(want.name, func(t *testing.T) {
			b := branches[i]
			if b.Name != want.name {
				t.Errorf("Name = %q, want %q", b.Name, want.name)
			}
			if b.Current != want.current {
				t.Errorf("Current = %v, want %v", b.Current, want.current)
			}
			if b.Remote != want.remote {
				t.Errorf("Remote = %v, want %v", b.Remote, want.remote)
			}
		})
	}
}
