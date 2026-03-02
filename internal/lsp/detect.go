package lsp

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// PathLooker はコマンドのパスを検索するインターフェース。
// テスト時にモック実装を注入するために使用する。
type PathLooker interface {
	LookPath(file string) (string, error)
}

// execPathLooker は exec.LookPath を使用する PathLooker 実装。
type execPathLooker struct{}

func (execPathLooker) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}

// knownServer は検出対象の言語サーバーの定義。
type knownServer struct {
	language string
	command  string
	args     []string
}

// knownServers は検出対象の言語サーバー一覧。
var knownServers = []knownServer{
	{language: "go", command: "gopls", args: []string{"serve"}},
	{language: "typescript", command: "typescript-language-server", args: []string{"--stdio"}},
	{language: "python", command: "pyright-langserver", args: []string{"--stdio"}},
	{language: "rust", command: "rust-analyzer", args: []string{}},
}

// DetectServers はシステムにインストールされている言語サーバーを検出する。
func DetectServers() []ServerConfig {
	return DetectServersWithLooker(execPathLooker{})
}

// DetectServersWithLooker はカスタム PathLooker を使用して言語サーバーを検出する。
// テスト時にモックを注入するために使用する。
func DetectServersWithLooker(looker PathLooker) []ServerConfig {
	var configs []ServerConfig

	for _, ks := range knownServers {
		if _, err := looker.LookPath(ks.command); err == nil {
			configs = append(configs, ServerConfig{
				Language: ks.language,
				Command:  ks.command,
				Args:     ks.args,
				Enabled:  true,
			})
		}
	}

	return configs
}

// extensionToLanguage はファイル拡張子から言語識別子へのマッピング。
var extensionToLanguage = map[string]string{
	".go":   "go",
	".js":   "javascript",
	".jsx":  "javascript",
	".ts":   "typescript",
	".tsx":  "typescript",
	".py":   "python",
	".rs":   "rust",
	".c":    "c",
	".h":    "c",
	".cpp":  "cpp",
	".hpp":  "cpp",
	".cc":   "cpp",
	".cxx":  "cpp",
	".java": "java",
	".rb":   "ruby",
	".sh":   "bash",
	".bash": "bash",
}

// LanguageForFile はファイルパスから LSP 言語識別子を返す。
// 認識できない場合は空文字列を返す。
func LanguageForFile(filePath string) string {
	ext := strings.ToLower(filepath.Ext(filePath))
	if lang, ok := extensionToLanguage[ext]; ok {
		return lang
	}
	return ""
}

// projectFileToLanguage はプロジェクトファイルから言語識別子へのマッピング。
var projectFileToLanguage = map[string]string{
	"go.mod":           "go",
	"package.json":     "typescript",
	"tsconfig.json":    "typescript",
	"pyproject.toml":   "python",
	"setup.py":         "python",
	"requirements.txt": "python",
	"Cargo.toml":       "rust",
}

// LanguageForProject はプロジェクトのルートディレクトリを調べ、
// 使用されている言語の一覧を返す。
func LanguageForProject(rootDir string) []string {
	seen := make(map[string]bool)
	var languages []string

	for file, lang := range projectFileToLanguage {
		if seen[lang] {
			continue
		}
		if _, err := os.Stat(filepath.Join(rootDir, file)); err == nil {
			seen[lang] = true
			languages = append(languages, lang)
		}
	}

	return languages
}
