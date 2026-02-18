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

// Resolve はセッション名に対応する ghq リポジトリのパスを返す。
// 対応するリポジトリが見つからない場合、または ghq が利用できない場合は HomeDir を返す。
func (g *GhqResolver) Resolve(sessionName string) string {
	if sessionName == "" {
		return g.HomeDir
	}

	rootOut, err := g.Cmd.RunCommand("ghq", "root")
	if err != nil {
		return g.HomeDir
	}
	root := strings.TrimRight(string(rootOut), "\n")

	listOut, err := g.Cmd.RunCommand("ghq", "list")
	if err != nil {
		return g.HomeDir
	}

	lines := strings.Split(strings.TrimRight(string(listOut), "\n"), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		repoName := filepath.Base(line)
		if repoName == sessionName {
			return filepath.Join(root, line)
		}
	}

	return g.HomeDir
}
