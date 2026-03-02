package lsp

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// mockPathLooker はテスト用の PathLooker 実装。
// available に登録されたコマンドのみ「見つかる」として扱う。
type mockPathLooker struct {
	available map[string]string // command → path
}

func (m *mockPathLooker) LookPath(file string) (string, error) {
	if path, ok := m.available[file]; ok {
		return path, nil
	}
	return "", &os.PathError{Op: "lookpath", Path: file, Err: os.ErrNotExist}
}

func TestDetectServers(t *testing.T) {
	t.Run("全サーバーが利用可能な場合", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{
				"gopls":                          "/usr/bin/gopls",
				"typescript-language-server":     "/usr/bin/typescript-language-server",
				"pyright-langserver":             "/usr/bin/pyright-langserver",
				"rust-analyzer":                  "/usr/bin/rust-analyzer",
				"clangd":                         "/usr/bin/clangd",
				"jdtls":                          "/usr/bin/jdtls",
				"solargraph":                     "/usr/bin/solargraph",
				"phpactor":                       "/usr/bin/phpactor",
				"sourcekit-lsp":                  "/usr/bin/sourcekit-lsp",
				"kotlin-language-server":         "/usr/bin/kotlin-language-server",
				"lua-language-server":            "/usr/bin/lua-language-server",
				"zls":                            "/usr/bin/zls",
				"elixir-ls":                      "/usr/bin/elixir-ls",
				"haskell-language-server-wrapper": "/usr/bin/haskell-language-server-wrapper",
				"OmniSharp":                      "/usr/bin/OmniSharp",
				"dart":                           "/usr/bin/dart",
				"bash-language-server":           "/usr/bin/bash-language-server",
			},
		}

		configs := DetectServersWithLooker(looker)
		// clangd は c と cpp の2つ分登録されるので 18 個
		if len(configs) != 18 {
			t.Fatalf("len(configs) = %d, want 18", len(configs))
		}

		// 言語名を集めて確認
		langSet := make(map[string]bool)
		for _, c := range configs {
			langSet[c.Language] = true
			if !c.Enabled {
				t.Errorf("configs for %q should be enabled", c.Language)
			}
		}

		expectedLangs := []string{
			"go", "typescript", "python", "rust", "c", "cpp", "java", "ruby",
			"php", "swift", "kotlin", "lua", "zig", "elixir", "haskell", "csharp", "dart", "bash",
		}
		for _, lang := range expectedLangs {
			if !langSet[lang] {
				t.Errorf("expected language %q not found in configs", lang)
			}
		}
	})

	t.Run("goplsのみ利用可能な場合", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{
				"gopls": "/usr/local/bin/gopls",
			},
		}

		configs := DetectServersWithLooker(looker)
		if len(configs) != 1 {
			t.Fatalf("len(configs) = %d, want 1", len(configs))
		}

		if configs[0].Language != "go" {
			t.Errorf("Language = %q, want %q", configs[0].Language, "go")
		}
		if configs[0].Command != "gopls" {
			t.Errorf("Command = %q, want %q", configs[0].Command, "gopls")
		}
	})

	t.Run("サーバーが全く利用不可能な場合", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{},
		}

		configs := DetectServersWithLooker(looker)
		if len(configs) != 0 {
			t.Fatalf("len(configs) = %d, want 0", len(configs))
		}
	})

	t.Run("goplsのargsにserveが含まれる", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{
				"gopls": "/usr/bin/gopls",
			},
		}

		configs := DetectServersWithLooker(looker)
		if len(configs) != 1 {
			t.Fatalf("len(configs) = %d, want 1", len(configs))
		}

		if len(configs[0].Args) != 1 || configs[0].Args[0] != "serve" {
			t.Errorf("Args = %v, want [\"serve\"]", configs[0].Args)
		}
	})

	t.Run("typescript-language-serverのargsに--stdioが含まれる", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{
				"typescript-language-server": "/usr/bin/typescript-language-server",
			},
		}

		configs := DetectServersWithLooker(looker)
		if len(configs) != 1 {
			t.Fatalf("len(configs) = %d, want 1", len(configs))
		}

		if len(configs[0].Args) != 1 || configs[0].Args[0] != "--stdio" {
			t.Errorf("Args = %v, want [\"--stdio\"]", configs[0].Args)
		}
	})

	t.Run("rust-analyzerのargsは空", func(t *testing.T) {
		looker := &mockPathLooker{
			available: map[string]string{
				"rust-analyzer": "/usr/bin/rust-analyzer",
			},
		}

		configs := DetectServersWithLooker(looker)
		if len(configs) != 1 {
			t.Fatalf("len(configs) = %d, want 1", len(configs))
		}

		if len(configs[0].Args) != 0 {
			t.Errorf("Args = %v, want []", configs[0].Args)
		}
	})
}

func TestLanguageForFile(t *testing.T) {
	tests := []struct {
		name     string
		filePath string
		expected string
	}{
		{"Goファイル", "main.go", "go"},
		{"JavaScriptファイル", "app.js", "javascript"},
		{"JSXファイル", "component.jsx", "javascript"},
		{"TypeScriptファイル", "index.ts", "typescript"},
		{"TSXファイル", "component.tsx", "typescript"},
		{"Pythonファイル", "script.py", "python"},
		{"Rustファイル", "lib.rs", "rust"},
		{"Cファイル", "main.c", "c"},
		{"Cヘッダーファイル", "header.h", "c"},
		{"C++ファイル(.cpp)", "main.cpp", "cpp"},
		{"C++ファイル(.hpp)", "header.hpp", "cpp"},
		{"C++ファイル(.cc)", "main.cc", "cpp"},
		{"C++ファイル(.cxx)", "main.cxx", "cpp"},
		{"Javaファイル", "Main.java", "java"},
		{"Rubyファイル", "app.rb", "ruby"},
		{"Bashファイル(.sh)", "script.sh", "bash"},
		{"Bashファイル(.bash)", "script.bash", "bash"},
		{"PHPファイル", "index.php", "php"},
		{"Swiftファイル", "main.swift", "swift"},
		{"Kotlinファイル(.kt)", "Main.kt", "kotlin"},
		{"Kotlinファイル(.kts)", "build.gradle.kts", "kotlin"},
		{"Luaファイル", "init.lua", "lua"},
		{"Zigファイル", "main.zig", "zig"},
		{"Elixirファイル(.ex)", "app.ex", "elixir"},
		{"Elixirファイル(.exs)", "test.exs", "elixir"},
		{"Haskellファイル", "Main.hs", "haskell"},
		{"C#ファイル", "Program.cs", "csharp"},
		{"Dartファイル", "main.dart", "dart"},
		{"不明な拡張子", "file.unknown", ""},
		{"拡張子なし", "Makefile", ""},
		{"パス付きGoファイル", "/home/user/project/main.go", "go"},
		{"パス付きTSファイル", "/app/src/index.ts", "typescript"},
		{"大文字拡張子", "FILE.GO", "go"},
		{"混合拡張子", "FILE.Py", "python"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := LanguageForFile(tt.filePath)
			if got != tt.expected {
				t.Errorf("LanguageForFile(%q) = %q, want %q", tt.filePath, got, tt.expected)
			}
		})
	}
}

func TestLanguageForProject(t *testing.T) {
	t.Run("go.modが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module test"), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "go" {
			t.Errorf("LanguageForProject() = %v, want [\"go\"]", langs)
		}
	})

	t.Run("package.jsonが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "typescript" {
			t.Errorf("LanguageForProject() = %v, want [\"typescript\"]", langs)
		}
	})

	t.Run("tsconfig.jsonが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "typescript" {
			t.Errorf("LanguageForProject() = %v, want [\"typescript\"]", langs)
		}
	})

	t.Run("pyproject.tomlが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "pyproject.toml"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "python" {
			t.Errorf("LanguageForProject() = %v, want [\"python\"]", langs)
		}
	})

	t.Run("setup.pyが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "setup.py"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "python" {
			t.Errorf("LanguageForProject() = %v, want [\"python\"]", langs)
		}
	})

	t.Run("requirements.txtが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "python" {
			t.Errorf("LanguageForProject() = %v, want [\"python\"]", langs)
		}
	})

	t.Run("Cargo.tomlが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "Cargo.toml"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "rust" {
			t.Errorf("LanguageForProject() = %v, want [\"rust\"]", langs)
		}
	})

	t.Run("Gemfileが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "Gemfile"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "ruby" {
			t.Errorf("LanguageForProject() = %v, want [\"ruby\"]", langs)
		}
	})

	t.Run("composer.jsonが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "composer.json"), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "php" {
			t.Errorf("LanguageForProject() = %v, want [\"php\"]", langs)
		}
	})

	t.Run("mix.exsが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "mix.exs"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "elixir" {
			t.Errorf("LanguageForProject() = %v, want [\"elixir\"]", langs)
		}
	})

	t.Run("pubspec.yamlが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "pubspec.yaml"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "dart" {
			t.Errorf("LanguageForProject() = %v, want [\"dart\"]", langs)
		}
	})

	t.Run("複数のプロジェクトファイルが存在する場合", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module test"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 2 {
			t.Fatalf("len(langs) = %d, want 2", len(langs))
		}

		// 順序は不定なのでソートして確認
		sort.Strings(langs)
		if langs[0] != "go" || langs[1] != "typescript" {
			t.Errorf("LanguageForProject() = %v, want [\"go\", \"typescript\"]", langs)
		}
	})

	t.Run("空のディレクトリの場合", func(t *testing.T) {
		dir := t.TempDir()

		langs := LanguageForProject(dir)
		if len(langs) != 0 {
			t.Errorf("LanguageForProject() = %v, want []", langs)
		}
	})

	t.Run("Pythonの複数プロジェクトファイルがあっても重複しない", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "pyproject.toml"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "setup.py"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte(""), 0644); err != nil {
			t.Fatal(err)
		}

		langs := LanguageForProject(dir)
		if len(langs) != 1 || langs[0] != "python" {
			t.Errorf("LanguageForProject() = %v, want [\"python\"]", langs)
		}
	})
}
