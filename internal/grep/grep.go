package grep

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
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
	// TODO: grep, builtin の実装
	return nil
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
