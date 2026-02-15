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
			name:     "異常系: Executorがエラーを返す",
			session:  "nonexistent",
			winName:  "test",
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

			got, err := m.NewWindow(tt.session, tt.winName)
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

	got, err := m.NewWindow("main", "test")
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

		_, err := m.NewWindow("main", "test")
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
