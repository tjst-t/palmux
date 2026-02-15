package tmux

import (
	"os"
	"testing"
	"time"
)

func TestParseSessions(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		want    []Session
		wantErr bool
	}{
		{
			name:  "複数セッションのパース",
			input: []byte("main\t3\t1\t1704067200\t1704070800\ndev\t2\t0\t1704153600\t1704157200\n"),
			want: []Session{
				{
					Name:     "main",
					Windows:  3,
					Attached: true,
					Created:  time.Unix(1704067200, 0),
					Activity: time.Unix(1704070800, 0),
				},
				{
					Name:     "dev",
					Windows:  2,
					Attached: false,
					Created:  time.Unix(1704153600, 0),
					Activity: time.Unix(1704157200, 0),
				},
			},
			wantErr: false,
		},
		{
			name:  "単一セッションのパース",
			input: []byte("work\t1\t0\t1704067200\t1704070800\n"),
			want: []Session{
				{
					Name:     "work",
					Windows:  1,
					Attached: false,
					Created:  time.Unix(1704067200, 0),
					Activity: time.Unix(1704070800, 0),
				},
			},
			wantErr: false,
		},
		{
			name:    "空出力の場合は空スライスを返す",
			input:   []byte(""),
			want:    []Session{},
			wantErr: false,
		},
		{
			name:    "空白のみの出力は空スライスを返す",
			input:   []byte("  \n\n  \n"),
			want:    []Session{},
			wantErr: false,
		},
		{
			name:    "フィールド数が不足している場合はエラー",
			input:   []byte("main\t3\t1\t1704067200\n"),
			wantErr: true,
		},
		{
			name:    "windowsが数値でない場合はエラー",
			input:   []byte("main\tabc\t1\t1704067200\t1704070800\n"),
			wantErr: true,
		},
		{
			name:    "attachedが数値でない場合はエラー",
			input:   []byte("main\t3\txyz\t1704067200\t1704070800\n"),
			wantErr: true,
		},
		{
			name:    "createdが数値でない場合はエラー",
			input:   []byte("main\t3\t1\tnot-a-timestamp\t1704070800\n"),
			wantErr: true,
		},
		{
			name:    "activityが数値でない場合はエラー",
			input:   []byte("main\t3\t1\t1704067200\tnot-a-timestamp\n"),
			wantErr: true,
		},
		{
			name:  "attached=0のパース",
			input: []byte("test\t5\t0\t1704067200\t1704070800\n"),
			want: []Session{
				{
					Name:     "test",
					Windows:  5,
					Attached: false,
					Created:  time.Unix(1704067200, 0),
					Activity: time.Unix(1704070800, 0),
				},
			},
			wantErr: false,
		},
		{
			name:  "末尾に改行がない場合もパースできる",
			input: []byte("main\t3\t1\t1704067200\t1704070800"),
			want: []Session{
				{
					Name:     "main",
					Windows:  3,
					Attached: true,
					Created:  time.Unix(1704067200, 0),
					Activity: time.Unix(1704070800, 0),
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseSessions(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseSessions() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ParseSessions() returned %d sessions, want %d", len(got), len(tt.want))
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

func TestParseWindows(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		want    []Window
		wantErr bool
	}{
		{
			name:  "複数ウィンドウのパース",
			input: []byte("0\tbash\t1\n1\tvim\t0\n2\thtop\t0\n"),
			want: []Window{
				{Index: 0, Name: "bash", Active: true},
				{Index: 1, Name: "vim", Active: false},
				{Index: 2, Name: "htop", Active: false},
			},
			wantErr: false,
		},
		{
			name:  "単一ウィンドウのパース",
			input: []byte("0\tzsh\t1\n"),
			want: []Window{
				{Index: 0, Name: "zsh", Active: true},
			},
			wantErr: false,
		},
		{
			name:    "空出力の場合は空スライスを返す",
			input:   []byte(""),
			want:    []Window{},
			wantErr: false,
		},
		{
			name:    "空白のみの出力は空スライスを返す",
			input:   []byte("  \n\n"),
			want:    []Window{},
			wantErr: false,
		},
		{
			name:    "フィールド数が不足している場合はエラー",
			input:   []byte("0\tbash\n"),
			wantErr: true,
		},
		{
			name:    "indexが数値でない場合はエラー",
			input:   []byte("abc\tbash\t1\n"),
			wantErr: true,
		},
		{
			name:    "activeが数値でない場合はエラー",
			input:   []byte("0\tbash\txyz\n"),
			wantErr: true,
		},
		{
			name:  "末尾に改行がない場合もパースできる",
			input: []byte("0\tbash\t1"),
			want: []Window{
				{Index: 0, Name: "bash", Active: true},
			},
			wantErr: false,
		},
		{
			name:  "非ゼロインデックスのウィンドウ",
			input: []byte("3\tnode\t0\n5\tpython\t1\n"),
			want: []Window{
				{Index: 3, Name: "node", Active: false},
				{Index: 5, Name: "python", Active: true},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseWindows(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseWindows() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("ParseWindows() returned %d windows, want %d", len(got), len(tt.want))
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

func TestParseSessions_Testdata(t *testing.T) {
	t.Run("list-sessions.txtのパース", func(t *testing.T) {
		data, err := os.ReadFile("testdata/list-sessions.txt")
		if err != nil {
			t.Fatalf("failed to read testdata: %v", err)
		}
		sessions, err := ParseSessions(data)
		if err != nil {
			t.Fatalf("ParseSessions() error = %v", err)
		}
		if len(sessions) != 3 {
			t.Fatalf("expected 3 sessions, got %d", len(sessions))
		}

		// Verify first session
		if sessions[0].Name != "main" {
			t.Errorf("sessions[0].Name = %q, want %q", sessions[0].Name, "main")
		}
		if sessions[0].Windows != 3 {
			t.Errorf("sessions[0].Windows = %d, want %d", sessions[0].Windows, 3)
		}
		if sessions[0].Attached != true {
			t.Errorf("sessions[0].Attached = %v, want true", sessions[0].Attached)
		}
		if !sessions[0].Created.Equal(time.Unix(1704067200, 0)) {
			t.Errorf("sessions[0].Created = %v, want %v", sessions[0].Created, time.Unix(1704067200, 0))
		}
		if !sessions[0].Activity.Equal(time.Unix(1704070800, 0)) {
			t.Errorf("sessions[0].Activity = %v, want %v", sessions[0].Activity, time.Unix(1704070800, 0))
		}

		// Verify last session
		if sessions[2].Name != "monitoring" {
			t.Errorf("sessions[2].Name = %q, want %q", sessions[2].Name, "monitoring")
		}
		if sessions[2].Attached != false {
			t.Errorf("sessions[2].Attached = %v, want false", sessions[2].Attached)
		}
	})

	t.Run("list-sessions-empty.txtのパース", func(t *testing.T) {
		data, err := os.ReadFile("testdata/list-sessions-empty.txt")
		if err != nil {
			t.Fatalf("failed to read testdata: %v", err)
		}
		sessions, err := ParseSessions(data)
		if err != nil {
			t.Fatalf("ParseSessions() error = %v", err)
		}
		if len(sessions) != 0 {
			t.Errorf("expected 0 sessions, got %d", len(sessions))
		}
	})
}

func TestParseWindows_Testdata(t *testing.T) {
	t.Run("list-windows.txtのパース", func(t *testing.T) {
		data, err := os.ReadFile("testdata/list-windows.txt")
		if err != nil {
			t.Fatalf("failed to read testdata: %v", err)
		}
		windows, err := ParseWindows(data)
		if err != nil {
			t.Fatalf("ParseWindows() error = %v", err)
		}
		if len(windows) != 3 {
			t.Fatalf("expected 3 windows, got %d", len(windows))
		}

		// Verify first window (active)
		if windows[0].Index != 0 {
			t.Errorf("windows[0].Index = %d, want 0", windows[0].Index)
		}
		if windows[0].Name != "bash" {
			t.Errorf("windows[0].Name = %q, want %q", windows[0].Name, "bash")
		}
		if windows[0].Active != true {
			t.Errorf("windows[0].Active = %v, want true", windows[0].Active)
		}

		// Verify second window (not active)
		if windows[1].Active != false {
			t.Errorf("windows[1].Active = %v, want false", windows[1].Active)
		}
	})

	t.Run("list-windows-single.txtのパース", func(t *testing.T) {
		data, err := os.ReadFile("testdata/list-windows-single.txt")
		if err != nil {
			t.Fatalf("failed to read testdata: %v", err)
		}
		windows, err := ParseWindows(data)
		if err != nil {
			t.Fatalf("ParseWindows() error = %v", err)
		}
		if len(windows) != 1 {
			t.Fatalf("expected 1 window, got %d", len(windows))
		}
		if windows[0].Name != "zsh" {
			t.Errorf("windows[0].Name = %q, want %q", windows[0].Name, "zsh")
		}
		if windows[0].Active != true {
			t.Errorf("windows[0].Active = %v, want true", windows[0].Active)
		}
	})
}
