package tmux

import (
	"errors"
	"fmt"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

// mockExecutor は Executor のモック実装。
// 呼び出し時の引数を記録し、設定された出力とエラーを返す。
type mockExecutor struct {
	output  []byte
	err     error
	gotArgs []string
}

func (m *mockExecutor) Run(args ...string) ([]byte, error) {
	m.gotArgs = args
	return m.output, m.err
}

// sequentialMockExecutor は複数回の Run 呼び出しに対して異なる結果を返すモック。
// calls に設定した順に結果を返す。
type sequentialMockExecutor struct {
	calls   []mockCall
	callIdx int
	gotArgs [][]string
}

type mockCall struct {
	output []byte
	err    error
}

func (m *sequentialMockExecutor) Run(args ...string) ([]byte, error) {
	m.gotArgs = append(m.gotArgs, args)
	if m.callIdx >= len(m.calls) {
		return nil, fmt.Errorf("unexpected call #%d: %v", m.callIdx, args)
	}
	c := m.calls[m.callIdx]
	m.callIdx++
	return c.output, c.err
}

// assertArgs はモックに渡された引数が期待通りか検証する。
func assertArgs(t *testing.T, mock *mockExecutor, wantArgs []string) {
	t.Helper()
	if !reflect.DeepEqual(mock.gotArgs, wantArgs) {
		t.Errorf("args = %v, want %v", mock.gotArgs, wantArgs)
	}
}

func TestManager_ListSessions(t *testing.T) {
	tests := []struct {
		name     string
		output   []byte
		err      error
		want     []Session
		wantErr  bool
		wantArgs []string
	}{
		{
			name:   "正常系: 複数セッションを返す",
			output: []byte("main\t3\t1\t1704067200\t1704070800\ndev\t2\t0\t1704153600\t1704157200\n"),
			err:    nil,
			want: []Session{
				{Name: "main", Windows: 3, Attached: true, Created: time.Unix(1704067200, 0), Activity: time.Unix(1704070800, 0)},
				{Name: "dev", Windows: 2, Attached: false, Created: time.Unix(1704153600, 0), Activity: time.Unix(1704157200, 0)},
			},
			wantErr:  false,
			wantArgs: []string{"list-sessions", "-F", sessionFormat},
		},
		{
			name:     "正常系: セッションが空の場合",
			output:   []byte(""),
			err:      nil,
			want:     []Session{},
			wantErr:  false,
			wantArgs: []string{"list-sessions", "-F", sessionFormat},
		},
		{
			name:     "異常系: Executorがエラーを返す",
			output:   nil,
			err:      errors.New("tmux not found"),
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"list-sessions", "-F", sessionFormat},
		},
		{
			name:     "異常系: パースエラー",
			output:   []byte("invalid\tdata\n"),
			err:      nil,
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"list-sessions", "-F", sessionFormat},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			got, err := m.ListSessions()
			if (err != nil) != tt.wantErr {
				t.Errorf("ListSessions() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			assertArgs(t, mock, tt.wantArgs)
			if tt.wantErr {
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ListSessions() returned %d sessions, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i].Name != tt.want[i].Name {
					t.Errorf("session[%d].Name = %q, want %q", i, got[i].Name, tt.want[i].Name)
				}
				if got[i].Windows != tt.want[i].Windows {
					t.Errorf("session[%d].Windows = %d, want %d", i, got[i].Windows, tt.want[i].Windows)
				}
				if got[i].Attached != tt.want[i].Attached {
					t.Errorf("session[%d].Attached = %v, want %v", i, got[i].Attached, tt.want[i].Attached)
				}
				if !got[i].Created.Equal(tt.want[i].Created) {
					t.Errorf("session[%d].Created = %v, want %v", i, got[i].Created, tt.want[i].Created)
				}
				if !got[i].Activity.Equal(tt.want[i].Activity) {
					t.Errorf("session[%d].Activity = %v, want %v", i, got[i].Activity, tt.want[i].Activity)
				}
			}
		})
	}
}

func TestManager_ListWindows(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		output   []byte
		err      error
		want     []Window
		wantErr  bool
		wantArgs []string
	}{
		{
			name:    "正常系: 複数ウィンドウを返す",
			session: "main",
			output:  []byte("0\tbash\t1\n1\tvim\t0\n"),
			err:     nil,
			want: []Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "vim", Active: false},
			},
			wantErr:  false,
			wantArgs: []string{"list-windows", "-t", "main", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:     "正常系: ウィンドウが空の場合",
			session:  "empty",
			output:   []byte(""),
			err:      nil,
			want:     []Window{},
			wantErr:  false,
			wantArgs: []string{"list-windows", "-t", "empty", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:     "異常系: Executorがエラーを返す",
			session:  "nonexistent",
			output:   nil,
			err:      errors.New("session not found"),
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"list-windows", "-t", "nonexistent", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:     "異常系: パースエラー",
			session:  "main",
			output:   []byte("bad\tdata\n"),
			err:      nil,
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"list-windows", "-t", "main", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			got, err := m.ListWindows(tt.session)
			if (err != nil) != tt.wantErr {
				t.Errorf("ListWindows() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			assertArgs(t, mock, tt.wantArgs)
			if tt.wantErr {
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ListWindows() returned %d windows, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i].Index != tt.want[i].Index {
					t.Errorf("window[%d].Index = %d, want %d", i, got[i].Index, tt.want[i].Index)
				}
				if got[i].Name != tt.want[i].Name {
					t.Errorf("window[%d].Name = %q, want %q", i, got[i].Name, tt.want[i].Name)
				}
				if got[i].Active != tt.want[i].Active {
					t.Errorf("window[%d].Active = %v, want %v", i, got[i].Active, tt.want[i].Active)
				}
			}
		})
	}
}

func TestManager_NewSession(t *testing.T) {
	tests := []struct {
		name     string
		sessName string
		output   []byte
		err      error
		want     *Session
		wantErr  bool
		wantArgs []string
	}{
		{
			name:     "正常系: 新しいセッションを作成",
			sessName: "myapp",
			output:   []byte("myapp\t1\t0\t1704067200\t1704067200\n"),
			err:      nil,
			want: &Session{
				Name:     "myapp",
				Windows:  1,
				Attached: false,
				Created:  time.Unix(1704067200, 0),
				Activity: time.Unix(1704067200, 0),
			},
			wantErr:  false,
			wantArgs: []string{"new-session", "-d", "-s", "myapp", "-P", "-F", sessionFormat},
		},
		{
			name:     "異常系: Executorがエラーを返す（重複セッション名など）",
			sessName: "existing",
			output:   nil,
			err:      errors.New("duplicate session: existing"),
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"new-session", "-d", "-s", "existing", "-P", "-F", sessionFormat},
		},
		{
			name:     "異常系: パースエラー（不正な出力）",
			sessName: "bad",
			output:   []byte("invalid output"),
			err:      nil,
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"new-session", "-d", "-s", "bad", "-P", "-F", sessionFormat},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			got, err := m.NewSession(tt.sessName)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewSession() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			assertArgs(t, mock, tt.wantArgs)
			if tt.wantErr {
				return
			}
			if got == nil {
				t.Fatal("NewSession() returned nil, want non-nil")
			}
			if got.Name != tt.want.Name {
				t.Errorf("session.Name = %q, want %q", got.Name, tt.want.Name)
			}
			if got.Windows != tt.want.Windows {
				t.Errorf("session.Windows = %d, want %d", got.Windows, tt.want.Windows)
			}
			if got.Attached != tt.want.Attached {
				t.Errorf("session.Attached = %v, want %v", got.Attached, tt.want.Attached)
			}
			if !got.Created.Equal(tt.want.Created) {
				t.Errorf("session.Created = %v, want %v", got.Created, tt.want.Created)
			}
			if !got.Activity.Equal(tt.want.Activity) {
				t.Errorf("session.Activity = %v, want %v", got.Activity, tt.want.Activity)
			}
		})
	}
}

func TestManager_KillSession(t *testing.T) {
	tests := []struct {
		name     string
		sessName string
		err      error
		wantErr  bool
		wantArgs []string
	}{
		{
			name:     "正常系: セッションを削除",
			sessName: "myapp",
			err:      nil,
			wantErr:  false,
			wantArgs: []string{"kill-session", "-t", "myapp"},
		},
		{
			name:     "異常系: 存在しないセッション",
			sessName: "nonexistent",
			err:      errors.New("session not found: nonexistent"),
			wantErr:  true,
			wantArgs: []string{"kill-session", "-t", "nonexistent"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: tt.err}
			m := &Manager{Exec: mock}

			err := m.KillSession(tt.sessName)
			if (err != nil) != tt.wantErr {
				t.Errorf("KillSession() error = %v, wantErr %v", err, tt.wantErr)
			}
			assertArgs(t, mock, tt.wantArgs)
		})
	}
}

func TestManager_NewWindow(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		winName  string
		winCmd   string
		output   []byte
		err      error
		want     *Window
		wantErr  bool
		wantArgs []string
	}{
		{
			name:    "正常系: 名前付きウィンドウを作成",
			session: "main",
			winName: "editor",
			winCmd:  "",
			output:  []byte("1\teditor\t1\n"),
			err:     nil,
			want: &Window{
				Index:  1,
				Name:   "editor",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-n", "editor", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:    "正常系: 名前なしウィンドウを作成（-n フラグを含まない）",
			session: "main",
			winName: "",
			winCmd:  "",
			output:  []byte("2\tbash\t1\n"),
			err:     nil,
			want: &Window{
				Index:  2,
				Name:   "bash",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:    "正常系: コマンド付きウィンドウを作成（ログインシェルでラップ）",
			session: "main",
			winName: "",
			winCmd:  "claude",
			output:  []byte("3\tclaude\t1\n"),
			err:     nil,
			want: &Window{
				Index:  3,
				Name:   "claude",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}", `exec "$SHELL" -lc 'exec claude; echo "[palmux] command not found. Press Enter to close."; read -r'`},
		},
		{
			name:    "正常系: claude --continue コマンド付きウィンドウを作成（ログインシェルでラップ）",
			session: "main",
			winName: "",
			winCmd:  "claude --continue",
			output:  []byte("4\tclaude\t1\n"),
			err:     nil,
			want: &Window{
				Index:  4,
				Name:   "claude",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}", `exec "$SHELL" -lc 'exec claude --continue; echo "[palmux] command not found. Press Enter to close."; read -r'`},
		},
		{
			name:    "正常系: claude --model opus コマンド付きウィンドウを作成（ログインシェルでラップ）",
			session: "main",
			winName: "",
			winCmd:  "claude --model opus",
			output:  []byte("5\tclaude\t1\n"),
			err:     nil,
			want: &Window{
				Index:  5,
				Name:   "claude",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}", `exec "$SHELL" -lc 'exec claude --model opus; echo "[palmux] command not found. Press Enter to close."; read -r'`},
		},
		{
			name:    "正常系: claude --continue --model sonnet コマンド付きウィンドウを作成（ログインシェルでラップ）",
			session: "dev",
			winName: "",
			winCmd:  "claude --continue --model sonnet",
			output:  []byte("2\tclaude\t1\n"),
			err:     nil,
			want: &Window{
				Index:  2,
				Name:   "claude",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "dev", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}", `exec "$SHELL" -lc 'exec claude --continue --model sonnet; echo "[palmux] command not found. Press Enter to close."; read -r'`},
		},
		{
			name:    "正常系: シングルクォートを含むコマンドのエスケープ",
			session: "main",
			winName: "",
			winCmd:  "echo 'hello world'",
			output:  []byte("6\tbash\t1\n"),
			err:     nil,
			want: &Window{
				Index:  6,
				Name:   "bash",
				Active: true,
			},
			wantErr:  false,
			wantArgs: []string{"new-window", "-t", "main", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}", `exec "$SHELL" -lc 'exec echo '"'"'hello world'"'"'; echo "[palmux] command not found. Press Enter to close."; read -r'`},
		},
		{
			name:     "異常系: Executorがエラーを返す",
			session:  "nonexistent",
			winName:  "test",
			winCmd:   "",
			output:   nil,
			err:      errors.New("session not found"),
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"new-window", "-t", "nonexistent", "-n", "test", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:     "異常系: パースエラー",
			session:  "main",
			winName:  "bad",
			winCmd:   "",
			output:   []byte("not\tvalid"),
			err:      nil,
			want:     nil,
			wantErr:  true,
			wantArgs: []string{"new-window", "-t", "main", "-n", "bad", "-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			got, err := m.NewWindow(tt.session, tt.winName, tt.winCmd)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewWindow() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			assertArgs(t, mock, tt.wantArgs)
			if tt.wantErr {
				return
			}
			if got == nil {
				t.Fatal("NewWindow() returned nil, want non-nil")
			}
			if got.Index != tt.want.Index {
				t.Errorf("window.Index = %d, want %d", got.Index, tt.want.Index)
			}
			if got.Name != tt.want.Name {
				t.Errorf("window.Name = %q, want %q", got.Name, tt.want.Name)
			}
			if got.Active != tt.want.Active {
				t.Errorf("window.Active = %v, want %v", got.Active, tt.want.Active)
			}
		})
	}
}

func TestManager_NewWindow_WithGhq(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		winName  string
		ghq      *GhqResolver
		output   []byte
		wantArgs []string
	}{
		{
			name:    "Ghq が nil の場合 -c フラグなし",
			session: "palmux",
			winName: "editor",
			ghq:     nil,
			output:  []byte("1\teditor\t1\n"),
			wantArgs: []string{"new-window", "-t", "palmux", "-n", "editor", "-P", "-F",
				"#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:    "Ghq が設定済みでマッチあり → -c フラグにリポジトリパス",
			session: "palmux",
			winName: "",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			output: []byte("1\tbash\t1\n"),
			wantArgs: []string{"new-window", "-t", "palmux",
				"-c", "/home/user/ghq/github.com/tjst-t/palmux",
				"-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
		{
			name:    "Ghq が設定済みでマッチなし → -c フラグにホームディレクトリ",
			session: "unknown",
			winName: "shell",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			output: []byte("1\tshell\t1\n"),
			wantArgs: []string{"new-window", "-t", "unknown", "-n", "shell",
				"-c", "/home/user",
				"-P", "-F", "#{window_index}\t#{window_name}\t#{window_active}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: nil}
			m := &Manager{Exec: mock, Ghq: tt.ghq}

			_, err := m.NewWindow(tt.session, tt.winName, "")
			if err != nil {
				t.Fatalf("NewWindow() unexpected error: %v", err)
			}
			assertArgs(t, mock, tt.wantArgs)
		})
	}
}

func TestManager_KillWindow(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		index    int
		err      error
		wantErr  bool
		wantArgs []string
	}{
		{
			name:     "正常系: ウィンドウを削除",
			session:  "main",
			index:    1,
			err:      nil,
			wantErr:  false,
			wantArgs: []string{"kill-window", "-t", "main:1"},
		},
		{
			name:     "正常系: インデックス0のウィンドウを削除",
			session:  "dev",
			index:    0,
			err:      nil,
			wantErr:  false,
			wantArgs: []string{"kill-window", "-t", "dev:0"},
		},
		{
			name:     "異常系: 存在しないウィンドウ",
			session:  "main",
			index:    99,
			err:      errors.New("window not found"),
			wantErr:  true,
			wantArgs: []string{"kill-window", "-t", "main:99"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: tt.err}
			m := &Manager{Exec: mock}

			err := m.KillWindow(tt.session, tt.index)
			if (err != nil) != tt.wantErr {
				t.Errorf("KillWindow() error = %v, wantErr %v", err, tt.wantErr)
			}
			assertArgs(t, mock, tt.wantArgs)
		})
	}
}

func TestManager_NewSession_EmptyOutput(t *testing.T) {
	mock := &mockExecutor{output: []byte(""), err: nil}
	m := &Manager{Exec: mock}

	got, err := m.NewSession("test")
	if err == nil {
		t.Errorf("NewSession() with empty output should return error, got session: %v", got)
	}
	if got != nil {
		t.Errorf("NewSession() with empty output should return nil, got: %v", got)
	}
}

func TestManager_NewWindow_EmptyOutput(t *testing.T) {
	mock := &mockExecutor{output: []byte(""), err: nil}
	m := &Manager{Exec: mock}

	got, err := m.NewWindow("main", "test", "")
	if err == nil {
		t.Errorf("NewWindow() with empty output should return error, got window: %v", got)
	}
	if got != nil {
		t.Errorf("NewWindow() with empty output should return nil, got: %v", got)
	}
}

func TestManager_ErrorMessages(t *testing.T) {
	t.Run("ListSessionsのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		_, err := m.ListSessions()
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "list sessions") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("ListWindowsのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		_, err := m.ListWindows("main")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "list windows") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("NewSessionのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		_, err := m.NewSession("test")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "new session") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("KillSessionのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		err := m.KillSession("test")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "kill session") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("NewWindowのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		_, err := m.NewWindow("main", "test", "")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "new window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("KillWindowのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		err := m.KillWindow("main", 0)
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "kill window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("RenameWindowのエラーメッセージにコンテキストが含まれる", func(t *testing.T) {
		mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
		m := &Manager{Exec: mock}

		err := m.RenameWindow("main", 0, "new-name")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(err.Error(), "rename window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})
}

func TestManager_RenameWindow(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		index    int
		newName  string
		err      error
		wantErr  bool
		wantArgs []string
	}{
		{
			name:     "正常系: ウィンドウをリネーム",
			session:  "main",
			index:    1,
			newName:  "editor",
			err:      nil,
			wantErr:  false,
			wantArgs: []string{"rename-window", "-t", "main:1", "editor"},
		},
		{
			name:     "正常系: インデックス0のウィンドウをリネーム",
			session:  "dev",
			index:    0,
			newName:  "shell",
			err:      nil,
			wantErr:  false,
			wantArgs: []string{"rename-window", "-t", "dev:0", "shell"},
		},
		{
			name:     "異常系: 存在しないウィンドウ",
			session:  "main",
			index:    99,
			newName:  "test",
			err:      errors.New("window not found"),
			wantErr:  true,
			wantArgs: []string{"rename-window", "-t", "main:99", "test"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: tt.err}
			m := &Manager{Exec: mock}

			err := m.RenameWindow(tt.session, tt.index, tt.newName)
			if (err != nil) != tt.wantErr {
				t.Errorf("RenameWindow() error = %v, wantErr %v", err, tt.wantErr)
			}
			assertArgs(t, mock, tt.wantArgs)
		})
	}
}

func TestManager_RenameWindow_TargetFormat(t *testing.T) {
	// RenameWindow が session:index の形式で正しくターゲットを組み立てるか検証
	tests := []struct {
		session    string
		index      int
		newName    string
		wantTarget string
	}{
		{"main", 0, "bash", "main:0"},
		{"dev", 5, "vim", "dev:5"},
		{"my-session", 10, "htop", "my-session:10"},
	}

	for _, tt := range tests {
		name := fmt.Sprintf("session=%s,index=%d", tt.session, tt.index)
		t.Run(name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: nil}
			m := &Manager{Exec: mock}

			_ = m.RenameWindow(tt.session, tt.index, tt.newName)
			wantArgs := []string{"rename-window", "-t", tt.wantTarget, tt.newName}
			assertArgs(t, mock, wantArgs)
		})
	}
}

func TestManager_ListSessions_NoServerRunning(t *testing.T) {
	// tmux サーバーが起動していない場合、exec.ExitError (exit status 1) + stderr "no server running" を返す。
	// この場合は空のセッション一覧を返すべき。
	exitErr := &exec.ExitError{
		ProcessState: nil,
		Stderr:       []byte("no server running on /tmp/tmux-1000/default"),
	}
	mock := &mockExecutor{output: nil, err: exitErr}
	m := &Manager{Exec: mock}

	got, err := m.ListSessions()
	if err != nil {
		t.Errorf("ListSessions() should return empty list for no server, got error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("ListSessions() should return empty list, got %d sessions", len(got))
	}
}

func TestManager_KillWindow_TargetFormat(t *testing.T) {
	// KillWindow が session:index の形式で正しくターゲットを組み立てるか検証
	tests := []struct {
		session    string
		index      int
		wantTarget string
	}{
		{"main", 0, "main:0"},
		{"dev", 5, "dev:5"},
		{"my-session", 10, "my-session:10"},
	}

	for _, tt := range tests {
		name := fmt.Sprintf("session=%s,index=%d", tt.session, tt.index)
		t.Run(name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: nil}
			m := &Manager{Exec: mock}

			_ = m.KillWindow(tt.session, tt.index)
			wantArgs := []string{"kill-window", "-t", tt.wantTarget}
			assertArgs(t, mock, wantArgs)
		})
	}
}

func TestManager_GetSessionCwd(t *testing.T) {
	tests := []struct {
		name     string
		session  string
		output   []byte
		err      error
		want     string
		wantErr  bool
		wantArgs []string
	}{
		{
			name:     "正常系: カレントパスを返す",
			session:  "main",
			output:   []byte("/home/user/projects/palmux\n"),
			err:      nil,
			want:     "/home/user/projects/palmux",
			wantErr:  false,
			wantArgs: []string{"display-message", "-p", "-t", "main", "#{pane_current_path}"},
		},
		{
			name:     "正常系: ルートディレクトリ",
			session:  "root",
			output:   []byte("/\n"),
			err:      nil,
			want:     "/",
			wantErr:  false,
			wantArgs: []string{"display-message", "-p", "-t", "root", "#{pane_current_path}"},
		},
		{
			name:     "正常系: 末尾改行なし",
			session:  "dev",
			output:   []byte("/tmp"),
			err:      nil,
			want:     "/tmp",
			wantErr:  false,
			wantArgs: []string{"display-message", "-p", "-t", "dev", "#{pane_current_path}"},
		},
		{
			name:    "異常系: セッションが存在しない",
			session: "nonexistent",
			output:  nil,
			err: &exec.ExitError{
				ProcessState: nil,
				Stderr:       []byte("can't find session: nonexistent"),
			},
			want:     "",
			wantErr:  true,
			wantArgs: []string{"display-message", "-p", "-t", "nonexistent", "#{pane_current_path}"},
		},
		{
			name:     "異常系: その他のエラー",
			session:  "main",
			output:   nil,
			err:      errors.New("connection refused"),
			want:     "",
			wantErr:  true,
			wantArgs: []string{"display-message", "-p", "-t", "main", "#{pane_current_path}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			got, err := m.GetSessionCwd(tt.session)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetSessionCwd() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			assertArgs(t, mock, tt.wantArgs)
			if !tt.wantErr && got != tt.want {
				t.Errorf("GetSessionCwd() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestManager_GetSessionCwd_SessionNotFound(t *testing.T) {
	// セッションが存在しない場合、ErrSessionNotFound を返す
	exitErr := &exec.ExitError{
		ProcessState: nil,
		Stderr:       []byte("can't find session: nonexistent"),
	}
	mock := &mockExecutor{output: nil, err: exitErr}
	m := &Manager{Exec: mock}

	_, err := m.GetSessionCwd("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("error should be ErrSessionNotFound, got: %v", err)
	}
}

func TestManager_GetSessionCwd_OtherError(t *testing.T) {
	// セッション未存在以外のエラーは ErrSessionNotFound ではない
	mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
	m := &Manager{Exec: mock}

	_, err := m.GetSessionCwd("main")
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrSessionNotFound) {
		t.Errorf("error should NOT be ErrSessionNotFound for non-session errors, got: %v", err)
	}
}

func TestManager_GetSessionCwd_ErrorMessage(t *testing.T) {
	mock := &mockExecutor{output: nil, err: errors.New("connection refused")}
	m := &Manager{Exec: mock}

	_, err := m.GetSessionCwd("main")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "get session cwd") {
		t.Errorf("error message should contain context, got: %q", err.Error())
	}
}

func TestManager_NewSession_WithGhq(t *testing.T) {
	tests := []struct {
		name     string
		sessName string
		ghq      *GhqResolver
		output   []byte
		wantArgs []string
	}{
		{
			name:     "Ghq が nil の場合 -c フラグなし",
			sessName: "palmux",
			ghq:      nil,
			output:   []byte("palmux\t1\t0\t1704067200\t1704067200\n"),
			wantArgs: []string{"new-session", "-d", "-s", "palmux", "-P", "-F", sessionFormat},
		},
		{
			name:     "Ghq が設定済みでマッチあり → -c フラグにリポジトリパス",
			sessName: "palmux",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			output:   []byte("palmux\t1\t0\t1704067200\t1704067200\n"),
			wantArgs: []string{"new-session", "-d", "-s", "palmux", "-c", "/home/user/ghq/github.com/tjst-t/palmux", "-P", "-F", sessionFormat},
		},
		{
			name:     "Ghq が設定済みでマッチなし → -c フラグにホームディレクトリ",
			sessName: "unknown",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			output:   []byte("unknown\t1\t0\t1704067200\t1704067200\n"),
			wantArgs: []string{"new-session", "-d", "-s", "unknown", "-c", "/home/user", "-P", "-F", sessionFormat},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: nil}
			m := &Manager{Exec: mock, Ghq: tt.ghq}

			_, err := m.NewSession(tt.sessName)
			if err != nil {
				t.Fatalf("NewSession() unexpected error: %v", err)
			}
			assertArgs(t, mock, tt.wantArgs)
		})
	}
}

func TestManager_GetSessionProjectDir(t *testing.T) {
	tests := []struct {
		name    string
		ghq     *GhqResolver
		session string
		cwdOut  []byte
		cwdErr  error
		want    string
		wantErr bool
	}{
		{
			name: "Ghq マッチあり → ghq パスを返す（pane CWD は使わない）",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			session: "palmux",
			want:    "/home/user/ghq/github.com/tjst-t/palmux",
			wantErr: false,
		},
		{
			name: "Ghq マッチなし → pane CWD にフォールバック",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			session: "unknown",
			cwdOut:  []byte("/tmp/working\n"),
			want:    "/tmp/working",
			wantErr: false,
		},
		{
			name:    "Ghq nil → pane CWD にフォールバック",
			ghq:     nil,
			session: "main",
			cwdOut:  []byte("/home/user/projects\n"),
			want:    "/home/user/projects",
			wantErr: false,
		},
		{
			name: "Ghq マッチなし + pane CWD エラー → エラーを返す",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			session: "unknown",
			cwdErr:  errors.New("connection refused"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.cwdOut, err: tt.cwdErr}
			m := &Manager{Exec: mock, Ghq: tt.ghq}

			got, err := m.GetSessionProjectDir(tt.session)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetSessionProjectDir() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("GetSessionProjectDir() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestManager_ListGhqRepos(t *testing.T) {
	tests := []struct {
		name    string
		ghq     *GhqResolver
		want    []GhqRepo
		wantErr bool
	}{
		{
			name: "Ghq が nil の場合: 空配列を返す",
			ghq:  nil,
			want: []GhqRepo{},
		},
		{
			name: "Ghq が設定済みでリポジトリあり",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n")},
				}},
				HomeDir: "/home/user",
			},
			want: []GhqRepo{
				{Name: "palmux", Path: "github.com/tjst-t/palmux", FullPath: "/home/user/ghq/github.com/tjst-t/palmux"},
				{Name: "go", Path: "github.com/golang/go", FullPath: "/home/user/ghq/github.com/golang/go"},
			},
		},
		{
			name: "Ghq が設定済みでリポジトリなし",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("")},
				}},
				HomeDir: "/home/user",
			},
			want: []GhqRepo{},
		},
		{
			name: "ghq コマンドが利用不可",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {err: errors.New("command not found")},
				}},
				HomeDir: "/home/user",
			},
			want: []GhqRepo{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: nil}
			m := &Manager{Exec: mock, Ghq: tt.ghq}

			got, err := m.ListGhqRepos()
			if (err != nil) != tt.wantErr {
				t.Errorf("ListGhqRepos() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ListGhqRepos() returned %d repos, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i].Name != tt.want[i].Name {
					t.Errorf("repo[%d].Name = %q, want %q", i, got[i].Name, tt.want[i].Name)
				}
				if got[i].Path != tt.want[i].Path {
					t.Errorf("repo[%d].Path = %q, want %q", i, got[i].Path, tt.want[i].Path)
				}
				if got[i].FullPath != tt.want[i].FullPath {
					t.Errorf("repo[%d].FullPath = %q, want %q", i, got[i].FullPath, tt.want[i].FullPath)
				}
			}
		})
	}
}

func TestManager_IsGhqSession(t *testing.T) {
	tests := []struct {
		name    string
		ghq     *GhqResolver
		session string
		want    bool
	}{
		{
			name: "ghq マッチあり → true",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			session: "palmux",
			want:    true,
		},
		{
			name: "ghq マッチなし → false",
			ghq: &GhqResolver{
				Cmd: &mockCommandRunner{results: map[string]mockResult{
					"ghq root": {output: []byte("/home/user/ghq\n")},
					"ghq list": {output: []byte("github.com/tjst-t/palmux\n")},
				}},
				HomeDir: "/home/user",
			},
			session: "unknown",
			want:    false,
		},
		{
			name:    "ghq nil → false",
			ghq:     nil,
			session: "palmux",
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: nil, err: nil}
			m := &Manager{Exec: mock, Ghq: tt.ghq}

			got := m.IsGhqSession(tt.session)
			if got != tt.want {
				t.Errorf("IsGhqSession(%q) = %v, want %v", tt.session, got, tt.want)
			}
		})
	}
}

func TestManager_EnsureClaudeWindow(t *testing.T) {
	t.Run("既存の claude ウィンドウがある場合: 作成しない", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n1\tclaude\t0\n")}, // ListWindows
			},
		}
		m := &Manager{Exec: mock}

		win, err := m.EnsureClaudeWindow("palmux", "claude")
		if err != nil {
			t.Fatalf("EnsureClaudeWindow() unexpected error: %v", err)
		}
		if win.Index != 1 {
			t.Errorf("window.Index = %d, want 1", win.Index)
		}
		if win.Name != "claude" {
			t.Errorf("window.Name = %q, want %q", win.Name, "claude")
		}
		if mock.callIdx != 1 {
			t.Errorf("expected 1 call (ListWindows only), got %d", mock.callIdx)
		}
	})

	t.Run("claude ウィンドウがない場合: 新規作成", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n")},            // ListWindows
				{output: []byte("1\tclaude\t1\n")},           // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		win, err := m.EnsureClaudeWindow("palmux", "claude")
		if err != nil {
			t.Fatalf("EnsureClaudeWindow() unexpected error: %v", err)
		}
		if win.Index != 1 {
			t.Errorf("window.Index = %d, want 1", win.Index)
		}
		if win.Name != "claude" {
			t.Errorf("window.Name = %q, want %q", win.Name, "claude")
		}
		if mock.callIdx != 2 {
			t.Errorf("expected 2 calls (ListWindows + NewWindow), got %d", mock.callIdx)
		}
	})

	t.Run("ListWindows エラー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{err: errors.New("session not found")},
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.EnsureClaudeWindow("palmux", "claude")
		if err == nil {
			t.Fatal("EnsureClaudeWindow() expected error, got nil")
		}
	})

	t.Run("NewWindow エラー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n")},                // ListWindows
				{err: errors.New("failed to create window")},     // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.EnsureClaudeWindow("palmux", "claude")
		if err == nil {
			t.Fatal("EnsureClaudeWindow() expected error, got nil")
		}
	})
}

func TestManager_ReplaceClaudeWindow(t *testing.T) {
	t.Run("正常系: 既存の claude ウィンドウに Ctrl+C を送信してから kill して再作成", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n1\tclaude\t0\n")},   // ListWindows
				{output: nil, err: nil},                           // SendKeys (C-c)
				{output: nil, err: nil},                           // KillWindow
				{output: []byte("2\tclaude\t1\n")},                // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		win, err := m.ReplaceClaudeWindow("palmux", "claude", "claude --model opus")
		if err != nil {
			t.Fatalf("ReplaceClaudeWindow() unexpected error: %v", err)
		}
		if win.Index != 2 {
			t.Errorf("window.Index = %d, want 2", win.Index)
		}
		if win.Name != "claude" {
			t.Errorf("window.Name = %q, want %q", win.Name, "claude")
		}
		if mock.callIdx != 4 {
			t.Errorf("expected 4 calls (ListWindows + SendKeys + KillWindow + NewWindow), got %d", mock.callIdx)
		}
		// SendKeys (C-c) の引数を検証
		sendKeysArgs := mock.gotArgs[1]
		wantSendKeysArgs := []string{"send-keys", "-t", "palmux:1", "C-c"}
		if !reflect.DeepEqual(sendKeysArgs, wantSendKeysArgs) {
			t.Errorf("SendKeys args = %v, want %v", sendKeysArgs, wantSendKeysArgs)
		}
		// KillWindow の引数を検証
		killArgs := mock.gotArgs[2]
		wantKillArgs := []string{"kill-window", "-t", "palmux:1"}
		if !reflect.DeepEqual(killArgs, wantKillArgs) {
			t.Errorf("KillWindow args = %v, want %v", killArgs, wantKillArgs)
		}
	})

	t.Run("正常系: claude ウィンドウが存在しない場合は新規作成のみ", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n")},    // ListWindows
				{output: []byte("1\tclaude\t1\n")},   // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		win, err := m.ReplaceClaudeWindow("palmux", "claude", "claude --model sonnet")
		if err != nil {
			t.Fatalf("ReplaceClaudeWindow() unexpected error: %v", err)
		}
		if win.Index != 1 {
			t.Errorf("window.Index = %d, want 1", win.Index)
		}
		if mock.callIdx != 2 {
			t.Errorf("expected 2 calls (ListWindows + NewWindow), got %d", mock.callIdx)
		}
	})

	t.Run("異常系: ListWindows エラー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{err: errors.New("session not found")},
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.ReplaceClaudeWindow("palmux", "claude", "claude")
		if err == nil {
			t.Fatal("ReplaceClaudeWindow() expected error, got nil")
		}
		if !strings.Contains(err.Error(), "replace claude window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("異常系: SendKeys エラーでも KillWindow にフォールスルー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n1\tclaude\t0\n")},   // ListWindows
				{err: errors.New("send failed")},                   // SendKeys (ignored)
				{output: nil, err: nil},                           // KillWindow
				{output: []byte("2\tclaude\t1\n")},                // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		win, err := m.ReplaceClaudeWindow("palmux", "claude", "claude")
		if err != nil {
			t.Fatalf("ReplaceClaudeWindow() unexpected error: %v", err)
		}
		if win.Index != 2 {
			t.Errorf("window.Index = %d, want 2", win.Index)
		}
		if mock.callIdx != 4 {
			t.Errorf("expected 4 calls, got %d", mock.callIdx)
		}
	})

	t.Run("異常系: KillWindow エラー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n1\tclaude\t0\n")},   // ListWindows
				{output: nil, err: nil},                           // SendKeys
				{err: errors.New("kill failed")},                   // KillWindow
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.ReplaceClaudeWindow("palmux", "claude", "claude")
		if err == nil {
			t.Fatal("ReplaceClaudeWindow() expected error, got nil")
		}
		if !strings.Contains(err.Error(), "replace claude window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})

	t.Run("異常系: NewWindow エラー", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: []byte("0\tbash\t1\n1\tclaude\t0\n")},   // ListWindows
				{output: nil, err: nil},                           // SendKeys
				{output: nil, err: nil},                           // KillWindow
				{err: errors.New("create failed")},                 // NewWindow
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.ReplaceClaudeWindow("palmux", "claude", "claude")
		if err == nil {
			t.Fatal("ReplaceClaudeWindow() expected error, got nil")
		}
		if !strings.Contains(err.Error(), "replace claude window") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})
}

func TestManager_SendKeys(t *testing.T) {
	t.Run("正常系: send-keys でキーを送信する", func(t *testing.T) {
		mock := &mockExecutor{}
		m := &Manager{Exec: mock}

		err := m.SendKeys("mysession", 1, "C-c")
		if err != nil {
			t.Fatalf("SendKeys() unexpected error: %v", err)
		}
		wantArgs := []string{"send-keys", "-t", "mysession:1", "C-c"}
		if !reflect.DeepEqual(mock.gotArgs, wantArgs) {
			t.Errorf("args = %v, want %v", mock.gotArgs, wantArgs)
		}
	})

	t.Run("異常系: tmux エラー", func(t *testing.T) {
		mock := &mockExecutor{err: errors.New("pane not found")}
		m := &Manager{Exec: mock}

		err := m.SendKeys("mysession", 0, "C-c")
		if err == nil {
			t.Fatal("SendKeys() expected error, got nil")
		}
		if !strings.Contains(err.Error(), "send keys") {
			t.Errorf("error message should contain context, got: %q", err.Error())
		}
	})
}

func TestManager_GetClientSessionWindow(t *testing.T) {
	tests := []struct {
		name        string
		output      []byte
		err         error
		wantSession string
		wantWindow  int
		wantErr     bool
		wantArgs    []string
	}{
		{
			name:        "正常系: セッション名とウィンドウインデックスを返す",
			output:      []byte("main\t2\t\n"),
			wantSession: "main",
			wantWindow:  2,
			wantArgs:    []string{"display-message", "-p", "-t", "/dev/pts/5", "#{session_name}\t#{window_index}\t#{session_group}"},
		},
		{
			name:        "正常系: 別セッション",
			output:      []byte("dev\t0\t\n"),
			wantSession: "dev",
			wantWindow:  0,
			wantArgs:    []string{"display-message", "-p", "-t", "/dev/pts/5", "#{session_name}\t#{window_index}\t#{session_group}"},
		},
		{
			name:        "正常系: グループセッション（元のセッション名を返す）",
			output:      []byte("_palmux_abc123\t3\tmain\n"),
			wantSession: "main",
			wantWindow:  3,
			wantArgs:    []string{"display-message", "-p", "-t", "/dev/pts/5", "#{session_name}\t#{window_index}\t#{session_group}"},
		},
		{
			name:     "エラー系: tmux エラー",
			err:      fmt.Errorf("no client on /dev/pts/5"),
			wantErr:  true,
			wantArgs: []string{"display-message", "-p", "-t", "/dev/pts/5", "#{session_name}\t#{window_index}\t#{session_group}"},
		},
		{
			name:     "エラー系: 不正な出力",
			output:   []byte("onlyone\n"),
			wantErr:  true,
			wantArgs: []string{"display-message", "-p", "-t", "/dev/pts/5", "#{session_name}\t#{window_index}\t#{session_group}"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &mockExecutor{output: tt.output, err: tt.err}
			m := &Manager{Exec: mock}

			gotSession, gotWindow, err := m.GetClientSessionWindow("/dev/pts/5")

			assertArgs(t, mock, tt.wantArgs)

			if (err != nil) != tt.wantErr {
				t.Fatalf("GetClientSessionWindow() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if gotSession != tt.wantSession {
				t.Errorf("session = %q, want %q", gotSession, tt.wantSession)
			}
			if gotWindow != tt.wantWindow {
				t.Errorf("window = %d, want %d", gotWindow, tt.wantWindow)
			}
		})
	}
}

func TestManager_CreateGroupedSession(t *testing.T) {
	t.Run("正常系: グループセッション作成後にステータスバーを無効化する", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: nil, err: nil}, // new-session
				{output: nil, err: nil}, // set-option status off
			},
		}
		m := &Manager{Exec: mock}

		name, err := m.CreateGroupedSession("main")
		if err != nil {
			t.Fatalf("CreateGroupedSession() error = %v", err)
		}

		if !strings.HasPrefix(name, GroupedSessionPrefix) {
			t.Errorf("name = %q, want prefix %q", name, GroupedSessionPrefix)
		}

		// 2回の呼び出しを検証
		if len(mock.gotArgs) != 2 {
			t.Fatalf("expected 2 calls, got %d", len(mock.gotArgs))
		}

		// 1回目: new-session
		wantFirst := []string{"new-session", "-d", "-t", "main", "-s", name}
		if !reflect.DeepEqual(mock.gotArgs[0], wantFirst) {
			t.Errorf("call 0 args = %v, want %v", mock.gotArgs[0], wantFirst)
		}

		// 2回目: set-option status off
		wantSecond := []string{"set-option", "-t", name, "status", "off"}
		if !reflect.DeepEqual(mock.gotArgs[1], wantSecond) {
			t.Errorf("call 1 args = %v, want %v", mock.gotArgs[1], wantSecond)
		}
	})

	t.Run("異常系: new-session が失敗した場合", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: nil, err: fmt.Errorf("session not found")},
			},
		}
		m := &Manager{Exec: mock}

		_, err := m.CreateGroupedSession("nonexistent")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})

	t.Run("正常系: set-option が失敗してもエラーにならない", func(t *testing.T) {
		mock := &sequentialMockExecutor{
			calls: []mockCall{
				{output: nil, err: nil},                          // new-session OK
				{output: nil, err: fmt.Errorf("option failed")}, // set-option fails
			},
		}
		m := &Manager{Exec: mock}

		name, err := m.CreateGroupedSession("main")
		if err != nil {
			t.Fatalf("CreateGroupedSession() should not fail when set-option fails, got error = %v", err)
		}

		if !strings.HasPrefix(name, GroupedSessionPrefix) {
			t.Errorf("name = %q, want prefix %q", name, GroupedSessionPrefix)
		}
	})
}
