package portman

import (
	"testing"
)

func TestParseLeasesJSON(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		want    int
		wantErr bool
	}{
		{
			name: "正常系: 1件のリース",
			input: []byte(`[{"name":"app","project":"tjst-t/clabnoc","worktree":"main","port":8202,"hostname":"app--main--clabnoc","expose":true,"status":"listening","pid":336289,"url":"https://app--main--clabnoc.dev.tjstkm.net"}]`),
			want:  1,
		},
		{
			name: "正常系: 複数件のリース",
			input: []byte(`[
				{"name":"app","project":"tjst-t/foo","worktree":"main","port":8201,"hostname":"app--main--foo","expose":true,"status":"listening","pid":100,"url":"https://foo.example.com"},
				{"name":"api","project":"tjst-t/foo","worktree":"main","port":8202,"hostname":"api--main--foo","expose":true,"status":"listening","pid":101,"url":"https://api.example.com"}
			]`),
			want: 2,
		},
		{
			name:  "正常系: 空配列",
			input: []byte(`[]`),
			want:  0,
		},
		{
			name:    "異常系: 不正なJSON",
			input:   []byte(`not json`),
			wantErr: true,
		},
		{
			name:    "異常系: JSONオブジェクト（配列でない）",
			input:   []byte(`{"name":"app"}`),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			leases, err := parseLeasesJSON(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(leases) != tt.want {
				t.Errorf("got %d leases, want %d", len(leases), tt.want)
			}
		})
	}
}

func TestParseLeasesJSON_Fields(t *testing.T) {
	input := []byte(`[{"name":"app","project":"tjst-t/clabnoc","worktree":"main","port":8202,"hostname":"app--main--clabnoc","expose":true,"status":"listening","pid":336289,"url":"https://app--main--clabnoc.dev.tjstkm.net"}]`)

	leases, err := parseLeasesJSON(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(leases) != 1 {
		t.Fatalf("got %d leases, want 1", len(leases))
	}

	l := leases[0]
	if l.Name != "app" {
		t.Errorf("Name = %q, want %q", l.Name, "app")
	}
	if l.Project != "tjst-t/clabnoc" {
		t.Errorf("Project = %q, want %q", l.Project, "tjst-t/clabnoc")
	}
	if l.Worktree != "main" {
		t.Errorf("Worktree = %q, want %q", l.Worktree, "main")
	}
	if l.Port != 8202 {
		t.Errorf("Port = %d, want %d", l.Port, 8202)
	}
	if l.Hostname != "app--main--clabnoc" {
		t.Errorf("Hostname = %q, want %q", l.Hostname, "app--main--clabnoc")
	}
	if !l.Expose {
		t.Error("Expose = false, want true")
	}
	if l.Status != "listening" {
		t.Errorf("Status = %q, want %q", l.Status, "listening")
	}
	if l.PID != 336289 {
		t.Errorf("PID = %d, want %d", l.PID, 336289)
	}
	if l.URL != "https://app--main--clabnoc.dev.tjstkm.net" {
		t.Errorf("URL = %q, want %q", l.URL, "https://app--main--clabnoc.dev.tjstkm.net")
	}
}
