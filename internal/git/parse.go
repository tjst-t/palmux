package git

import (
	"regexp"
	"strconv"
	"strings"
)

// statusCodeToText はステータスコードを人間が読みやすいテキストに変換する。
func statusCodeToText(code string) string {
	switch code {
	case "M":
		return "modified"
	case "A":
		return "added"
	case "D":
		return "deleted"
	case "?":
		return "untracked"
	case "R":
		return "renamed"
	default:
		return "modified"
	}
}

// ParseStatus は git status --porcelain=v1 -b の出力をパースする。
func ParseStatus(output string) *StatusResult {
	result := &StatusResult{
		Files: []StatusFile{},
	}

	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		// ブランチ行: ## main...origin/main
		if strings.HasPrefix(line, "## ") {
			branch := line[3:]
			// "main...origin/main" → "main"
			if idx := strings.Index(branch, "..."); idx >= 0 {
				branch = branch[:idx]
			}
			// "No commits yet on main" → "main"
			if strings.HasPrefix(branch, "No commits yet on ") {
				branch = strings.TrimPrefix(branch, "No commits yet on ")
			}
			result.Branch = branch
			continue
		}

		// ファイル行: XY path or XY old -> new
		if len(line) < 4 {
			continue
		}

		xy := line[:2]
		path := strings.TrimSpace(line[3:])

		// リネームの場合: "old -> new"
		if strings.Contains(path, " -> ") {
			parts := strings.SplitN(path, " -> ", 2)
			path = parts[1]
		}

		// ステータスコードを決定
		var code string
		switch {
		case xy == "??":
			code = "?"
		case xy[0] == 'R' || xy[1] == 'R':
			code = "R"
		case xy[0] == 'A' || xy[1] == 'A':
			code = "A"
		case xy[0] == 'D' || xy[1] == 'D':
			code = "D"
		case xy[0] == 'M' || xy[1] == 'M':
			code = "M"
		default:
			code = "M"
		}

		result.Files = append(result.Files, StatusFile{
			Path:       path,
			Status:     code,
			StatusText: statusCodeToText(code),
		})
	}

	return result
}

// ParseLog は git log --pretty=format:%h\t%an\t%aI\t%s\t%D の出力をパースする。
func ParseLog(output string) []LogEntry {
	entries := []LogEntry{}
	if output == "" {
		return entries
	}

	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 5)
		if len(parts) < 4 {
			continue
		}
		entry := LogEntry{
			Hash:       parts[0],
			AuthorName: parts[1],
			Date:       parts[2],
			Subject:    parts[3],
		}
		if len(parts) >= 5 && parts[4] != "" {
			entry.Refs = parseRefs(parts[4])
		}
		entries = append(entries, entry)
	}

	return entries
}

// parseRefs は git log の %D 出力（例: "HEAD -> main, origin/main, tag: v1.0"）をパースする。
func parseRefs(raw string) []string {
	parts := strings.Split(raw, ", ")
	refs := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// "HEAD -> main" → "main" は含めず、HEAD だけ除去して branch 名を残す
		if strings.HasPrefix(p, "HEAD -> ") {
			p = strings.TrimPrefix(p, "HEAD -> ")
		} else if p == "HEAD" {
			continue
		}
		refs = append(refs, p)
	}
	return refs
}

// ParseDiffTree は git diff-tree --no-commit-id -r --name-status の出力をパースする。
func ParseDiffTree(output string) []StatusFile {
	files := []StatusFile{}
	if output == "" {
		return files
	}

	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) < 2 {
			continue
		}
		code := parts[0]
		path := parts[1]

		// リネームの場合 (R100 など)
		if strings.HasPrefix(code, "R") {
			code = "R"
			if tabParts := strings.SplitN(path, "\t", 2); len(tabParts) == 2 {
				path = tabParts[1]
			}
		}

		files = append(files, StatusFile{
			Path:       path,
			Status:     code,
			StatusText: statusCodeToText(code),
		})
	}

	return files
}

// ParseBranches は git branch -a --no-color の出力をパースする。
// ローカルブランチが存在するリモートブランチは除外する。
// 例: ローカル "main" が存在する場合、"origin/main" は返さない。
func ParseBranches(output string) []Branch {
	branches := []Branch{}
	if output == "" {
		return branches
	}

	// まず全ブランチをパースする
	var allBranches []Branch
	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		current := false
		if strings.HasPrefix(line, "* ") {
			current = true
			line = line[2:]
		} else if strings.HasPrefix(line, "+ ") {
			// worktree でチェックアウト中のブランチ
			line = line[2:]
		} else {
			line = strings.TrimSpace(line)
		}

		// HEAD -> ... を除外
		if strings.Contains(line, "HEAD ->") || strings.Contains(line, "-> ") {
			continue
		}

		remote := false
		name := line
		if strings.HasPrefix(name, "remotes/") {
			remote = true
			name = strings.TrimPrefix(name, "remotes/")
		}

		allBranches = append(allBranches, Branch{
			Name:    name,
			Current: current,
			Remote:  remote,
		})
	}

	// ローカルブランチ名のセットを構築
	localNames := make(map[string]bool)
	for _, b := range allBranches {
		if !b.Remote {
			localNames[b.Name] = true
		}
	}

	// リモートブランチのうち、対応するローカルブランチが存在するものを除外
	for _, b := range allBranches {
		if b.Remote {
			// "origin/feature/login" → "feature/login"
			if idx := strings.Index(b.Name, "/"); idx >= 0 {
				bareName := b.Name[idx+1:]
				if localNames[bareName] {
					continue
				}
			}
		}
		branches = append(branches, b)
	}

	return branches
}

// DiffHunk は diff の hunk（変更ブロック）を表す。
type DiffHunk struct {
	Header   string `json:"header"`    // "@@ -10,7 +10,8 @@ func main()"
	OldStart int    `json:"old_start"` // 旧ファイルの開始行番号
	OldLines int    `json:"old_lines"` // 旧ファイルの行数
	NewStart int    `json:"new_start"` // 新ファイルの開始行番号
	NewLines int    `json:"new_lines"` // 新ファイルの行数
	Content  string `json:"content"`   // hunk の全行（ヘッダー行含む）
}

// StructuredDiff は構造化された差分を表す。
type StructuredDiff struct {
	FilePath string     `json:"file_path"`
	Status   string     `json:"status"` // "M", "A", "D"
	Hunks    []DiffHunk `json:"hunks"`
}

// hunkHeaderRe は @@ -old_start[,old_lines] +new_start[,new_lines] @@ にマッチする正規表現。
var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`)

// ParseStructuredDiff は git diff の出力を構造化された差分にパースする。
func ParseStructuredDiff(output string) []StructuredDiff {
	diffs := []StructuredDiff{}
	if output == "" {
		return diffs
	}

	lines := strings.Split(output, "\n")
	var current *StructuredDiff
	var currentHunkLines []string

	// finishHunk は現在の hunk を確定して current に追加する。
	finishHunk := func() {
		if current != nil && len(current.Hunks) > 0 && len(currentHunkLines) > 0 {
			lastIdx := len(current.Hunks) - 1
			current.Hunks[lastIdx].Content = strings.Join(currentHunkLines, "\n")
			currentHunkLines = nil
		}
	}

	// finishFile は現在のファイルを確定して diffs に追加する。
	finishFile := func() {
		finishHunk()
		if current != nil {
			diffs = append(diffs, *current)
			current = nil
		}
	}

	for _, line := range lines {
		// 新しいファイルの開始
		if strings.HasPrefix(line, "diff --git ") {
			finishFile()
			filePath := parseDiffGitHeader(line)
			current = &StructuredDiff{
				FilePath: filePath,
				Status:   "M", // デフォルトは modified
				Hunks:    []DiffHunk{},
			}
			continue
		}

		if current == nil {
			continue
		}

		// ファイルステータスの判定
		if strings.HasPrefix(line, "new file mode") {
			current.Status = "A"
			continue
		}
		if strings.HasPrefix(line, "deleted file mode") {
			current.Status = "D"
			continue
		}

		// --- と +++ 行（ステータス判定の補助）
		if strings.HasPrefix(line, "--- ") {
			if line == "--- /dev/null" && current.Status == "M" {
				current.Status = "A"
			}
			continue
		}
		if strings.HasPrefix(line, "+++ ") {
			if line == "+++ /dev/null" && current.Status == "M" {
				current.Status = "D"
			}
			continue
		}

		// index 行はスキップ
		if strings.HasPrefix(line, "index ") {
			continue
		}

		// hunk ヘッダー
		if matches := hunkHeaderRe.FindStringSubmatch(line); matches != nil {
			finishHunk()
			oldStart, _ := strconv.Atoi(matches[1])
			oldLines := 1
			if matches[2] != "" {
				oldLines, _ = strconv.Atoi(matches[2])
			}
			newStart, _ := strconv.Atoi(matches[3])
			newLines := 1
			if matches[4] != "" {
				newLines, _ = strconv.Atoi(matches[4])
			}

			hunk := DiffHunk{
				Header:   line,
				OldStart: oldStart,
				OldLines: oldLines,
				NewStart: newStart,
				NewLines: newLines,
			}
			current.Hunks = append(current.Hunks, hunk)
			currentHunkLines = []string{line}
			continue
		}

		// hunk 内の行（コンテキスト行、追加行、削除行）
		if len(currentHunkLines) > 0 {
			currentHunkLines = append(currentHunkLines, line)
		}
	}

	// 最後のファイルを確定
	finishFile()

	return diffs
}

// parseDiffGitHeader は "diff --git a/path b/path" からファイルパスを抽出する。
func parseDiffGitHeader(line string) string {
	// "diff --git a/foo b/foo" → "foo"
	// b/ の後のパスを使う
	parts := strings.SplitN(line, " b/", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	// フォールバック: a/ の後のパスを使う
	parts = strings.SplitN(line, " a/", 2)
	if len(parts) == 2 {
		// "path b/path" から前の部分だけ取る
		p := parts[1]
		if idx := strings.Index(p, " b/"); idx >= 0 {
			return p[:idx]
		}
		return p
	}
	return ""
}
