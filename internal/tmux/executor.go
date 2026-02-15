package tmux

import "os/exec"

// Executor は tmux コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type Executor interface {
	Run(args ...string) ([]byte, error)
}

// RealExecutor は実際の tmux バイナリを実行する。
type RealExecutor struct {
	TmuxBin string
}

// Run は tmux コマンドを実行し、標準出力の内容を返す。
func (e *RealExecutor) Run(args ...string) ([]byte, error) {
	return exec.Command(e.TmuxBin, args...).Output()
}
