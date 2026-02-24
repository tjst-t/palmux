package cmddetect

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Command はプロジェクトで検出されたコマンド。
type Command struct {
	Label   string `json:"label"`
	Command string `json:"command"`
	Source  string `json:"source"`
}

// Detect はディレクトリ内のプロジェクトファイルからコマンドを検出する。
// Makefile > package.json の順に処理し、Makefile があれば go.mod/Cargo.toml/pyproject.toml の
// 定型コマンドは省略する。
func Detect(dir string) ([]Command, error) {
	var commands []Command
	hasMakefile := false

	// 1. Makefile
	makeContent, err := readFile(dir, "Makefile")
	if err == nil {
		hasMakefile = true
		targets := parseMakefileTargets(makeContent)
		for _, t := range targets {
			commands = append(commands, Command{
				Label:   t,
				Command: "make " + t + "\r",
				Source:  "Makefile",
			})
		}
	}

	// 2. package.json (Makefile の有無に関わらず検出)
	pkgContent, err := readFile(dir, "package.json")
	if err == nil {
		scripts := parsePackageJSONScripts(pkgContent)
		for _, name := range scripts {
			commands = append(commands, Command{
				Label:   name,
				Command: "npm run " + name + "\r",
				Source:  "package.json",
			})
		}
	}

	// 3-5. Makefile がない場合のみ定型コマンド
	if !hasMakefile {
		if _, err := readFile(dir, "Cargo.toml"); err == nil {
			commands = append(commands, cargoCommands()...)
		}

		if _, err := readFile(dir, "pyproject.toml"); err == nil {
			commands = append(commands, pyprojectCommands()...)
		}

		if _, err := readFile(dir, "go.mod"); err == nil {
			commands = append(commands, goModCommands()...)
		}
	}

	if len(commands) == 0 {
		return nil, nil
	}
	return commands, nil
}

func readFile(dir, name string) (string, error) {
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// makefileTargetRe は Makefile のターゲット行にマッチする正規表現。
// ^[a-zA-Z][a-zA-Z0-9_-]*: にマッチし、ターゲット名をキャプチャする。
var makefileTargetRe = regexp.MustCompile(`^([a-zA-Z][a-zA-Z0-9_-]*)\s*:`)

// variableAssignRe は変数代入行にマッチする正規表現。
var variableAssignRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*\s*[:?+]?=`)

func parseMakefileTargets(content string) []string {
	var targets []string
	for _, line := range strings.Split(content, "\n") {
		// タブ始まりの行（レシピ行）をスキップ
		if strings.HasPrefix(line, "\t") || strings.HasPrefix(line, " ") {
			continue
		}
		// コメント行をスキップ
		if strings.HasPrefix(line, "#") {
			continue
		}
		// 空行をスキップ
		if strings.TrimSpace(line) == "" {
			continue
		}
		// .始まりのターゲット (.PHONY 等) をスキップ
		if strings.HasPrefix(line, ".") {
			continue
		}
		// 変数代入行をスキップ
		if variableAssignRe.MatchString(line) {
			continue
		}
		// ターゲット行にマッチ
		m := makefileTargetRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		target := m[1]
		// _始まりのターゲットを除外
		if strings.HasPrefix(target, "_") {
			continue
		}
		// %パターンルールを除外 (already excluded by regex since % is not in [a-zA-Z0-9_-])
		targets = append(targets, target)
	}
	return targets
}

func parsePackageJSONScripts(content string) []string {
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal([]byte(content), &pkg); err != nil {
		return nil
	}
	if len(pkg.Scripts) == 0 {
		return nil
	}
	names := make([]string, 0, len(pkg.Scripts))
	for name := range pkg.Scripts {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func cargoCommands() []Command {
	return []Command{
		{Label: "cargo build", Command: "cargo build\r", Source: "Cargo.toml"},
		{Label: "cargo test", Command: "cargo test\r", Source: "Cargo.toml"},
		{Label: "cargo run", Command: "cargo run\r", Source: "Cargo.toml"},
		{Label: "cargo clippy", Command: "cargo clippy\r", Source: "Cargo.toml"},
	}
}

func pyprojectCommands() []Command {
	return []Command{
		{Label: "pytest", Command: "pytest\r", Source: "pyproject.toml"},
		{Label: "ruff check", Command: "ruff check\r", Source: "pyproject.toml"},
	}
}

func goModCommands() []Command {
	return []Command{
		{Label: "go test", Command: "go test ./...\r", Source: "go.mod"},
		{Label: "go build", Command: "go build ./...\r", Source: "go.mod"},
		{Label: "go vet", Command: "go vet ./...\r", Source: "go.mod"},
	}
}
