package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/tjst-t/palmux/internal/cmddetect"
	"github.com/tjst-t/palmux/internal/tmux"
)

func TestHandleGetCommands(t *testing.T) {
	tests := []struct {
		name          string
		session       string
		projectDir    string
		projectDirErr error
		makefileContent string // 空でない場合 projectDir に Makefile を作成
		wantStatus    int
		wantCommands  []cmddetect.Command
	}{
		{
			name:            "正常系: Makefile のターゲットを返す",
			session:         "main",
			projectDir:      "", // t.TempDir() で上書き
			makefileContent: "build:\n\tgo build\n\ntest:\n\tgo test ./...\n",
			wantStatus:      http.StatusOK,
			wantCommands: []cmddetect.Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
				{Label: "test", Command: "make test\r", Source: "Makefile"},
			},
		},
		{
			name:       "正常系: プロジェクトファイルなし → 空配列",
			session:    "main",
			projectDir: "", // t.TempDir() で上書き
			wantStatus: http.StatusOK,
		},
		{
			name:          "異常系: セッション未存在 → 404",
			session:       "nonexistent",
			projectDirErr: fmt.Errorf("not found: %w", tmux.ErrSessionNotFound),
			wantStatus:    http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := tt.projectDir
			if dir == "" {
				dir = t.TempDir()
			}

			if tt.makefileContent != "" {
				if err := os.WriteFile(filepath.Join(dir, "Makefile"), []byte(tt.makefileContent), 0644); err != nil {
					t.Fatal(err)
				}
			}

			mock := &configurableMock{
				projectDir:    dir,
				projectDirErr: tt.projectDirErr,
			}
			srv, token := newTestServer(mock)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/"+tt.session+"/commands", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var result struct {
					Commands []cmddetect.Command `json:"commands"`
				}
				if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if tt.wantCommands == nil {
					if len(result.Commands) != 0 {
						t.Errorf("commands = %+v, want empty", result.Commands)
					}
				} else {
					if len(result.Commands) != len(tt.wantCommands) {
						t.Fatalf("commands length = %d, want %d\ngot: %+v", len(result.Commands), len(tt.wantCommands), result.Commands)
					}
					for i, cmd := range result.Commands {
						if cmd != tt.wantCommands[i] {
							t.Errorf("commands[%d] = %+v, want %+v", i, cmd, tt.wantCommands[i])
						}
					}
				}
			}
		})
	}
}
