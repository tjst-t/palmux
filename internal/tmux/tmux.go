package tmux

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// Manager は tmux の操作を管理する。
// Executor を通じて tmux コマンドを実行し、結果をパースして返す。
type Manager struct {
	Exec Executor
}

// sessionFormat は list-sessions / new-session の出力フォーマット。
const sessionFormat = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}"

// windowFormat は list-windows / new-window の出力フォーマット。
const windowFormat = "#{window_index}\t#{window_name}\t#{window_active}"

// ListSessions は tmux のセッション一覧を返す。
func (m *Manager) ListSessions() ([]Session, error) {
	out, err := m.Exec.Run("list-sessions", "-F", sessionFormat)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}

	sessions, err := ParseSessions(out)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}

	return sessions, nil
}

// ListWindows は指定セッションのウィンドウ一覧を返す。
func (m *Manager) ListWindows(session string) ([]Window, error) {
	out, err := m.Exec.Run("list-windows", "-t", session, "-F", windowFormat)
	if err != nil {
		return nil, fmt.Errorf("list windows: %w", err)
	}

	windows, err := ParseWindows(out)
	if err != nil {
		return nil, fmt.Errorf("list windows: %w", err)
	}

	return windows, nil
}

// NewSession は新しい tmux セッションを作成し、作成されたセッション情報を返す。
func (m *Manager) NewSession(name string) (*Session, error) {
	out, err := m.Exec.Run("new-session", "-d", "-s", name, "-P", "-F", sessionFormat)
	if err != nil {
		return nil, fmt.Errorf("new session: %w", err)
	}

	sessions, err := ParseSessions(out)
	if err != nil {
		return nil, fmt.Errorf("new session: %w", err)
	}

	if len(sessions) == 0 {
		return nil, fmt.Errorf("new session: no session returned")
	}

	return &sessions[0], nil
}

// KillSession は指定された tmux セッションを終了する。
func (m *Manager) KillSession(name string) error {
	_, err := m.Exec.Run("kill-session", "-t", name)
	if err != nil {
		return fmt.Errorf("kill session: %w", err)
	}

	return nil
}

// NewWindow は指定セッションに新しいウィンドウを作成し、作成されたウィンドウ情報を返す。
// name が空の場合は -n フラグを省略し、tmux のデフォルト名を使用する。
func (m *Manager) NewWindow(session, name string) (*Window, error) {
	args := []string{"new-window", "-t", session}
	if name != "" {
		args = append(args, "-n", name)
	}
	args = append(args, "-P", "-F", windowFormat)

	out, err := m.Exec.Run(args...)
	if err != nil {
		return nil, fmt.Errorf("new window: %w", err)
	}

	windows, err := ParseWindows(out)
	if err != nil {
		return nil, fmt.Errorf("new window: %w", err)
	}

	if len(windows) == 0 {
		return nil, fmt.Errorf("new window: no window returned")
	}

	return &windows[0], nil
}

// KillWindow は指定セッションの指定インデックスのウィンドウを終了する。
func (m *Manager) KillWindow(session string, index int) error {
	target := fmt.Sprintf("%s:%d", session, index)
	_, err := m.Exec.Run("kill-window", "-t", target)
	if err != nil {
		return fmt.Errorf("kill window: %w", err)
	}

	return nil
}

// RenameWindow は指定セッションの指定インデックスのウィンドウをリネームする。
func (m *Manager) RenameWindow(session string, index int, name string) error {
	target := fmt.Sprintf("%s:%d", session, index)
	_, err := m.Exec.Run("rename-window", "-t", target, name)
	if err != nil {
		return fmt.Errorf("rename window: %w", err)
	}

	return nil
}

// Attach は tmux attach-session を pty 内で実行し、pty のマスター側ファイルと exec.Cmd を返す。
// 呼び出し元は返されたファイルを通じて pty と双方向に通信できる。
// 使用後は呼び出し元がファイルの Close とプロセスの Kill/Wait を行う必要がある。
func (m *Manager) Attach(session string) (*os.File, *exec.Cmd, error) {
	tmuxBin := "tmux"
	if re, ok := m.Exec.(*RealExecutor); ok && re.TmuxBin != "" {
		tmuxBin = re.TmuxBin
	}

	cmd := exec.Command(tmuxBin, "attach-session", "-t", session)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("attach session %q: %w", session, err)
	}

	return ptmx, cmd, nil
}
