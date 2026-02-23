package tmux

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/creack/pty"
)

// GroupedSessionPrefix は Palmux が作成するグループセッションの名前プレフィクス。
// 同一セッションに複数クライアントが接続する際、各クライアントに独立した
// ウィンドウ選択を提供するために tmux セッショングループを使用する。
const GroupedSessionPrefix = "_palmux_"

// Manager は tmux の操作を管理する。
// Executor を通じて tmux コマンドを実行し、結果をパースして返す。
type Manager struct {
	Exec Executor
	Ghq  *GhqResolver
}

// sessionFormat は list-sessions / new-session の出力フォーマット。
const sessionFormat = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_activity}"

// windowFormat は list-windows / new-window の出力フォーマット。
const windowFormat = "#{window_index}\t#{window_name}\t#{window_active}"

// ErrSessionNotFound はセッションが見つからない場合のエラー。
var ErrSessionNotFound = errors.New("session not found")

// isNoServerError は tmux サーバーが起動していない場合のエラーを判定する。
// tmux サーバー未起動時は exit code 1 で "no server running" を含むメッセージを返す。
func isNoServerError(err error) bool {
	var exitErr *exec.ExitError
	if ok := errors.As(err, &exitErr); ok {
		stderr := string(exitErr.Stderr)
		return strings.Contains(stderr, "no server running")
	}
	return false
}

// isSessionNotFoundError はセッションが見つからない場合のエラーを判定する。
// tmux がセッションを見つけられない場合、exit code 1 で "can't find session" を含むメッセージを返す。
func isSessionNotFoundError(err error) bool {
	var exitErr *exec.ExitError
	if ok := errors.As(err, &exitErr); ok {
		stderr := string(exitErr.Stderr)
		return strings.Contains(stderr, "can't find session")
	}
	return false
}

// ListSessions は tmux のセッション一覧を返す。
// tmux サーバーが起動していない場合は空のスライスを返す。
// Palmux が内部的に作成したグループセッション（_palmux_ プレフィクス）は除外する。
func (m *Manager) ListSessions() ([]Session, error) {
	out, err := m.Exec.Run("list-sessions", "-F", sessionFormat)
	if err != nil {
		if isNoServerError(err) {
			return []Session{}, nil
		}
		return nil, fmt.Errorf("list sessions: %w", err)
	}

	sessions, err := ParseSessions(out)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}

	// グループセッション（_palmux_ プレフィクス）を除外
	filtered := make([]Session, 0, len(sessions))
	for _, s := range sessions {
		if !strings.HasPrefix(s.Name, GroupedSessionPrefix) {
			filtered = append(filtered, s)
		}
	}

	return filtered, nil
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
	args := []string{"new-session", "-d", "-s", name}
	if m.Ghq != nil {
		dir := m.Ghq.Resolve(name)
		args = append(args, "-c", dir)
	}
	args = append(args, "-P", "-F", sessionFormat)

	out, err := m.Exec.Run(args...)
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
// command が空でない場合はウィンドウ内で指定コマンドを実行する。
// コマンドはログインシェル経由で実行し、PATH 等の環境変数を確実に設定する。
func (m *Manager) NewWindow(session, name, command string) (*Window, error) {
	args := []string{"new-window", "-t", session}
	if name != "" {
		args = append(args, "-n", name)
	}
	if m.Ghq != nil {
		dir := m.Ghq.Resolve(session)
		args = append(args, "-c", dir)
	}
	args = append(args, "-P", "-F", windowFormat)
	if command != "" {
		// tmux new-window は $SHELL -c "command" で実行するが、非ログインシェルのため
		// ~/.bash_profile 等で設定される PATH が効かない。
		// ログインシェルでラップすることで claude 等のコマンドが確実に見つかるようにする。
		// exec でコマンドを実行し、bash をコマンドに置き換える。
		// これにより tmux の pane_current_command がコマンド名（例: claude）を正しく返す。
		// exec 失敗時（コマンド未検出等）はエラー表示して Enter 待ちにする。
		escaped := strings.ReplaceAll(command, "'", `'"'"'`)
		wrapped := fmt.Sprintf(
			`exec "$SHELL" -lc 'exec %s; echo "[palmux] command not found. Press Enter to close."; read -r'`,
			escaped,
		)
		args = append(args, wrapped)
	}

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

// GetSessionCwd はセッションのアクティブ pane のカレントパスを返す。
// セッションが存在しない場合は ErrSessionNotFound を返す。
func (m *Manager) GetSessionCwd(session string) (string, error) {
	out, err := m.Exec.Run("display-message", "-p", "-t", session, "#{pane_current_path}")
	if err != nil {
		if isSessionNotFoundError(err) {
			return "", fmt.Errorf("get session cwd: %w", ErrSessionNotFound)
		}
		return "", fmt.Errorf("get session cwd: %w", err)
	}

	return strings.TrimRight(string(out), "\n"), nil
}

// GetClientSessionWindow は指定した tty のクライアントが現在表示している
// セッション名とウィンドウインデックスを返す。
// tty には pts のデバイスパス（例: /dev/pts/5）を渡す。
// グループセッション内のクライアントの場合、グループ名（元のセッション名）を返す。
func (m *Manager) GetClientSessionWindow(tty string) (string, int, error) {
	out, err := m.Exec.Run("display-message", "-p", "-t", tty, "#{session_name}\t#{window_index}\t#{session_group}")
	if err != nil {
		return "", -1, fmt.Errorf("get client session window: %w", err)
	}
	line := strings.TrimSpace(string(out))
	parts := strings.SplitN(line, "\t", 3)
	if len(parts) < 2 {
		return "", -1, fmt.Errorf("get client session window: unexpected output %q", out)
	}
	winIndex, err := strconv.Atoi(parts[1])
	if err != nil {
		return "", -1, fmt.Errorf("get client session window: invalid window index %q: %w", parts[1], err)
	}

	sessionName := parts[0]
	// グループセッションの場合、グループ名（元のセッション名）を返す
	if len(parts) == 3 && parts[2] != "" {
		sessionName = parts[2]
	}

	return sessionName, winIndex, nil
}

// GetSessionProjectDir はセッションの ghq プロジェクトディレクトリを返す。
// Ghq が設定されていてセッション名に対応するリポジトリが存在する場合はそのパスを返す。
// それ以外の場合はアクティブ pane のカレントパスにフォールバックする。
func (m *Manager) GetSessionProjectDir(session string) (string, error) {
	if m.Ghq != nil {
		dir := m.Ghq.Resolve(session)
		if dir != m.Ghq.HomeDir {
			return dir, nil
		}
	}
	return m.GetSessionCwd(session)
}

// CreateGroupedSession は対象セッションにリンクしたグループセッションを作成する。
// 各グループセッションは独立したウィンドウ選択を持つ。
// 返されるグループセッション名は _palmux_ プレフィクス付きのランダムな名前。
func (m *Manager) CreateGroupedSession(target string) (string, error) {
	name := GroupedSessionPrefix + randomHex(8)
	_, err := m.Exec.Run("new-session", "-d", "-t", target, "-s", name)
	if err != nil {
		return "", fmt.Errorf("create grouped session for %q: %w", target, err)
	}
	return name, nil
}

// DestroyGroupedSession はグループセッションを破棄する。
// セッションが既に存在しない場合でもエラーは無視される。
func (m *Manager) DestroyGroupedSession(name string) error {
	_, err := m.Exec.Run("kill-session", "-t", name)
	if err != nil {
		return fmt.Errorf("destroy grouped session %q: %w", name, err)
	}
	return nil
}

// CleanupGroupedSessions は残存する全ての _palmux_ プレフィクス付きセッションを破棄する。
// サーバー起動時に呼び出し、前回のクラッシュ等で残ったグループセッションを掃除する。
func (m *Manager) CleanupGroupedSessions() int {
	out, err := m.Exec.Run("list-sessions", "-F", "#{session_name}")
	if err != nil {
		return 0
	}
	cleaned := 0
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		name := strings.TrimSpace(line)
		if name != "" && strings.HasPrefix(name, GroupedSessionPrefix) {
			if _, err := m.Exec.Run("kill-session", "-t", name); err == nil {
				cleaned++
			}
		}
	}
	return cleaned
}

// randomHex は指定バイト数のランダムな16進文字列を返す。
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", b) // フォールバック
	}
	return hex.EncodeToString(b)
}

// Attach は tmux attach-session を pty 内で実行し、pty のマスター側ファイルと exec.Cmd を返す。
// windowIndex が 0 以上の場合、接続後に指定ウィンドウを選択する。
// 呼び出し元は返されたファイルを通じて pty と双方向に通信できる。
// 使用後は呼び出し元がファイルの Close とプロセスの Kill/Wait を行う必要がある。
func (m *Manager) Attach(session string, windowIndex int) (*os.File, *exec.Cmd, error) {
	tmuxBin := "tmux"
	if re, ok := m.Exec.(*RealExecutor); ok && re.TmuxBin != "" {
		tmuxBin = re.TmuxBin
	}

	args := []string{"attach-session", "-t", session}
	if windowIndex >= 0 {
		target := fmt.Sprintf("%s:%d", session, windowIndex)
		args = append(args, ";", "select-window", "-t", target)
	}

	cmd := exec.Command(tmuxBin, args...)
	// xterm.js は xterm 互換ターミナルなので TERM=xterm-256color を設定する。
	// これにより tmux が外側ターミナルの OSC 52 サポートを正しく検出し、
	// クリップボード同期（set-clipboard）が機能する。
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("attach session %q: %w", session, err)
	}

	return ptmx, cmd, nil
}

// ListGhqRepos は ghq リポジトリ一覧を返す。
// GhqResolver が未設定の場合は空スライスを返す。
func (m *Manager) ListGhqRepos() ([]GhqRepo, error) {
	if m.Ghq == nil {
		return []GhqRepo{}, nil
	}
	return m.Ghq.ListRepos()
}

// CloneGhqRepo は ghq get でリポジトリをクローンし、クローンされたリポジトリ情報を返す。
// GhqResolver が未設定の場合はエラーを返す。
func (m *Manager) CloneGhqRepo(url string) (*GhqRepo, error) {
	if m.Ghq == nil {
		return nil, fmt.Errorf("ghq is not configured")
	}
	return m.Ghq.CloneRepo(url)
}

// DeleteGhqRepo は指定パスのリポジトリを削除する。
// GhqResolver が未設定の場合はエラーを返す。
func (m *Manager) DeleteGhqRepo(fullPath string) error {
	if m.Ghq == nil {
		return fmt.Errorf("ghq is not configured")
	}
	return m.Ghq.DeleteRepo(fullPath)
}
