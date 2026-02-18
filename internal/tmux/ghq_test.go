package tmux

import (
	"errors"
	"testing"
)

// mockCommandRunner は CommandRunner のモック実装。
type mockCommandRunner struct {
	// results はコマンド名+引数のキーに対するレスポンスを保持する。
	results map[string]mockResult
}

type mockResult struct {
	output []byte
	err    error
}

func (m *mockCommandRunner) RunCommand(name string, args ...string) ([]byte, error) {
	key := name
	for _, a := range args {
		key += " " + a
	}
	if r, ok := m.results[key]; ok {
		return r.output, r.err
	}
	return nil, errors.New("unexpected command: " + key)
}

func TestGhqResolver_Resolve(t *testing.T) {
	tests := []struct {
		name        string
		sessionName string
		results     map[string]mockResult
		homeDir     string
		want        string
	}{
		{
			name:        "マッチあり（1件）",
			sessionName: "palmux",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:        "マッチなし → ホームディレクトリ",
			sessionName: "unknown-repo",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user",
		},
		{
			name:        "複数マッチ → 最初のマッチを使用",
			sessionName: "palmux",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/other/palmux\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:        "ghq 未インストール（root がエラー）→ ホームディレクトリ",
			sessionName: "palmux",
			results: map[string]mockResult{
				"ghq root": {output: nil, err: errors.New("exec: \"ghq\": executable file not found in $PATH")},
			},
			homeDir: "/home/user",
			want:    "/home/user",
		},
		{
			name:        "ghq list が空 → ホームディレクトリ",
			sessionName: "palmux",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte(""), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user",
		},
		{
			name:        "セッション名が空 → ホームディレクトリ",
			sessionName: "",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user",
		},
		{
			name:        "ハイフン入りの名前",
			sessionName: "my-project",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/user/my-project\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/user/my-project",
		},
		{
			name:        "アンダースコア入りの名前",
			sessionName: "my_project",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/user/my_project\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/user/my_project",
		},
		{
			name:        "ドット入りの名前",
			sessionName: "my.project",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/user/my.project\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/user/my.project",
		},
		{
			name:        "ghq list がエラー → ホームディレクトリ",
			sessionName: "palmux",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: nil, err: errors.New("ghq list failed")},
			},
			homeDir: "/home/user",
			want:    "/home/user",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results},
				HomeDir: tt.homeDir,
			}

			got := resolver.Resolve(tt.sessionName)
			if got != tt.want {
				t.Errorf("Resolve(%q) = %q, want %q", tt.sessionName, got, tt.want)
			}
		})
	}
}
