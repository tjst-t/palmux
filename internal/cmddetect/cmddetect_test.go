package cmddetect

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDetect(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string // filename -> content
		want  []Command
	}{
		{
			name:  "プロジェクトファイルなし → 空配列",
			files: map[string]string{},
			want:  nil,
		},
		{
			name: "標準的な Makefile → ターゲット一覧を返す",
			files: map[string]string{
				"Makefile": "build:\n\tgo build\n\ntest:\n\tgo test ./...\n\nclean:\n\trm -rf bin/\n",
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
				{Label: "test", Command: "make test\r", Source: "Makefile"},
				{Label: "clean", Command: "make clean\r", Source: "Makefile"},
			},
		},
		{
			name: "_始まりと.PHONYターゲットは除外される",
			files: map[string]string{
				"Makefile": ".PHONY: build test\n_internal:\n\techo internal\n\nbuild:\n\tgo build\n",
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
			},
		},
		{
			name: "変数代入行は除外される",
			files: map[string]string{
				"Makefile": "GO ?= $(shell which go)\nVERSION := 1.0\nFOO = bar\n\nbuild:\n\t$(GO) build\n",
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
			},
		},
		{
			name: "パターンルール(%含む)は除外される",
			files: map[string]string{
				"Makefile": "%.o: %.c\n\tgcc -c $<\n\nbuild:\n\tgo build\n",
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
			},
		},
		{
			name: "ハイフン付きターゲット名も検出される",
			files: map[string]string{
				"Makefile": "build-linux:\n\tGOOS=linux go build\n\nbuild-arm:\n\tGOARCH=arm64 go build\n",
			},
			want: []Command{
				{Label: "build-linux", Command: "make build-linux\r", Source: "Makefile"},
				{Label: "build-arm", Command: "make build-arm\r", Source: "Makefile"},
			},
		},
		{
			name: "package.json scripts → npm run コマンドを返す",
			files: map[string]string{
				"package.json": `{"name": "test", "scripts": {"dev": "next dev", "build": "next build", "lint": "eslint ."}}`,
			},
			want: []Command{
				{Label: "build", Command: "npm run build\r", Source: "package.json"},
				{Label: "dev", Command: "npm run dev\r", Source: "package.json"},
				{Label: "lint", Command: "npm run lint\r", Source: "package.json"},
			},
		},
		{
			name: "go.mod のみ → 定型コマンドを返す",
			files: map[string]string{
				"go.mod": "module example.com/test\n\ngo 1.21\n",
			},
			want: []Command{
				{Label: "go test", Command: "go test ./...\r", Source: "go.mod"},
				{Label: "go build", Command: "go build ./...\r", Source: "go.mod"},
				{Label: "go vet", Command: "go vet ./...\r", Source: "go.mod"},
			},
		},
		{
			name: "Cargo.toml のみ → 定型コマンドを返す",
			files: map[string]string{
				"Cargo.toml": "[package]\nname = \"test\"\n",
			},
			want: []Command{
				{Label: "cargo build", Command: "cargo build\r", Source: "Cargo.toml"},
				{Label: "cargo test", Command: "cargo test\r", Source: "Cargo.toml"},
				{Label: "cargo run", Command: "cargo run\r", Source: "Cargo.toml"},
				{Label: "cargo clippy", Command: "cargo clippy\r", Source: "Cargo.toml"},
			},
		},
		{
			name: "pyproject.toml のみ → 定型コマンドを返す",
			files: map[string]string{
				"pyproject.toml": "[project]\nname = \"test\"\n",
			},
			want: []Command{
				{Label: "pytest", Command: "pytest\r", Source: "pyproject.toml"},
				{Label: "ruff check", Command: "ruff check\r", Source: "pyproject.toml"},
			},
		},
		{
			name: "Makefile + go.mod 共存 → go.mod の定型は省略",
			files: map[string]string{
				"Makefile": "test:\n\tgo test ./...\n\nbuild:\n\tgo build\n",
				"go.mod":   "module example.com/test\n\ngo 1.21\n",
			},
			want: []Command{
				{Label: "test", Command: "make test\r", Source: "Makefile"},
				{Label: "build", Command: "make build\r", Source: "Makefile"},
			},
		},
		{
			name: "Makefile + package.json 共存 → 両方返す",
			files: map[string]string{
				"Makefile":     "build:\n\tgo build\n",
				"package.json": `{"scripts": {"lint": "eslint ."}}`,
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
				{Label: "lint", Command: "npm run lint\r", Source: "package.json"},
			},
		},
		{
			name: "Makefile + Cargo.toml 共存 → Cargo の定型は省略",
			files: map[string]string{
				"Makefile":   "build:\n\tgo build\n",
				"Cargo.toml": "[package]\nname = \"test\"\n",
			},
			want: []Command{
				{Label: "build", Command: "make build\r", Source: "Makefile"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, content := range tt.files {
				if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
					t.Fatal(err)
				}
			}

			got, err := Detect(dir)
			if err != nil {
				t.Fatalf("Detect() error = %v", err)
			}

			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Detect() =\n  %+v\nwant\n  %+v", got, tt.want)
			}
		})
	}
}

func TestDetect_存在しないディレクトリ(t *testing.T) {
	_, err := Detect("/nonexistent/path/that/does/not/exist")
	if err != nil {
		t.Errorf("Detect() should not return error for nonexistent dir, got %v", err)
	}
}

func TestParseMakefileTargets(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
	}{
		{
			name:    "空ファイル",
			content: "",
			want:    nil,
		},
		{
			name:    "コメント行は無視される",
			content: "# build target\nbuild:\n\tgo build\n",
			want:    []string{"build"},
		},
		{
			name:    "複数依存ありのターゲット",
			content: "all: build test\n\techo done\n",
			want:    []string{"all"},
		},
		{
			name:    "タブ始まりの行は無視される",
			content: "build:\n\tgo build\n\techo done\n",
			want:    []string{"build"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseMakefileTargets(tt.content)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseMakefileTargets() = %v, want %v", got, tt.want)
			}
		})
	}
}
