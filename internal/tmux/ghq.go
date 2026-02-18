package tmux

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// CommandRunner は外部コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type CommandRunner interface {
	RunCommand(name string, args ...string) ([]byte, error)
}

// RealCommandRunner は実際のコマンドを実行する。
type RealCommandRunner struct{}

// RunCommand は指定されたコマンドを実行し、標準出力の内容を返す。
func (r *RealCommandRunner) RunCommand(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
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

// Resolve はセッション名に対応する ghq リポジトリのパスを返す。
// 対応するリポジトリが見つからない場合、または ghq が利用できない場合は HomeDir を返す。
//
// マッチングの優先順位:
//  1. basename の完全一致（最初にマッチしたものを使用）
//  2. org-basename 形式のマッチ（例: "alice-utils" → parent="alice", basename="utils"）
func (g *GhqResolver) Resolve(sessionName string) string {
	if sessionName == "" {
		return g.HomeDir
	}

	root, lines := g.ghqRepoLines()
	if lines == nil {
		return g.HomeDir
	}

	// First pass: exact basename match
	for _, line := range lines {
		if line == "" {
			continue
		}
		repoName := filepath.Base(line)
		if repoName == sessionName {
			return filepath.Join(root, line)
		}
	}

	// Second pass: org-basename match
	// sessionName が "org-basename" 形式の場合、parent(line) の Base が org、
	// filepath.Base(line) が basename に一致するかチェック
	for _, line := range lines {
		if line == "" {
			continue
		}
		repoBase := filepath.Base(line)
		repoParent := filepath.Base(filepath.Dir(line))
		orgBasename := repoParent + "-" + repoBase
		if orgBasename == sessionName {
			return filepath.Join(root, line)
		}
	}

	return g.HomeDir
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
