package git

import (
	"os"
	"strings"
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

	if len(entries) < 3 {
		t.Fatal("expected at least 3 entries")
	}

	// 1件目: HEAD -> main, origin/main
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
	if len(first.Refs) != 2 {
		t.Errorf("len(Refs) = %d, want 2", len(first.Refs))
	} else {
		if first.Refs[0] != "main" {
			t.Errorf("Refs[0] = %q, want %q", first.Refs[0], "main")
		}
		if first.Refs[1] != "origin/main" {
			t.Errorf("Refs[1] = %q, want %q", first.Refs[1], "origin/main")
		}
	}

	// 2件目: tag: v1.0
	second := entries[1]
	if len(second.Refs) != 1 {
		t.Errorf("len(Refs) = %d, want 1", len(second.Refs))
	} else {
		if second.Refs[0] != "tag: v1.0" {
			t.Errorf("Refs[0] = %q, want %q", second.Refs[0], "tag: v1.0")
		}
	}

	// 3件目: refs なし
	third := entries[2]
	if len(third.Refs) != 0 {
		t.Errorf("len(Refs) = %d, want 0", len(third.Refs))
	}
}

func TestParseRefs(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantRefs []string
	}{
		{
			name:     "HEAD -> ブランチとリモート",
			input:    "HEAD -> main, origin/main",
			wantRefs: []string{"main", "origin/main"},
		},
		{
			name:     "タグのみ",
			input:    "tag: v1.0",
			wantRefs: []string{"tag: v1.0"},
		},
		{
			name:     "複数のタグとブランチ",
			input:    "HEAD -> develop, tag: v2.0, origin/develop",
			wantRefs: []string{"develop", "tag: v2.0", "origin/develop"},
		},
		{
			name:     "HEAD のみ（detached HEAD）",
			input:    "HEAD",
			wantRefs: []string{},
		},
		{
			name:     "空文字列",
			input:    "",
			wantRefs: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			refs := parseRefs(tt.input)
			if len(refs) != len(tt.wantRefs) {
				t.Fatalf("len(refs) = %d, want %d; refs = %v", len(refs), len(tt.wantRefs), refs)
			}
			for i, want := range tt.wantRefs {
				if refs[i] != want {
					t.Errorf("refs[%d] = %q, want %q", i, refs[i], want)
				}
			}
		})
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
			wantCount: 5, // origin/main, origin/feature/login はローカルがあるので除外
		},
		{
			name:      "空の出力",
			input:     "",
			wantCount: 0,
		},
		{
			name:      "HEAD参照を除外",
			input:     "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n",
			wantCount: 1, // origin/main はローカル main があるので除外
		},
		{
			name:      "worktreeチェックアウト中の+プレフィクスを処理",
			input:     "* main\n+ worktree-branch\n  feature-x\n",
			wantCount: 3,
		},
		{
			name:      "ローカルがないリモートブランチは残る",
			input:     "* main\n  remotes/origin/main\n  remotes/origin/feature/new\n",
			wantCount: 2, // main + origin/feature/new
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

func TestParseStructuredDiff(t *testing.T) {
	input := readTestdata(t, "diff_single_hunk.txt")
	diffs := ParseStructuredDiff(input)

	if len(diffs) != 1 {
		t.Fatalf("len(diffs) = %d, want 1", len(diffs))
	}

	d := diffs[0]
	if d.FilePath != "main.go" {
		t.Errorf("FilePath = %q, want %q", d.FilePath, "main.go")
	}
	if d.Status != "M" {
		t.Errorf("Status = %q, want %q", d.Status, "M")
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("len(Hunks) = %d, want 1", len(d.Hunks))
	}

	h := d.Hunks[0]
	if h.OldStart != 10 {
		t.Errorf("OldStart = %d, want 10", h.OldStart)
	}
	if h.OldLines != 7 {
		t.Errorf("OldLines = %d, want 7", h.OldLines)
	}
	if h.NewStart != 10 {
		t.Errorf("NewStart = %d, want 10", h.NewStart)
	}
	if h.NewLines != 8 {
		t.Errorf("NewLines = %d, want 8", h.NewLines)
	}
	if h.Header != "@@ -10,7 +10,8 @@ func main() {" {
		t.Errorf("Header = %q, want %q", h.Header, "@@ -10,7 +10,8 @@ func main() {")
	}
	// Content にはヘッダー行も含まれる
	if !strings.Contains(h.Content, "@@ -10,7 +10,8 @@ func main() {") {
		t.Error("Content should contain hunk header")
	}
	if !strings.Contains(h.Content, "+\tfmt.Println(\"added\")") {
		t.Error("Content should contain added line")
	}
}

func TestParseStructuredDiff_MultipleHunks(t *testing.T) {
	input := readTestdata(t, "diff_multiple_hunks.txt")
	diffs := ParseStructuredDiff(input)

	if len(diffs) != 1 {
		t.Fatalf("len(diffs) = %d, want 1", len(diffs))
	}

	d := diffs[0]
	if d.FilePath != "main.go" {
		t.Errorf("FilePath = %q, want %q", d.FilePath, "main.go")
	}
	if len(d.Hunks) != 2 {
		t.Fatalf("len(Hunks) = %d, want 2", len(d.Hunks))
	}

	// 1つ目の hunk
	h1 := d.Hunks[0]
	if h1.OldStart != 1 {
		t.Errorf("Hunk[0].OldStart = %d, want 1", h1.OldStart)
	}
	if h1.OldLines != 5 {
		t.Errorf("Hunk[0].OldLines = %d, want 5", h1.OldLines)
	}
	if h1.NewStart != 1 {
		t.Errorf("Hunk[0].NewStart = %d, want 1", h1.NewStart)
	}
	if h1.NewLines != 5 {
		t.Errorf("Hunk[0].NewLines = %d, want 5", h1.NewLines)
	}

	// 2つ目の hunk
	h2 := d.Hunks[1]
	if h2.OldStart != 20 {
		t.Errorf("Hunk[1].OldStart = %d, want 20", h2.OldStart)
	}
	if h2.OldLines != 6 {
		t.Errorf("Hunk[1].OldLines = %d, want 6", h2.OldLines)
	}
	if h2.NewStart != 20 {
		t.Errorf("Hunk[1].NewStart = %d, want 20", h2.NewStart)
	}
	if h2.NewLines != 7 {
		t.Errorf("Hunk[1].NewLines = %d, want 7", h2.NewLines)
	}
}

func TestParseStructuredDiff_MultipleFiles(t *testing.T) {
	input := readTestdata(t, "diff_multiple_files.txt")
	diffs := ParseStructuredDiff(input)

	if len(diffs) != 2 {
		t.Fatalf("len(diffs) = %d, want 2", len(diffs))
	}

	if diffs[0].FilePath != "file1.go" {
		t.Errorf("diffs[0].FilePath = %q, want %q", diffs[0].FilePath, "file1.go")
	}
	if diffs[1].FilePath != "file2.go" {
		t.Errorf("diffs[1].FilePath = %q, want %q", diffs[1].FilePath, "file2.go")
	}

	if len(diffs[0].Hunks) != 1 {
		t.Errorf("diffs[0].Hunks count = %d, want 1", len(diffs[0].Hunks))
	}
	if len(diffs[1].Hunks) != 1 {
		t.Errorf("diffs[1].Hunks count = %d, want 1", len(diffs[1].Hunks))
	}

	// file1 の hunk: 追加行がある
	if !strings.Contains(diffs[0].Hunks[0].Content, "+\tbar()") {
		t.Error("file1 hunk should contain added line")
	}
	// file2 の hunk: 削除行がある
	if !strings.Contains(diffs[1].Hunks[0].Content, "-func old() {}") {
		t.Error("file2 hunk should contain deleted line")
	}
}

func TestParseStructuredDiff_Empty(t *testing.T) {
	diffs := ParseStructuredDiff("")
	if len(diffs) != 0 {
		t.Errorf("len(diffs) = %d, want 0", len(diffs))
	}
}

func TestParseStructuredDiff_NewFile(t *testing.T) {
	input := readTestdata(t, "diff_new_file.txt")
	diffs := ParseStructuredDiff(input)

	if len(diffs) != 1 {
		t.Fatalf("len(diffs) = %d, want 1", len(diffs))
	}

	d := diffs[0]
	if d.FilePath != "newfile.go" {
		t.Errorf("FilePath = %q, want %q", d.FilePath, "newfile.go")
	}
	if d.Status != "A" {
		t.Errorf("Status = %q, want %q", d.Status, "A")
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("len(Hunks) = %d, want 1", len(d.Hunks))
	}

	h := d.Hunks[0]
	if h.OldStart != 0 {
		t.Errorf("OldStart = %d, want 0", h.OldStart)
	}
	if h.OldLines != 0 {
		t.Errorf("OldLines = %d, want 0", h.OldLines)
	}
	if h.NewStart != 1 {
		t.Errorf("NewStart = %d, want 1", h.NewStart)
	}
	if h.NewLines != 5 {
		t.Errorf("NewLines = %d, want 5", h.NewLines)
	}
}

func TestParseStructuredDiff_DeletedFile(t *testing.T) {
	input := readTestdata(t, "diff_deleted_file.txt")
	diffs := ParseStructuredDiff(input)

	if len(diffs) != 1 {
		t.Fatalf("len(diffs) = %d, want 1", len(diffs))
	}

	d := diffs[0]
	if d.FilePath != "deleted.go" {
		t.Errorf("FilePath = %q, want %q", d.FilePath, "deleted.go")
	}
	if d.Status != "D" {
		t.Errorf("Status = %q, want %q", d.Status, "D")
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("len(Hunks) = %d, want 1", len(d.Hunks))
	}

	h := d.Hunks[0]
	if h.OldStart != 1 {
		t.Errorf("OldStart = %d, want 1", h.OldStart)
	}
	if h.OldLines != 5 {
		t.Errorf("OldLines = %d, want 5", h.OldLines)
	}
	if h.NewStart != 0 {
		t.Errorf("NewStart = %d, want 0", h.NewStart)
	}
	if h.NewLines != 0 {
		t.Errorf("NewLines = %d, want 0", h.NewLines)
	}
}

func TestParseStructuredDiff_HunkHeaderParsing(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantOldS int
		wantOldL int
		wantNewS int
		wantNewL int
	}{
		{
			name:     "標準的なhunkヘッダー",
			input:    "diff --git a/f.go b/f.go\n--- a/f.go\n+++ b/f.go\n@@ -10,7 +10,8 @@ func main() {\n context\n",
			wantOldS: 10,
			wantOldL: 7,
			wantNewS: 10,
			wantNewL: 8,
		},
		{
			name:     "行数省略（1行のみ）",
			input:    "diff --git a/f.go b/f.go\n--- a/f.go\n+++ b/f.go\n@@ -1 +1 @@\n-old\n+new\n",
			wantOldS: 1,
			wantOldL: 1,
			wantNewS: 1,
			wantNewL: 1,
		},
		{
			name:     "0行の追加（新規ファイル）",
			input:    "diff --git a/f.go b/f.go\nnew file mode 100644\n--- /dev/null\n+++ b/f.go\n@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3\n",
			wantOldS: 0,
			wantOldL: 0,
			wantNewS: 1,
			wantNewL: 3,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			diffs := ParseStructuredDiff(tt.input)
			if len(diffs) == 0 {
				t.Fatal("expected at least 1 diff")
			}
			if len(diffs[0].Hunks) == 0 {
				t.Fatal("expected at least 1 hunk")
			}
			h := diffs[0].Hunks[0]
			if h.OldStart != tt.wantOldS {
				t.Errorf("OldStart = %d, want %d", h.OldStart, tt.wantOldS)
			}
			if h.OldLines != tt.wantOldL {
				t.Errorf("OldLines = %d, want %d", h.OldLines, tt.wantOldL)
			}
			if h.NewStart != tt.wantNewS {
				t.Errorf("NewStart = %d, want %d", h.NewStart, tt.wantNewS)
			}
			if h.NewLines != tt.wantNewL {
				t.Errorf("NewLines = %d, want %d", h.NewLines, tt.wantNewL)
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
		{"worktree-branch", false, false},
		{"origin/feature/new", false, true}, // ローカルがないリモートのみ残る
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
