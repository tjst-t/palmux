package tmux

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/tjst-t/palmux/internal/git"
)

// CommandRunner は外部コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type CommandRunner interface {
	RunCommand(name string, args ...string) ([]byte, error)
	RunCommandInDir(dir, name string, args ...string) ([]byte, error)
}

// RealCommandRunner は実際のコマンドを実行する。
type RealCommandRunner struct{}

// RunCommand は指定されたコマンドを実行し、標準出力の内容を返す。
func (r *RealCommandRunner) RunCommand(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// RunCommandInDir は指定ディレクトリでコマンドを実行し、標準出力の内容を返す。
func (r *RealCommandRunner) RunCommandInDir(dir, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	return cmd.Output()
}

// GhqResolver は ghq リポジトリとセッション名のマッチングを行う。
// セッション名に対応する ghq リポジトリが存在する場合、そのパスを返す。
type GhqResolver struct {
	Cmd     CommandRunner
	HomeDir string
}

// GhqRepo は ghq リポジトリの情報を表す。
type GhqRepo struct {
	Name     string `json:"name"`      // 推奨セッション名（重複時は org-basename）
	Path     string `json:"path"`      // ghq root からの相対パス
	FullPath string `json:"full_path"` // フルパス
}

// ghqRepoLines は ghq root と ghq list の結果を取得し、root パスとリポジトリ行のスライスを返す。
// ghq が利用できない場合やリストが空の場合は空文字列と nil を返す。
func (g *GhqResolver) ghqRepoLines() (string, []string) {
	rootOut, err := g.Cmd.RunCommand("ghq", "root")
	if err != nil {
		return "", nil
	}
	root := strings.TrimRight(string(rootOut), "\n")

	listOut, err := g.Cmd.RunCommand("ghq", "list")
	if err != nil {
		return root, nil
	}

	trimmed := strings.TrimRight(string(listOut), "\n")
	if trimmed == "" {
		return root, nil
	}

	return root, strings.Split(trimmed, "\n")
}

// ParseSessionName はセッション名を repo 名とブランチ名に分解する。
// "palmux@feature-x" → ("palmux", "feature-x")
// "palmux" → ("palmux", "")
// "" → ("", "")
func ParseSessionName(sessionName string) (repo, branch string) {
	if sessionName == "" {
		return "", ""
	}
	idx := strings.Index(sessionName, "@")
	if idx < 0 {
		return sessionName, ""
	}
	return sessionName[:idx], sessionName[idx+1:]
}

// ResolveRepo はリポジトリ名に対応する ghq リポジトリのフルパスを返す。
// 対応するリポジトリが見つからない場合は空文字列を返す。
func (g *GhqResolver) ResolveRepo(repoName string) string {
	if repoName == "" {
		return ""
	}

	root, lines := g.ghqRepoLines()
	if lines == nil {
		return ""
	}

	// First pass: exact basename match
	for _, line := range lines {
		if line == "" {
			continue
		}
		name := filepath.Base(line)
		if name == repoName {
			return filepath.Join(root, line)
		}
	}

	// Second pass: org-basename match
	for _, line := range lines {
		if line == "" {
			continue
		}
		repoBase := filepath.Base(line)
		repoParent := filepath.Base(filepath.Dir(line))
		orgBasename := repoParent + "-" + repoBase
		if orgBasename == repoName {
			return filepath.Join(root, line)
		}
	}

	return ""
}

// Resolve はセッション名に対応する ghq リポジトリのパスを返す。
// 対応するリポジトリが見つからない場合、または ghq が利用できない場合は HomeDir を返す。
//
// セッション名が "repo@branch" 形式の場合、リポジトリを解決してから
// gwq list --json で branch に一致する worktree パスを探す。
//
// マッチングの優先順位:
//  1. basename の完全一致（最初にマッチしたものを使用）
//  2. org-basename 形式のマッチ（例: "alice-utils" → parent="alice", basename="utils"）
func (g *GhqResolver) Resolve(sessionName string) string {
	repo, branch := ParseSessionName(sessionName)
	if repo == "" {
		return g.HomeDir
	}

	repoPath := g.ResolveRepo(repo)
	if repoPath == "" {
		return g.HomeDir
	}

	if branch == "" {
		return repoPath
	}

	// gwq で worktree 解決
	worktrees, err := g.GwqListWorktrees(repoPath)
	if err == nil {
		for _, wt := range worktrees {
			if wt.Branch == branch {
				return wt.Path
			}
		}
	}

	return repoPath // fallback
}

// ListRepos は ghq リポジトリ一覧を返す。
// basename が重複するリポジトリは org-basename 形式で区別する。
// ghq が利用できない場合は空スライスと nil を返す。
func (g *GhqResolver) ListRepos() ([]GhqRepo, error) {
	root, lines := g.ghqRepoLines()
	if lines == nil {
		return []GhqRepo{}, nil
	}

	// basename の出現回数をカウント
	baseCount := make(map[string]int)
	for _, line := range lines {
		if line == "" {
			continue
		}
		base := filepath.Base(line)
		baseCount[base]++
	}

	repos := make([]GhqRepo, 0, len(lines))
	for _, line := range lines {
		if line == "" {
			continue
		}
		base := filepath.Base(line)
		name := base
		if baseCount[base] > 1 {
			// 重複する basename は parent-basename 形式にする
			parent := filepath.Base(filepath.Dir(line))
			name = parent + "-" + base
		}
		repos = append(repos, GhqRepo{
			Name:     name,
			Path:     line,
			FullPath: filepath.Join(root, line),
		})
	}

	return repos, nil
}

// GetRoot は ghq root のパスを返す。
// ghq が利用できない場合はエラーを返す。
func (g *GhqResolver) GetRoot() (string, error) {
	out, err := g.Cmd.RunCommand("ghq", "root")
	if err != nil {
		return "", fmt.Errorf("ghq root: %w", err)
	}
	return strings.TrimRight(string(out), "\n"), nil
}

// CloneRepo は ghq get を実行してリポジトリをクローンし、クローンされたリポジトリ情報を返す。
// ghq get 完了後に ListRepos でリポジトリ情報を取得し、URL のパスからマッチするものを探す。
func (g *GhqResolver) CloneRepo(url string) (*GhqRepo, error) {
	if url == "" {
		return nil, fmt.Errorf("clone repo: URL is empty")
	}

	_, err := g.Cmd.RunCommand("ghq", "get", url)
	if err != nil {
		return nil, fmt.Errorf("ghq get %q: %w", url, err)
	}

	// ghq get 後にリポジトリ一覧を取得して、クローンされたリポジトリを探す
	repos, err := g.ListRepos()
	if err != nil {
		return nil, fmt.Errorf("list repos after clone: %w", err)
	}

	// URL からリポジトリパスを推定して検索
	// URL 例: https://github.com/alice/utils → github.com/alice/utils
	urlPath := url
	// プロトコルを除去
	for _, prefix := range []string{"https://", "http://", "git://", "ssh://"} {
		urlPath = strings.TrimPrefix(urlPath, prefix)
	}
	// .git サフィックスを除去
	urlPath = strings.TrimSuffix(urlPath, ".git")
	// user@host:path 形式を host/path に変換
	if idx := strings.Index(urlPath, "@"); idx != -1 {
		urlPath = urlPath[idx+1:]
		urlPath = strings.Replace(urlPath, ":", "/", 1)
	}

	for _, repo := range repos {
		if repo.Path == urlPath {
			return &repo, nil
		}
	}

	// パスが完全一致しない場合はベースネームで探す
	urlBase := filepath.Base(urlPath)
	for _, repo := range repos {
		if filepath.Base(repo.Path) == urlBase {
			return &repo, nil
		}
	}

	// 見つからなくてもエラーにはしない（ghq get は成功している）
	// 最後にクローンされたリポジトリがリストに出ない場合
	return nil, fmt.Errorf("cloned repository not found in ghq list")
}

// GwqWorktree は gwq list --json の1エントリ。
type GwqWorktree struct {
	Path       string `json:"path"`
	Branch     string `json:"branch"`
	CommitHash string `json:"commit_hash"`
	IsMain     bool   `json:"is_main"`
	CreatedAt  string `json:"created_at"`
}

// GwqListWorktrees は gwq list --json で worktree 一覧を返す。
// repoPath 内で gwq を実行する。
func (g *GhqResolver) GwqListWorktrees(repoPath string) ([]GwqWorktree, error) {
	out, err := g.Cmd.RunCommandInDir(repoPath, "gwq", "list", "--json")
	if err != nil {
		return nil, fmt.Errorf("gwq list: %w", err)
	}

	var worktrees []GwqWorktree
	if err := json.Unmarshal(out, &worktrees); err != nil {
		return nil, fmt.Errorf("gwq list: parse JSON: %w", err)
	}

	return worktrees, nil
}

// GwqAddWorktree は gwq add でブランチの worktree を作成する。
// createBranch が true の場合は -b フラグで新しいブランチを作成する。
func (g *GhqResolver) GwqAddWorktree(repoPath, branch string, createBranch bool) error {
	args := []string{"add"}
	if createBranch {
		args = append(args, "-b")
	}
	args = append(args, branch)

	_, err := g.Cmd.RunCommandInDir(repoPath, "gwq", args...)
	if err != nil {
		return fmt.Errorf("gwq add %q: %w", branch, err)
	}

	return nil
}

// GwqRemoveWorktree は gwq remove でブランチの worktree を削除する。
func (g *GhqResolver) GwqRemoveWorktree(repoPath, branch string) error {
	_, err := g.Cmd.RunCommandInDir(repoPath, "gwq", "remove", branch)
	if err != nil {
		return fmt.Errorf("gwq remove %q: %w", branch, err)
	}

	return nil
}

// GitIsBranchMerged は HEAD にマージ済みかを判定する。
// git branch --merged を実行し、出力にブランチ名が含まれるか判定する。
func (g *GhqResolver) GitIsBranchMerged(repoPath, branch string) (bool, error) {
	out, err := g.Cmd.RunCommandInDir(repoPath, "git", "branch", "--merged")
	if err != nil {
		return false, fmt.Errorf("git branch --merged: %w", err)
	}

	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	for _, line := range lines {
		name := strings.TrimSpace(line)
		// "* main" → "main"
		if strings.HasPrefix(name, "* ") {
			name = name[2:]
		} else if strings.HasPrefix(name, "+ ") {
			name = name[2:]
		}
		if name == branch {
			return true, nil
		}
	}

	return false, nil
}

// GitDeleteBranch は git branch -d/-D でブランチを削除する。
// force が true の場合は -D（強制削除）、false の場合は -d（安全削除）。
func (g *GhqResolver) GitDeleteBranch(repoPath, branch string, force bool) error {
	flag := "-d"
	if force {
		flag = "-D"
	}
	_, err := g.Cmd.RunCommandInDir(repoPath, "git", "branch", flag, branch)
	if err != nil {
		return fmt.Errorf("git branch %s %q: %w", flag, branch, err)
	}
	return nil
}

// GwqRemoveWorktreeAndBranch は gwq remove -b でブランチと worktree をまとめて削除する。
// force が true の場合は --force-delete-branch フラグを追加する。
func (g *GhqResolver) GwqRemoveWorktreeAndBranch(repoPath, branch string, force bool) error {
	args := []string{"remove", "-b"}
	if force {
		args = append(args, "--force-delete-branch")
	}
	args = append(args, branch)

	_, err := g.Cmd.RunCommandInDir(repoPath, "gwq", args...)
	if err != nil {
		return fmt.Errorf("gwq remove -b %q: %w", branch, err)
	}
	return nil
}

// GitBranches は git branch -a --no-color でブランチ一覧を返す。
func (g *GhqResolver) GitBranches(repoPath string) ([]git.Branch, error) {
	out, err := g.Cmd.RunCommandInDir(repoPath, "git", "branch", "-a", "--no-color")
	if err != nil {
		return nil, fmt.Errorf("git branches: %w", err)
	}

	return git.ParseBranches(string(out)), nil
}

// DeleteRepo は指定されたフルパスのリポジトリを削除する。
// パス検証を行い、ghq root 配下で十分な深さ（host/owner/repo）のパスのみ許可する。
func (g *GhqResolver) DeleteRepo(fullPath string) error {
	root, err := g.GetRoot()
	if err != nil {
		return fmt.Errorf("delete repo: %w", err)
	}

	// シンボリックリンクを解決して正規化
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("delete repo: resolve root: %w", err)
	}

	resolvedPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		// パスが存在しない場合も EvalSymlinks はエラーになるので、
		// Clean だけで正規化する
		resolvedPath = filepath.Clean(fullPath)
	}

	// fullPath が root 配下であることを確認（root 自体は不可）
	if !strings.HasPrefix(resolvedPath, resolvedRoot+string(filepath.Separator)) {
		return fmt.Errorf("delete repo: path %q is outside ghq root %q", resolvedPath, resolvedRoot)
	}

	// root からの相対パスの深さが 3 以上（host/owner/repo）であることを確認
	rel, err := filepath.Rel(resolvedRoot, resolvedPath)
	if err != nil {
		return fmt.Errorf("delete repo: %w", err)
	}
	depth := len(strings.Split(rel, string(filepath.Separator)))
	if depth < 3 {
		return fmt.Errorf("delete repo: path depth %d is insufficient (need at least 3: host/owner/repo)", depth)
	}

	if err := os.RemoveAll(resolvedPath); err != nil {
		return fmt.Errorf("delete repo: %w", err)
	}

	return nil
}
