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
