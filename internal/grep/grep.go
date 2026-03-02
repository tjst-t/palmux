package grep

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Options は全文検索のオプションを定義する。
type Options struct {
	CaseSensitive bool
	Regex         bool
	Glob          string
	MaxResults    int // デフォルト 500
	ContextLines  int
}

// Result は検索結果の1行を表す。
type Result struct {
	Path       string `json:"path"`
	LineNumber int    `json:"line_number"`
	LineText   string `json:"line_text"`
	MatchStart int    `json:"match_start"`
	MatchEnd   int    `json:"match_end"`
}

// Response は検索のレスポンス全体を表す。
type Response struct {
	Query     string   `json:"query"`
	Engine    string   `json:"engine"`
	Results   []Result `json:"results"`
	Truncated bool     `json:"truncated"`
}

// Searcher は全文検索エンジンのインターフェース。
type Searcher interface {
	Search(ctx context.Context, query string, dir string, opts Options) ([]Result, error)
	Name() string // "ripgrep", "grep", "builtin"
}

// defaultMaxResults はMaxResultsのデフォルト値。
const defaultMaxResults = 500

// NewSearcher は利用可能な最適な検索エンジンを返す。
// rg → grep → builtin の優先順で検出する。
func NewSearcher() Searcher {
	if _, err := exec.LookPath("rg"); err == nil {
		return &RipgrepSearcher{}
	}
	if _, err := exec.LookPath("grep"); err == nil {
		return &GrepSearcher{}
	}
	return &BuiltinSearcher{}
}

// BuildResponse は検索結果からResponseを構築する。
// maxResults が 0 の場合はデフォルト値（500）を使用する。
// 結果数が maxResults を超える場合は切り詰めて Truncated=true にする。
func BuildResponse(query, engine string, results []Result, maxResults int) Response {
	if maxResults <= 0 {
		maxResults = defaultMaxResults
	}

	resp := Response{
		Query:  query,
		Engine: engine,
	}

	if results == nil {
		resp.Results = []Result{}
		return resp
	}

	if len(results) > maxResults {
		resp.Results = results[:maxResults]
		resp.Truncated = true
	} else {
		resp.Results = results
	}

	return resp
}

// RipgrepSearcher は ripgrep (rg) を使った検索エンジン。
type RipgrepSearcher struct{}

// Name は検索エンジン名を返す。
func (s *RipgrepSearcher) Name() string {
	return "ripgrep"
}

// Search は ripgrep を使って全文検索を実行する。
func (s *RipgrepSearcher) Search(ctx context.Context, query string, dir string, opts Options) ([]Result, error) {
	if query == "" {
		return nil, nil
	}

	maxResults := opts.MaxResults
	if maxResults <= 0 {
		maxResults = defaultMaxResults
	}

	args := s.buildArgs(query, opts)

	cmd := exec.CommandContext(ctx, "rg", args...)
	cmd.Dir = dir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		// exit code 1 は "マッチなし" を意味する — エラーではない
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() == 1 {
				return nil, nil
			}
		}
		// コンテキストキャンセルの場合はエラーを返す
		if ctx.Err() != nil {
			return nil, fmt.Errorf("search cancelled: %w", ctx.Err())
		}
		return nil, fmt.Errorf("ripgrep error: %w (stderr: %s)", err, stderr.String())
	}

	results, err := parseRipgrepJSON(stdout.Bytes())
	if err != nil {
		return nil, fmt.Errorf("parse ripgrep output: %w", err)
	}

	// MaxResults で切り詰め
	if len(results) > maxResults {
		results = results[:maxResults]
	}

	return results, nil
}

// buildArgs は ripgrep のコマンドライン引数を組み立てる。
func (s *RipgrepSearcher) buildArgs(query string, opts Options) []string {
	args := []string{
		"--json",
		"--max-count", "10",
		"--max-filesize", "1M",
	}

	if !opts.CaseSensitive {
		args = append(args, "-i")
	}

	if !opts.Regex {
		args = append(args, "--fixed-strings")
	}

	if opts.Glob != "" {
		args = append(args, "--glob", opts.Glob)
	}

	if opts.ContextLines > 0 {
		args = append(args, fmt.Sprintf("--context=%d", opts.ContextLines))
	}

	args = append(args, query)

	return args
}

// ripgrep JSON 出力の型定義
type rgMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type rgMatchData struct {
	Path       rgText       `json:"path"`
	Lines      rgText       `json:"lines"`
	LineNumber int          `json:"line_number"`
	Submatches []rgSubmatch `json:"submatches"`
}

type rgText struct {
	Text string `json:"text"`
}

type rgSubmatch struct {
	Match rgText `json:"match"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// --- GrepSearcher ---

// GrepSearcher は GNU grep を使った検索エンジン。
type GrepSearcher struct{}

// Name は検索エンジン名を返す。
func (s *GrepSearcher) Name() string {
	return "grep"
}

// Search は grep -rn を使って全文検索を実行する。
func (s *GrepSearcher) Search(ctx context.Context, query string, dir string, opts Options) ([]Result, error) {
	if query == "" {
		return nil, nil
	}

	maxResults := opts.MaxResults
	if maxResults <= 0 {
		maxResults = defaultMaxResults
	}

	args := s.buildArgs(query, opts)

	cmd := exec.CommandContext(ctx, "grep", args...)
	cmd.Dir = dir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		// exit code 1 は "マッチなし" — エラーではない
		if exitErr, ok := err.(*exec.ExitError); ok {
			if exitErr.ExitCode() == 1 {
				return nil, nil
			}
		}
		if ctx.Err() != nil {
			return nil, fmt.Errorf("search cancelled: %w", ctx.Err())
		}
		return nil, fmt.Errorf("grep error: %w (stderr: %s)", err, stderr.String())
	}

	results := s.parseOutput(stdout.Bytes(), query, opts)

	if len(results) > maxResults {
		results = results[:maxResults]
	}

	return results, nil
}

// buildArgs は grep のコマンドライン引数を組み立てる。
func (s *GrepSearcher) buildArgs(query string, opts Options) []string {
	args := []string{"-rn", "--binary-files=without-match"}

	if !opts.CaseSensitive {
		args = append(args, "-i")
	}

	if !opts.Regex {
		args = append(args, "-F")
	}

	if opts.Glob != "" {
		args = append(args, "--include="+opts.Glob)
	}

	args = append(args, query)

	return args
}

// parseOutput は grep の出力をパースして Result スライスを返す。
// 出力形式: filepath:linenum:content
func (s *GrepSearcher) parseOutput(data []byte, query string, opts Options) []Result {
	if len(data) == 0 {
		return nil
	}

	var results []Result

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// filepath:linenum:content のパース
		// 最初のコロンでパス、次のコロンで行番号を分離
		firstColon := strings.Index(line, ":")
		if firstColon < 0 {
			continue
		}
		rest := line[firstColon+1:]
		secondColon := strings.Index(rest, ":")
		if secondColon < 0 {
			continue
		}

		filePath := line[:firstColon]
		lineNumStr := rest[:secondColon]
		content := rest[secondColon+1:]

		lineNum, err := strconv.Atoi(lineNumStr)
		if err != nil {
			continue
		}

		// MatchStart/MatchEnd を計算
		var matchStart, matchEnd int
		if !opts.Regex {
			// 固定文字列検索: 文字列位置を特定
			searchContent := content
			searchQuery := query
			if !opts.CaseSensitive {
				searchContent = strings.ToLower(content)
				searchQuery = strings.ToLower(query)
			}
			idx := strings.Index(searchContent, searchQuery)
			if idx >= 0 {
				matchStart = idx
				matchEnd = idx + len(query)
			}
		}
		// 正規表現の場合は MatchStart=0, MatchEnd=0 のまま

		results = append(results, Result{
			Path:       filePath,
			LineNumber: lineNum,
			LineText:   content,
			MatchStart: matchStart,
			MatchEnd:   matchEnd,
		})
	}

	return results
}

// --- BuiltinSearcher ---

// BuiltinSearcher は外部コマンドを使わない pure Go 検索エンジン。
type BuiltinSearcher struct{}

// Name は検索エンジン名を返す。
func (s *BuiltinSearcher) Name() string {
	return "builtin"
}

// builtinMaxFileSize はスキャンする最大ファイルサイズ（1MB）。
const builtinMaxFileSize = 1 * 1024 * 1024

// builtinSkipDirs はスキップするディレクトリ名の集合。
var builtinSkipDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
}

// Search は filepath.WalkDir + bufio.Scanner を使って全文検索を実行する。
func (s *BuiltinSearcher) Search(ctx context.Context, query string, dir string, opts Options) ([]Result, error) {
	if query == "" {
		return nil, nil
	}

	maxResults := opts.MaxResults
	if maxResults <= 0 {
		maxResults = defaultMaxResults
	}

	// マッチ関数を準備
	matcher, err := s.buildMatcher(query, opts)
	if err != nil {
		return nil, fmt.Errorf("invalid pattern: %w", err)
	}

	var results []Result

	walkErr := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // ファイルアクセスエラーはスキップ
		}

		// コンテキストキャンセルのチェック（ファイル間）
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// MaxResults に達したら終了
		if len(results) >= maxResults {
			return fs.SkipAll
		}

		// ディレクトリのスキップ
		if d.IsDir() {
			if builtinSkipDirs[d.Name()] {
				return fs.SkipDir
			}
			return nil
		}

		// 通常ファイルのみ処理
		if !d.Type().IsRegular() {
			return nil
		}

		// ファイルサイズチェック
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.Size() > builtinMaxFileSize {
			return nil
		}

		// 相対パスを計算
		relPath, err := filepath.Rel(dir, path)
		if err != nil {
			return nil
		}

		// バイナリファイルチェック
		if s.isBinary(path) {
			return nil
		}

		// ファイルを読んで検索
		fileResults := s.searchFile(path, relPath, matcher, maxResults-len(results))
		results = append(results, fileResults...)

		return nil
	})

	if walkErr != nil {
		// コンテキストキャンセルの場合
		if ctx.Err() != nil {
			return results, fmt.Errorf("search cancelled: %w", ctx.Err())
		}
		return results, fmt.Errorf("walk error: %w", walkErr)
	}

	return results, nil
}

// matchFunc は1行に対してマッチ判定を行い、(matched, matchStart, matchEnd) を返す。
type matchFunc func(line string) (bool, int, int)

// buildMatcher は検索オプションに基づいてマッチ関数を構築する。
func (s *BuiltinSearcher) buildMatcher(query string, opts Options) (matchFunc, error) {
	if opts.Regex {
		pattern := query
		if !opts.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, err
		}
		return func(line string) (bool, int, int) {
			loc := re.FindStringIndex(line)
			if loc == nil {
				return false, 0, 0
			}
			return true, loc[0], loc[1]
		}, nil
	}

	// 固定文字列検索
	if !opts.CaseSensitive {
		lowerQuery := strings.ToLower(query)
		return func(line string) (bool, int, int) {
			idx := strings.Index(strings.ToLower(line), lowerQuery)
			if idx < 0 {
				return false, 0, 0
			}
			return true, idx, idx + len(lowerQuery)
		}, nil
	}

	return func(line string) (bool, int, int) {
		idx := strings.Index(line, query)
		if idx < 0 {
			return false, 0, 0
		}
		return true, idx, idx + len(query)
	}, nil
}

// isBinary は先頭512バイトにnullバイトが含まれるかでバイナリ判定する。
func (s *BuiltinSearcher) isBinary(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return true // 開けないファイルはスキップ
	}
	defer f.Close()

	buf := make([]byte, 512)
	n, err := f.Read(buf)
	if n == 0 {
		return false // 空ファイル
	}

	for i := 0; i < n; i++ {
		if buf[i] == 0 {
			return true
		}
	}
	return false
}

// searchFile は1ファイルを行ごとにスキャンしてマッチ結果を返す。
func (s *BuiltinSearcher) searchFile(path, relPath string, matcher matchFunc, limit int) []Result {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var results []Result
	scanner := bufio.NewScanner(f)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		matched, matchStart, matchEnd := matcher(line)
		if !matched {
			continue
		}

		results = append(results, Result{
			Path:       relPath,
			LineNumber: lineNum,
			LineText:   line,
			MatchStart: matchStart,
			MatchEnd:   matchEnd,
		})

		if len(results) >= limit {
			break
		}
	}

	return results
}

// parseRipgrepJSON は ripgrep の --json 出力をパースして Result のスライスを返す。
// 不正なJSON行はスキップする。
func parseRipgrepJSON(data []byte) ([]Result, error) {
	if len(data) == 0 {
		return nil, nil
	}

	var results []Result

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var msg rgMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			// 不正なJSON行はスキップ
			continue
		}

		if msg.Type != "match" {
			// begin, end, summary, context 等はスキップ
			continue
		}

		var matchData rgMatchData
		if err := json.Unmarshal(msg.Data, &matchData); err != nil {
			continue
		}

		lineText := matchData.Lines.Text

		var matchStart, matchEnd int
		if len(matchData.Submatches) > 0 {
			matchStart = matchData.Submatches[0].Start
			matchEnd = matchData.Submatches[0].End
		}

		// パスの正規化: バックスラッシュをスラッシュに統一
		path := strings.ReplaceAll(matchData.Path.Text, "\\", "/")

		results = append(results, Result{
			Path:       path,
			LineNumber: matchData.LineNumber,
			LineText:   lineText,
			MatchStart: matchStart,
			MatchEnd:   matchEnd,
		})
	}

	if err := scanner.Err(); err != nil {
		return results, fmt.Errorf("scanning ripgrep output: %w", err)
	}

	return results, nil
}
