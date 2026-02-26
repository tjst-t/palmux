package git

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
)

// ErrNotGitRepo はディレクトリが Git リポジトリでないことを示すエラー。
var ErrNotGitRepo = errors.New("not a git repository")

// CommandRunner は git コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type CommandRunner interface {
	RunInDir(dir string, args ...string) ([]byte, error)
}

// RealCommandRunner は実際の git バイナリを実行する。
type RealCommandRunner struct{}

// RunInDir は指定ディレクトリで git コマンドを実行する。
func (r *RealCommandRunner) RunInDir(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		// "not a git repository" を検出してセンチネルエラーに変換
		if strings.Contains(string(out), "not a git repository") {
			return nil, ErrNotGitRepo
		}
		return nil, err
	}
	return out, nil
}

// StatusFile はファイルの変更ステータスを表す。
type StatusFile struct {
	Path       string `json:"path"`
	Status     string `json:"status"`      // "M","A","D","?","R"
	StatusText string `json:"status_text"` // "modified","added","deleted","untracked","renamed"
}

// StatusResult は git status の結果を表す。
type StatusResult struct {
	Branch string       `json:"branch"`
	Files  []StatusFile `json:"files"`
}

// LogEntry はコミットログの1エントリを表す。
type LogEntry struct {
	Hash       string `json:"hash"`
	AuthorName string `json:"author_name"`
	Date       string `json:"date"`
	Subject    string `json:"subject"`
}

// Branch はブランチ情報を表す。
type Branch struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
	Remote  bool   `json:"remote"`
}

// Git は git 操作を提供する。
type Git struct {
	Cmd CommandRunner
}

// Status は git status を実行し、結果を返す。
func (g *Git) Status(dir string) (*StatusResult, error) {
	out, err := g.Cmd.RunInDir(dir, "status", "--porcelain=v1", "-b")
	if err != nil {
		return nil, err
	}
	return ParseStatus(string(out)), nil
}

// Log は git log を実行し、コミットログを返す。
func (g *Git) Log(dir, branch string, limit int) ([]LogEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	args := []string{"log", "--pretty=format:%h\t%an\t%aI\t%s", "-n", strconv.Itoa(limit)}
	if branch != "" {
		args = append(args, branch)
	}
	out, err := g.Cmd.RunInDir(dir, args...)
	if err != nil {
		return nil, err
	}
	return ParseLog(string(out)), nil
}

// Diff は差分を返す。
// commit が空の場合はワーキングツリーの差分（git diff + git diff --cached を結合）。
// commit が指定された場合は git diff commit~1 commit [-- path] の差分。
// path が指定された場合はそのファイルのみ。
func (g *Git) Diff(dir, commit, path string) (string, error) {
	if commit == "" {
		// ワーキングツリーの差分
		args := []string{"diff", "HEAD"}
		if path != "" {
			args = append(args, "--", path)
		}
		out, err := g.Cmd.RunInDir(dir, args...)
		if err != nil {
			// HEAD がない場合（初回コミット前）は diff --cached を試す
			args2 := []string{"diff", "--cached"}
			if path != "" {
				args2 = append(args2, "--", path)
			}
			out2, err2 := g.Cmd.RunInDir(dir, args2...)
			if err2 != nil {
				return "", err
			}
			return string(out2), nil
		}
		return string(out), nil
	}

	// 特定コミットの差分
	args := []string{"diff", commit + "~1", commit}
	if path != "" {
		args = append(args, "--", path)
	}
	out, err := g.Cmd.RunInDir(dir, args...)
	if err != nil {
		// 最初のコミットの場合は diff-tree で代替
		args2 := []string{"diff-tree", "-p", commit}
		if path != "" {
			args2 = append(args2, "--", path)
		}
		out2, err2 := g.Cmd.RunInDir(dir, args2...)
		if err2 != nil {
			return "", err
		}
		return string(out2), nil
	}
	return string(out), nil
}

// CommitFiles はコミットで変更されたファイル一覧を返す。
func (g *Git) CommitFiles(dir, commit string) ([]StatusFile, error) {
	out, err := g.Cmd.RunInDir(dir, "diff-tree", "--no-commit-id", "-r", "--name-status", commit)
	if err != nil {
		return nil, err
	}
	return ParseDiffTree(string(out)), nil
}

// Branches はブランチ一覧を返す。
func (g *Git) Branches(dir string) ([]Branch, error) {
	out, err := g.Cmd.RunInDir(dir, "branch", "-a", "--no-color")
	if err != nil {
		return nil, err
	}
	return ParseBranches(string(out)), nil
}
