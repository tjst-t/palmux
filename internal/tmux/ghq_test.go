package tmux

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
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
		{
			name:        "org-basename マッチ（alice-utils → github.com/alice/utils）",
			sessionName: "alice-utils",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\ngithub.com/bob/helpers\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/alice/utils",
		},
		{
			name:        "basename マッチが org-basename マッチより優先される",
			sessionName: "alice-utils",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\ngithub.com/someone/alice-utils\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/someone/alice-utils",
		},
		{
			name:        "org-basename マッチ: 複数セグメントパスの parent を使用",
			sessionName: "tjst-t-palmux",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\n"), err: nil},
			},
			homeDir: "/home/user",
			want:    "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:        "org-basename マッチなし → ホームディレクトリ",
			sessionName: "wrong-utils",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\n"), err: nil},
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

func TestGhqResolver_ListRepos(t *testing.T) {
	tests := []struct {
		name    string
		results map[string]mockResult
		homeDir string
		want    []GhqRepo
		wantErr bool
	}{
		{
			name: "重複なし → basename がそのまま Name",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\ngithub.com/bob/helpers\n"), err: nil},
			},
			homeDir: "/home/user",
			want: []GhqRepo{
				{Name: "utils", Path: "github.com/alice/utils", FullPath: "/home/user/ghq/github.com/alice/utils"},
				{Name: "helpers", Path: "github.com/bob/helpers", FullPath: "/home/user/ghq/github.com/bob/helpers"},
			},
			wantErr: false,
		},
		{
			name: "重複あり → org-basename 形式の Name",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\ngithub.com/bob/utils\ngithub.com/carol/helpers\n"), err: nil},
			},
			homeDir: "/home/user",
			want: []GhqRepo{
				{Name: "alice-utils", Path: "github.com/alice/utils", FullPath: "/home/user/ghq/github.com/alice/utils"},
				{Name: "bob-utils", Path: "github.com/bob/utils", FullPath: "/home/user/ghq/github.com/bob/utils"},
				{Name: "helpers", Path: "github.com/carol/helpers", FullPath: "/home/user/ghq/github.com/carol/helpers"},
			},
			wantErr: false,
		},
		{
			name: "ghq 未インストール → 空スライス",
			results: map[string]mockResult{
				"ghq root": {output: nil, err: errors.New("exec: \"ghq\": executable file not found in $PATH")},
			},
			homeDir: "/home/user",
			want:    []GhqRepo{},
			wantErr: false,
		},
		{
			name: "ghq list が空 → 空スライス",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte(""), err: nil},
			},
			homeDir: "/home/user",
			want:    []GhqRepo{},
			wantErr: false,
		},
		{
			name: "ghq list エラー → 空スライス",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: nil, err: errors.New("ghq list failed")},
			},
			homeDir: "/home/user",
			want:    []GhqRepo{},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results},
				HomeDir: tt.homeDir,
			}

			got, err := resolver.ListRepos()
			if (err != nil) != tt.wantErr {
				t.Errorf("ListRepos() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ListRepos() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGhqResolver_GetRoot(t *testing.T) {
	tests := []struct {
		name    string
		results map[string]mockResult
		want    string
		wantErr bool
	}{
		{
			name: "正常系: ghq root を返す",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
			},
			want:    "/home/user/ghq",
			wantErr: false,
		},
		{
			name: "ghq 未インストール: エラーを返す",
			results: map[string]mockResult{
				"ghq root": {output: nil, err: errors.New("exec: \"ghq\": executable file not found in $PATH")},
			},
			want:    "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results},
				HomeDir: "/home/user",
			}

			got, err := resolver.GetRoot()
			if (err != nil) != tt.wantErr {
				t.Errorf("GetRoot() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("GetRoot() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGhqResolver_CloneRepo(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		results map[string]mockResult
		want    *GhqRepo
		wantErr bool
	}{
		{
			name: "正常系: ghq get 成功",
			url:  "https://github.com/alice/utils",
			results: map[string]mockResult{
				"ghq get https://github.com/alice/utils": {output: []byte(""), err: nil},
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/alice/utils\n"), err: nil},
			},
			want:    &GhqRepo{Name: "utils", Path: "github.com/alice/utils", FullPath: "/home/user/ghq/github.com/alice/utils"},
			wantErr: false,
		},
		{
			name:    "空URL: エラーを返す",
			url:     "",
			results: map[string]mockResult{},
			want:    nil,
			wantErr: true,
		},
		{
			name: "ghq get 失敗: エラーを返す",
			url:  "https://github.com/invalid/repo",
			results: map[string]mockResult{
				"ghq get https://github.com/invalid/repo": {output: nil, err: errors.New("clone failed")},
			},
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results},
				HomeDir: "/home/user",
			}

			got, err := resolver.CloneRepo(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("CloneRepo(%q) error = %v, wantErr %v", tt.url, err, tt.wantErr)
				return
			}
			if tt.want == nil {
				if got != nil {
					t.Errorf("CloneRepo(%q) = %v, want nil", tt.url, got)
				}
			} else if got == nil {
				t.Errorf("CloneRepo(%q) = nil, want %v", tt.url, tt.want)
			} else if !reflect.DeepEqual(*got, *tt.want) {
				t.Errorf("CloneRepo(%q) = %v, want %v", tt.url, *got, *tt.want)
			}
		})
	}
}

func TestGhqResolver_DeleteRepo(t *testing.T) {
	// 実FS を使って削除テストを行う
	t.Run("正常削除: ghq root 配下の十分な深さのパス", func(t *testing.T) {
		tmpDir := t.TempDir()
		root := filepath.Join(tmpDir, "ghq")
		repoDir := filepath.Join(root, "github.com", "alice", "utils")
		if err := os.MkdirAll(repoDir, 0o755); err != nil {
			t.Fatal(err)
		}
		// ファイルも作成
		if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# test"), 0o644); err != nil {
			t.Fatal(err)
		}

		resolver := &GhqResolver{
			Cmd: &mockCommandRunner{results: map[string]mockResult{
				"ghq root": {output: []byte(root + "\n"), err: nil},
			}},
			HomeDir: tmpDir,
		}

		err := resolver.DeleteRepo(repoDir)
		if err != nil {
			t.Fatalf("DeleteRepo() error = %v", err)
		}

		// ディレクトリが削除されていること
		if _, err := os.Stat(repoDir); !os.IsNotExist(err) {
			t.Errorf("repo directory should be deleted, but still exists")
		}
	})

	t.Run("ghq root 外のパス拒否", func(t *testing.T) {
		tmpDir := t.TempDir()
		root := filepath.Join(tmpDir, "ghq")
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		outsideDir := filepath.Join(tmpDir, "outside", "some", "repo")
		if err := os.MkdirAll(outsideDir, 0o755); err != nil {
			t.Fatal(err)
		}

		resolver := &GhqResolver{
			Cmd: &mockCommandRunner{results: map[string]mockResult{
				"ghq root": {output: []byte(root + "\n"), err: nil},
			}},
			HomeDir: tmpDir,
		}

		err := resolver.DeleteRepo(outsideDir)
		if err == nil {
			t.Fatal("DeleteRepo() should return error for path outside ghq root")
		}
		if !strings.Contains(err.Error(), "outside ghq root") {
			t.Errorf("error should mention 'outside ghq root', got: %v", err)
		}
	})

	t.Run("パストラバーサル拒否", func(t *testing.T) {
		tmpDir := t.TempDir()
		root := filepath.Join(tmpDir, "ghq")
		if err := os.MkdirAll(filepath.Join(root, "github.com", "alice", "utils"), 0o755); err != nil {
			t.Fatal(err)
		}

		resolver := &GhqResolver{
			Cmd: &mockCommandRunner{results: map[string]mockResult{
				"ghq root": {output: []byte(root + "\n"), err: nil},
			}},
			HomeDir: tmpDir,
		}

		// パストラバーサル攻撃
		traversalPath := filepath.Join(root, "github.com", "alice", "..", "..", "..")
		err := resolver.DeleteRepo(traversalPath)
		if err == nil {
			t.Fatal("DeleteRepo() should return error for path traversal")
		}
	})

	t.Run("root 自体の削除拒否", func(t *testing.T) {
		tmpDir := t.TempDir()
		root := filepath.Join(tmpDir, "ghq")
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}

		resolver := &GhqResolver{
			Cmd: &mockCommandRunner{results: map[string]mockResult{
				"ghq root": {output: []byte(root + "\n"), err: nil},
			}},
			HomeDir: tmpDir,
		}

		err := resolver.DeleteRepo(root)
		if err == nil {
			t.Fatal("DeleteRepo() should return error when trying to delete ghq root itself")
		}
		if !strings.Contains(err.Error(), "outside ghq root") && !strings.Contains(err.Error(), "depth") {
			t.Errorf("error should mention path issue, got: %v", err)
		}
	})

	t.Run("深度不足のパス拒否", func(t *testing.T) {
		tmpDir := t.TempDir()
		root := filepath.Join(tmpDir, "ghq")
		// 深度1: host だけ
		shallowDir := filepath.Join(root, "github.com")
		if err := os.MkdirAll(shallowDir, 0o755); err != nil {
			t.Fatal(err)
		}

		resolver := &GhqResolver{
			Cmd: &mockCommandRunner{results: map[string]mockResult{
				"ghq root": {output: []byte(root + "\n"), err: nil},
			}},
			HomeDir: tmpDir,
		}

		err := resolver.DeleteRepo(shallowDir)
		if err == nil {
			t.Fatal("DeleteRepo() should return error for shallow path (depth < 3)")
		}
		if !strings.Contains(err.Error(), "depth") {
			t.Errorf("error should mention 'depth', got: %v", err)
		}

		// 深度2: host/owner
		mediumDir := filepath.Join(root, "github.com", "alice")
		if err := os.MkdirAll(mediumDir, 0o755); err != nil {
			t.Fatal(err)
		}

		err = resolver.DeleteRepo(mediumDir)
		if err == nil {
			t.Fatal("DeleteRepo() should return error for medium depth path (depth < 3)")
		}
	})
}
