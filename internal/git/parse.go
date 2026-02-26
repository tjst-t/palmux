package git

import "strings"

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

// ParseLog は git log --pretty=format:%h\t%an\t%aI\t%s の出力をパースする。
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
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) < 4 {
			continue
		}
		entries = append(entries, LogEntry{
			Hash:       parts[0],
			AuthorName: parts[1],
			Date:       parts[2],
			Subject:    parts[3],
		})
	}

	return entries
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

// ParseWorktrees は git worktree list --porcelain の出力をパースする。
func ParseWorktrees(output string) []Worktree {
	worktrees := []Worktree{}
	if output == "" {
		return worktrees
	}

	// エントリは空行で区切られる
	blocks := strings.Split(output, "\n\n")
	for _, block := range blocks {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}

		var wt Worktree
		lines := strings.Split(block, "\n")
		for _, line := range lines {
			switch {
			case strings.HasPrefix(line, "worktree "):
				wt.Path = strings.TrimPrefix(line, "worktree ")
			case strings.HasPrefix(line, "HEAD "):
				wt.Head = strings.TrimPrefix(line, "HEAD ")
			case strings.HasPrefix(line, "branch "):
				ref := strings.TrimPrefix(line, "branch ")
				// refs/heads/ プレフィックスを除去
				wt.Branch = strings.TrimPrefix(ref, "refs/heads/")
			case line == "bare":
				wt.Bare = true
			case line == "detached":
				// detached HEAD: branch は空のまま
			}
		}

		if wt.Path != "" {
			worktrees = append(worktrees, wt)
		}
	}

	return worktrees
}

// ParseBranches は git branch -a --no-color の出力をパースする。
func ParseBranches(output string) []Branch {
	branches := []Branch{}
	if output == "" {
		return branches
	}

	lines := strings.Split(strings.TrimRight(output, "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		current := false
		if strings.HasPrefix(line, "* ") {
			current = true
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

		branches = append(branches, Branch{
			Name:    name,
			Current: current,
			Remote:  remote,
		})
	}

	return branches
}
