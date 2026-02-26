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
	// dirResults は dir+コマンド名+引数のキーに対するレスポンスを保持する。
	dirResults map[string]mockResult
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

func (m *mockCommandRunner) RunCommandInDir(dir, name string, args ...string) ([]byte, error) {
	key := dir + " " + name
	for _, a := range args {
		key += " " + a
	}
	if m.dirResults != nil {
		if r, ok := m.dirResults[key]; ok {
			return r.output, r.err
		}
	}
	return nil, errors.New("unexpected command in dir: " + key)
}

func TestParseSessionName(t *testing.T) {
	tests := []struct {
		name        string
		sessionName string
		wantRepo    string
		wantBranch  string
	}{
		{
			name:        "リポジトリ名のみ",
			sessionName: "palmux",
			wantRepo:    "palmux",
			wantBranch:  "",
		},
		{
			name:        "repo@branch 形式",
			sessionName: "palmux@feature-x",
			wantRepo:    "palmux",
			wantBranch:  "feature-x",
		},
		{
			name:        "スラッシュ含むブランチ名",
			sessionName: "palmux@feature/login",
			wantRepo:    "palmux",
			wantBranch:  "feature/login",
		},
		{
			name:        "空文字列",
			sessionName: "",
			wantRepo:    "",
			wantBranch:  "",
		},
		{
			name:        "複数の @ を含む: 最初の @ でのみ分割",
			sessionName: "repo@a@b",
			wantRepo:    "repo",
			wantBranch:  "a@b",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo, branch := ParseSessionName(tt.sessionName)
			if repo != tt.wantRepo {
				t.Errorf("ParseSessionName(%q) repo = %q, want %q", tt.sessionName, repo, tt.wantRepo)
			}
			if branch != tt.wantBranch {
				t.Errorf("ParseSessionName(%q) branch = %q, want %q", tt.sessionName, branch, tt.wantBranch)
			}
		})
	}
}

func TestGhqResolver_ResolveRepo(t *testing.T) {
	ghqResults := map[string]mockResult{
		"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
		"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\ngithub.com/alice/utils\n"), err: nil},
	}

	tests := []struct {
		name     string
		repoName string
		results  map[string]mockResult
		want     string
	}{
		{
			name:     "マッチあり: basename 完全一致",
			repoName: "palmux",
			results:  ghqResults,
			want:     "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:     "マッチなし: 空文字列を返す",
			repoName: "unknown",
			results:  ghqResults,
			want:     "",
		},
		{
			name:     "空文字列: 空文字列を返す",
			repoName: "",
			results:  ghqResults,
			want:     "",
		},
		{
			name:     "org-basename マッチ",
			repoName: "alice-utils",
			results:  ghqResults,
			want:     "/home/user/ghq/github.com/alice/utils",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results},
				HomeDir: "/home/user",
			}

			got := resolver.ResolveRepo(tt.repoName)
			if got != tt.want {
				t.Errorf("ResolveRepo(%q) = %q, want %q", tt.repoName, got, tt.want)
			}
		})
	}
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

func TestGhqResolver_Resolve_WithBranch(t *testing.T) {
	gwqJSON := `[{"path":"/home/user/ghq/github.com/tjst-t/palmux","branch":"main","commit_hash":"abc123","is_main":true,"created_at":""},{"path":"/home/user/worktrees/github.com/tjst-t/palmux/feature-x","branch":"feature-x","commit_hash":"def456","is_main":false,"created_at":""}]`

	tests := []struct {
		name        string
		sessionName string
		results     map[string]mockResult
		dirResults  map[string]mockResult
		want        string
	}{
		{
			name:        "repo@branch: worktree マッチあり → worktree パス",
			sessionName: "palmux@feature-x",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			dirResults: map[string]mockResult{
				"/home/user/ghq/github.com/tjst-t/palmux gwq list --json": {
					output: []byte(gwqJSON),
					err:    nil,
				},
			},
			want: "/home/user/worktrees/github.com/tjst-t/palmux/feature-x",
		},
		{
			name:        "repo@branch: worktree マッチなし → リポジトリパスにフォールバック",
			sessionName: "palmux@nonexistent-branch",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			dirResults: map[string]mockResult{
				"/home/user/ghq/github.com/tjst-t/palmux gwq list --json": {
					output: []byte(gwqJSON),
					err:    nil,
				},
			},
			want: "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:        "repo@branch: gwq エラー → リポジトリパスにフォールバック",
			sessionName: "palmux@feature-x",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			dirResults: map[string]mockResult{
				"/home/user/ghq/github.com/tjst-t/palmux gwq list --json": {
					output: nil,
					err:    errors.New("gwq not found"),
				},
			},
			want: "/home/user/ghq/github.com/tjst-t/palmux",
		},
		{
			name:        "repo@branch: リポジトリが見つからない → ホームディレクトリ",
			sessionName: "nonexistent@feature-x",
			results: map[string]mockResult{
				"ghq root": {output: []byte("/home/user/ghq\n"), err: nil},
				"ghq list": {output: []byte("github.com/tjst-t/palmux\ngithub.com/golang/go\n"), err: nil},
			},
			dirResults: map[string]mockResult{},
			want:       "/home/user",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{results: tt.results, dirResults: tt.dirResults},
				HomeDir: "/home/user",
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

func TestGhqResolver_GwqListWorktrees(t *testing.T) {
	tests := []struct {
		name       string
		dirResults map[string]mockResult
		wantCount  int
		wantErr    bool
	}{
		{
			name: "正常系: 複数の worktree",
			dirResults: map[string]mockResult{
				"/repo gwq list --json": {
					output: []byte(`[{"path":"/home/user/worktrees/github.com/owner/repo/main","branch":"main","commit_hash":"abc123","is_main":true,"created_at":"2025-01-01T00:00:00Z"},{"path":"/home/user/worktrees/github.com/owner/repo/feature-x","branch":"feature-x","commit_hash":"def456","is_main":false,"created_at":"2025-01-02T00:00:00Z"}]`),
					err:    nil,
				},
			},
			wantCount: 2,
		},
		{
			name: "正常系: 空の配列",
			dirResults: map[string]mockResult{
				"/repo gwq list --json": {
					output: []byte(`[]`),
					err:    nil,
				},
			},
			wantCount: 0,
		},
		{
			name: "異常系: gwq コマンドエラー",
			dirResults: map[string]mockResult{
				"/repo gwq list --json": {
					output: nil,
					err:    errors.New("gwq not found"),
				},
			},
			wantErr: true,
		},
		{
			name: "異常系: 不正な JSON",
			dirResults: map[string]mockResult{
				"/repo gwq list --json": {
					output: []byte(`invalid json`),
					err:    nil,
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			got, err := resolver.GwqListWorktrees("/repo")
			if (err != nil) != tt.wantErr {
				t.Errorf("GwqListWorktrees() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(got) != tt.wantCount {
				t.Errorf("GwqListWorktrees() returned %d worktrees, want %d", len(got), tt.wantCount)
			}
		})
	}
}

func TestGhqResolver_GwqListWorktrees_Details(t *testing.T) {
	jsonOutput := `[{"path":"/home/user/worktrees/github.com/owner/repo/main","branch":"main","commit_hash":"abc123","is_main":true,"created_at":"2025-01-01T00:00:00Z"},{"path":"/home/user/worktrees/github.com/owner/repo/feature-x","branch":"feature-x","commit_hash":"def456","is_main":false,"created_at":"2025-01-02T00:00:00Z"}]`

	resolver := &GhqResolver{
		Cmd: &mockCommandRunner{
			dirResults: map[string]mockResult{
				"/repo gwq list --json": {output: []byte(jsonOutput), err: nil},
			},
		},
		HomeDir: "/home/user",
	}

	got, err := resolver.GwqListWorktrees("/repo")
	if err != nil {
		t.Fatalf("GwqListWorktrees() error = %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("expected 2 worktrees, got %d", len(got))
	}

	if got[0].Branch != "main" || !got[0].IsMain || got[0].CommitHash != "abc123" {
		t.Errorf("first worktree = %+v, want main/true/abc123", got[0])
	}
	if got[1].Branch != "feature-x" || got[1].IsMain || got[1].CommitHash != "def456" {
		t.Errorf("second worktree = %+v, want feature-x/false/def456", got[1])
	}
}

func TestGhqResolver_GwqAddWorktree(t *testing.T) {
	tests := []struct {
		name         string
		branch       string
		createBranch bool
		dirResults   map[string]mockResult
		wantErr      bool
	}{
		{
			name:         "正常系: 既存ブランチで追加",
			branch:       "feature-x",
			createBranch: false,
			dirResults: map[string]mockResult{
				"/repo gwq add feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:         "正常系: 新規ブランチ作成で追加",
			branch:       "new-feature",
			createBranch: true,
			dirResults: map[string]mockResult{
				"/repo gwq add -b new-feature": {output: []byte(""), err: nil},
			},
		},
		{
			name:         "異常系: gwq エラー",
			branch:       "fail-branch",
			createBranch: false,
			dirResults: map[string]mockResult{
				"/repo gwq add fail-branch": {output: nil, err: errors.New("gwq error")},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			err := resolver.GwqAddWorktree("/repo", tt.branch, tt.createBranch)
			if (err != nil) != tt.wantErr {
				t.Errorf("GwqAddWorktree() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGhqResolver_GwqRemoveWorktree(t *testing.T) {
	tests := []struct {
		name       string
		branch     string
		dirResults map[string]mockResult
		wantErr    bool
	}{
		{
			name:   "正常系: worktree 削除",
			branch: "feature-x",
			dirResults: map[string]mockResult{
				"/repo gwq remove feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:   "異常系: gwq エラー",
			branch: "fail-branch",
			dirResults: map[string]mockResult{
				"/repo gwq remove fail-branch": {output: nil, err: errors.New("gwq error")},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			err := resolver.GwqRemoveWorktree("/repo", tt.branch)
			if (err != nil) != tt.wantErr {
				t.Errorf("GwqRemoveWorktree() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGhqResolver_GitIsBranchMerged(t *testing.T) {
	tests := []struct {
		name       string
		branch     string
		dirResults map[string]mockResult
		want       bool
		wantErr    bool
	}{
		{
			name:   "マージ済みブランチ",
			branch: "feature-x",
			dirResults: map[string]mockResult{
				"/repo git branch --merged": {
					output: []byte("* main\n  feature-x\n  fix/typo\n"),
					err:    nil,
				},
			},
			want: true,
		},
		{
			name:   "未マージブランチ",
			branch: "feature-y",
			dirResults: map[string]mockResult{
				"/repo git branch --merged": {
					output: []byte("* main\n  feature-x\n"),
					err:    nil,
				},
			},
			want: false,
		},
		{
			name:   "+プレフィクス付きのworktreeブランチもマッチ",
			branch: "worktree-branch",
			dirResults: map[string]mockResult{
				"/repo git branch --merged": {
					output: []byte("* main\n+ worktree-branch\n"),
					err:    nil,
				},
			},
			want: true,
		},
		{
			name:   "git エラー",
			branch: "feature-x",
			dirResults: map[string]mockResult{
				"/repo git branch --merged": {
					output: nil,
					err:    errors.New("git error"),
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			got, err := resolver.GitIsBranchMerged("/repo", tt.branch)
			if (err != nil) != tt.wantErr {
				t.Errorf("GitIsBranchMerged() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("GitIsBranchMerged() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGhqResolver_GitDeleteBranch(t *testing.T) {
	tests := []struct {
		name       string
		branch     string
		force      bool
		dirResults map[string]mockResult
		wantErr    bool
	}{
		{
			name:   "安全削除 (-d)",
			branch: "feature-x",
			force:  false,
			dirResults: map[string]mockResult{
				"/repo git branch -d feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:   "強制削除 (-D)",
			branch: "feature-x",
			force:  true,
			dirResults: map[string]mockResult{
				"/repo git branch -D feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:   "git エラー",
			branch: "fail-branch",
			force:  false,
			dirResults: map[string]mockResult{
				"/repo git branch -d fail-branch": {output: nil, err: errors.New("branch not merged")},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			err := resolver.GitDeleteBranch("/repo", tt.branch, tt.force)
			if (err != nil) != tt.wantErr {
				t.Errorf("GitDeleteBranch() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGhqResolver_GwqRemoveWorktreeAndBranch(t *testing.T) {
	tests := []struct {
		name       string
		branch     string
		force      bool
		dirResults map[string]mockResult
		wantErr    bool
	}{
		{
			name:   "通常削除",
			branch: "feature-x",
			force:  false,
			dirResults: map[string]mockResult{
				"/repo gwq remove -b feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:   "強制削除",
			branch: "feature-x",
			force:  true,
			dirResults: map[string]mockResult{
				"/repo gwq remove -b --force-delete-branch feature-x": {output: []byte(""), err: nil},
			},
		},
		{
			name:   "gwq エラー",
			branch: "fail-branch",
			force:  false,
			dirResults: map[string]mockResult{
				"/repo gwq remove -b fail-branch": {output: nil, err: errors.New("gwq error")},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			err := resolver.GwqRemoveWorktreeAndBranch("/repo", tt.branch, tt.force)
			if (err != nil) != tt.wantErr {
				t.Errorf("GwqRemoveWorktreeAndBranch() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGhqResolver_GitBranches(t *testing.T) {
	tests := []struct {
		name       string
		dirResults map[string]mockResult
		wantCount  int
		wantErr    bool
	}{
		{
			name: "正常系: ブランチ一覧",
			dirResults: map[string]mockResult{
				"/repo git branch -a --no-color": {
					output: []byte("* main\n  feature-x\n  remotes/origin/feature-y\n"),
					err:    nil,
				},
			},
			wantCount: 3,
		},
		{
			name: "異常系: git エラー",
			dirResults: map[string]mockResult{
				"/repo git branch -a --no-color": {
					output: nil,
					err:    errors.New("git error"),
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver := &GhqResolver{
				Cmd:     &mockCommandRunner{dirResults: tt.dirResults},
				HomeDir: "/home/user",
			}

			got, err := resolver.GitBranches("/repo")
			if (err != nil) != tt.wantErr {
				t.Errorf("GitBranches() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(got) != tt.wantCount {
				t.Errorf("GitBranches() returned %d branches, want %d", len(got), tt.wantCount)
			}
		})
	}
}
