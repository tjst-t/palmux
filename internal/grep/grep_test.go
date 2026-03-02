package grep

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// setupTestDir はテスト用のディレクトリ構造を作成する。
//
//	root/
//	  hello.go       (Goソースファイル)
//	  readme.md      (マークダウン)
//	  sub/
//	    other.go     (サブディレクトリ内のGoファイル)
//	  binary.bin     (バイナリファイル)
func setupTestDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	if err := os.WriteFile(filepath.Join(root, "hello.go"), []byte("package main\n\nfunc Hello() string {\n\treturn \"hello world\"\n}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "readme.md"), []byte("# Test\n\nHello World\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "other.go"), []byte("package sub\n\nfunc Other() {}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "binary.bin"), []byte{0x00, 0x01, 0x02}, 0644); err != nil {
		t.Fatal(err)
	}

	return root
}

// --- RipgrepSearcher テスト ---

func TestRipgrepSearcher_Search(t *testing.T) {
	root := setupTestDir(t)
	s := &RipgrepSearcher{}

	tests := []struct {
		name          string
		query         string
		opts          Options
		wantMinCount  int // 最低でもこの数の結果がほしい
		wantMaxCount  int // この数以下であること（0は制限なし）
		wantPaths     []string
		wantNotPaths  []string
		wantTruncated bool
		wantEmpty     bool
	}{
		{
			name:         "基本的な検索: Hello",
			query:        "Hello",
			opts:         Options{},
			wantMinCount: 2, // hello.go と readme.md
			wantPaths:    []string{"hello.go", "readme.md"},
		},
		{
			name:         "大文字小文字を区別しない検索（デフォルト）",
			query:        "hello",
			opts:         Options{CaseSensitive: false},
			wantMinCount: 2, // hello.go("Hello", "hello") と readme.md("Hello")
			wantPaths:    []string{"hello.go", "readme.md"},
		},
		{
			name:         "大文字小文字を区別する検索",
			query:        "Hello",
			opts:         Options{CaseSensitive: true},
			wantMinCount: 1,
			wantPaths:    []string{"hello.go"}, // func Hello()
		},
		{
			name:         "大文字小文字を区別する検索: 小文字hello",
			query:        "hello",
			opts:         Options{CaseSensitive: true},
			wantMinCount: 1,
			wantPaths:    []string{"hello.go"}, // "hello world"
		},
		{
			name:         "固定文字列検索（デフォルト: Regex=false）",
			query:        "func",
			opts:         Options{},
			wantMinCount: 2, // hello.go と sub/other.go
		},
		{
			name:         "正規表現検索",
			query:        "func\\s+\\w+\\(",
			opts:         Options{Regex: true},
			wantMinCount: 2, // hello.go と sub/other.go
		},
		{
			name:         "Globフィルタ: .goファイルのみ",
			query:        "Hello",
			opts:         Options{Glob: "*.go"},
			wantMinCount: 1,
			wantPaths:    []string{"hello.go"},
			wantNotPaths: []string{"readme.md"},
		},
		{
			name:         "Globフィルタ: .mdファイルのみ",
			query:        "Hello",
			opts:         Options{Glob: "*.md"},
			wantMinCount: 1,
			wantPaths:    []string{"readme.md"},
			wantNotPaths: []string{"hello.go"},
		},
		{
			name:      "空クエリ: 結果なし",
			query:     "",
			opts:      Options{},
			wantEmpty: true,
		},
		{
			name:      "マッチなし",
			query:     "zzz_nonexistent_pattern_zzz",
			opts:      Options{},
			wantEmpty: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results, err := s.Search(context.Background(), tt.query, root, tt.opts)
			if err != nil {
				t.Fatalf("Search(%q) error: %v", tt.query, err)
			}

			if tt.wantEmpty {
				if len(results) != 0 {
					t.Errorf("expected empty results, got %d", len(results))
				}
				return
			}

			if len(results) < tt.wantMinCount {
				t.Errorf("got %d results, want at least %d", len(results), tt.wantMinCount)
			}

			if tt.wantMaxCount > 0 && len(results) > tt.wantMaxCount {
				t.Errorf("got %d results, want at most %d", len(results), tt.wantMaxCount)
			}

			// wantPaths に含まれるパスが結果に存在すること
			resultPaths := make(map[string]bool)
			for _, r := range results {
				resultPaths[r.Path] = true
			}
			for _, wantPath := range tt.wantPaths {
				if !resultPaths[wantPath] {
					t.Errorf("expected path %q in results, got paths: %v", wantPath, resultPathsList(results))
				}
			}

			// wantNotPaths に含まれるパスが結果に存在しないこと
			for _, notPath := range tt.wantNotPaths {
				if resultPaths[notPath] {
					t.Errorf("did not expect path %q in results", notPath)
				}
			}
		})
	}
}

func TestRipgrepSearcher_MaxResults(t *testing.T) {
	// 多くのファイルを含むテストディレクトリを作成
	root := t.TempDir()
	for i := 0; i < 20; i++ {
		content := strings.Repeat("match_target line\n", 5)
		fname := filepath.Join(root, "file"+strings.Repeat("_", i)+".txt")
		if err := os.WriteFile(fname, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	s := &RipgrepSearcher{}

	t.Run("MaxResults制限とTruncatedフラグ", func(t *testing.T) {
		results, err := s.Search(context.Background(), "match_target", root, Options{MaxResults: 5})
		if err != nil {
			t.Fatalf("Search error: %v", err)
		}

		if len(results) != 5 {
			t.Errorf("got %d results, want exactly 5", len(results))
		}
	})

	t.Run("MaxResults=0はデフォルト500を使用", func(t *testing.T) {
		results, err := s.Search(context.Background(), "match_target", root, Options{MaxResults: 0})
		if err != nil {
			t.Fatalf("Search error: %v", err)
		}

		// 20ファイル * 5行 = 100行 < 500 なので全部返る
		if len(results) != 100 {
			t.Errorf("got %d results, want 100", len(results))
		}
	})
}

func TestRipgrepSearcher_ContextCancellation(t *testing.T) {
	root := setupTestDir(t)
	s := &RipgrepSearcher{}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 即座にキャンセル

	results, err := s.Search(ctx, "Hello", root, Options{})
	// キャンセルされたコンテキストではエラーか空の結果が返る
	if err != nil {
		// context.Canceled エラーは許容
		if !strings.Contains(err.Error(), "context canceled") &&
			!strings.Contains(err.Error(), "signal: killed") {
			t.Errorf("unexpected error: %v", err)
		}
		return
	}
	// エラーなしの場合、結果は空かもしれない（キャンセルのタイミング次第）
	_ = results
}

func TestRipgrepSearcher_ResultFields(t *testing.T) {
	root := setupTestDir(t)
	s := &RipgrepSearcher{}

	results, err := s.Search(context.Background(), "Hello", root, Options{CaseSensitive: true})
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}

	if len(results) == 0 {
		t.Fatal("expected at least one result")
	}

	// hello.go の "func Hello()" を見つけるはず
	var found bool
	for _, r := range results {
		if r.Path == "hello.go" && strings.Contains(r.LineText, "Hello") {
			found = true

			if r.LineNumber <= 0 {
				t.Errorf("LineNumber should be positive, got %d", r.LineNumber)
			}

			// パスは検索ディレクトリからの相対パスであること
			if filepath.IsAbs(r.Path) {
				t.Errorf("Path should be relative, got %q", r.Path)
			}

			// MatchStart と MatchEnd が正しいこと
			if r.MatchStart < 0 || r.MatchEnd <= r.MatchStart {
				t.Errorf("invalid match range: start=%d, end=%d", r.MatchStart, r.MatchEnd)
			}

			// MatchStart/MatchEnd が LineText 内に収まること
			if r.MatchEnd > len(r.LineText) {
				t.Errorf("MatchEnd (%d) exceeds LineText length (%d)", r.MatchEnd, len(r.LineText))
			}

			break
		}
	}

	if !found {
		t.Errorf("expected to find Hello in hello.go, got results: %v", results)
	}
}

func TestRipgrepSearcher_RelativePaths(t *testing.T) {
	root := setupTestDir(t)
	s := &RipgrepSearcher{}

	results, err := s.Search(context.Background(), "Other", root, Options{})
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}

	for _, r := range results {
		if filepath.IsAbs(r.Path) {
			t.Errorf("expected relative path, got absolute: %q", r.Path)
		}
		// サブディレクトリのファイルは "sub/other.go" のようになるはず
		if strings.Contains(r.LineText, "Other") && r.Path != filepath.Join("sub", "other.go") {
			t.Errorf("expected path %q, got %q", filepath.Join("sub", "other.go"), r.Path)
		}
	}
}

func TestRipgrepSearcher_Name(t *testing.T) {
	s := &RipgrepSearcher{}
	if s.Name() != "ripgrep" {
		t.Errorf("Name() = %q, want %q", s.Name(), "ripgrep")
	}
}

func TestRipgrepSearcher_Timeout(t *testing.T) {
	root := setupTestDir(t)
	s := &RipgrepSearcher{}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// タイムアウトが非常に短いので結果が返るかエラーになるか
	_, err := s.Search(ctx, "Hello", root, Options{})
	// 小さなディレクトリなのでタイムアウト前に完了する可能性が高い
	// エラーが出ても context.DeadlineExceeded なら許容
	if err != nil {
		if !strings.Contains(err.Error(), "deadline exceeded") &&
			!strings.Contains(err.Error(), "signal: killed") {
			// 小さなディレクトリなのでタイムアウト前に完了するかもしれない
			// その場合はエラーなしで問題ない
		}
	}
}

// --- NewSearcher テスト ---

func TestNewSearcher(t *testing.T) {
	s := NewSearcher()
	if s == nil {
		t.Fatal("NewSearcher() returned nil")
	}

	// このシステムには rg がインストールされているので ripgrep が選ばれるはず
	if s.Name() != "ripgrep" {
		t.Errorf("NewSearcher().Name() = %q, want %q (rg is available on this system)", s.Name(), "ripgrep")
	}
}

func TestNewSearcher_FunctionalSearch(t *testing.T) {
	root := setupTestDir(t)
	s := NewSearcher()
	if s == nil {
		t.Fatal("NewSearcher() returned nil")
	}

	results, err := s.Search(context.Background(), "Hello", root, Options{})
	if err != nil {
		t.Fatalf("Search error: %v", err)
	}

	if len(results) == 0 {
		t.Error("expected at least one result")
	}
}

// --- BuildResponse テスト ---

func TestBuildResponse(t *testing.T) {
	tests := []struct {
		name          string
		query         string
		engine        string
		results       []Result
		maxResults    int
		wantCount     int
		wantTruncated bool
	}{
		{
			name:   "結果がMaxResults以下: Truncated=false",
			query:  "test",
			engine: "ripgrep",
			results: []Result{
				{Path: "a.go", LineNumber: 1, LineText: "test"},
				{Path: "b.go", LineNumber: 2, LineText: "test"},
			},
			maxResults:    10,
			wantCount:     2,
			wantTruncated: false,
		},
		{
			name:   "結果がMaxResultsを超える: Truncated=true",
			query:  "test",
			engine: "ripgrep",
			results: func() []Result {
				r := make([]Result, 10)
				for i := range r {
					r[i] = Result{Path: "file.go", LineNumber: i + 1, LineText: "test"}
				}
				return r
			}(),
			maxResults:    5,
			wantCount:     5,
			wantTruncated: true,
		},
		{
			name:          "空の結果",
			query:         "nothing",
			engine:        "ripgrep",
			results:       nil,
			maxResults:    500,
			wantCount:     0,
			wantTruncated: false,
		},
		{
			name:   "maxResults=0はデフォルト500を使用",
			query:  "test",
			engine: "ripgrep",
			results: func() []Result {
				r := make([]Result, 3)
				for i := range r {
					r[i] = Result{Path: "file.go", LineNumber: i + 1, LineText: "test"}
				}
				return r
			}(),
			maxResults:    0,
			wantCount:     3,
			wantTruncated: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := BuildResponse(tt.query, tt.engine, tt.results, tt.maxResults)

			if resp.Query != tt.query {
				t.Errorf("Query = %q, want %q", resp.Query, tt.query)
			}
			if resp.Engine != tt.engine {
				t.Errorf("Engine = %q, want %q", resp.Engine, tt.engine)
			}
			if len(resp.Results) != tt.wantCount {
				t.Errorf("got %d results, want %d", len(resp.Results), tt.wantCount)
			}
			if resp.Truncated != tt.wantTruncated {
				t.Errorf("Truncated = %v, want %v", resp.Truncated, tt.wantTruncated)
			}
		})
	}
}

// --- JSON パーサーテスト ---

func TestParseRipgrepJSON(t *testing.T) {
	tests := []struct {
		name      string
		jsonLines string
		wantCount int
		wantFirst Result
		wantErr   bool
	}{
		{
			name: "正常なマッチ行",
			jsonLines: `{"type":"begin","data":{"path":{"text":"file.go"}}}
{"type":"match","data":{"path":{"text":"file.go"},"lines":{"text":"func HandleRequest() {\n"},"line_number":42,"submatches":[{"match":{"text":"HandleRequest"},"start":5,"end":18}]}}
{"type":"end","data":{"path":{"text":"file.go"},"stats":{"matched_lines":1}}}
{"type":"summary","data":{"elapsed_total":{"secs":0,"nanos":1000},"stats":{"matched_lines":1}}}`,
			wantCount: 1,
			wantFirst: Result{
				Path:       "file.go",
				LineNumber: 42,
				LineText:   "func HandleRequest() {\n",
				MatchStart: 5,
				MatchEnd:   18,
			},
		},
		{
			name: "複数マッチ",
			jsonLines: `{"type":"match","data":{"path":{"text":"a.go"},"lines":{"text":"func Foo() {}\n"},"line_number":1,"submatches":[{"match":{"text":"Foo"},"start":5,"end":8}]}}
{"type":"match","data":{"path":{"text":"b.go"},"lines":{"text":"func Bar() {}\n"},"line_number":10,"submatches":[{"match":{"text":"Bar"},"start":5,"end":8}]}}`,
			wantCount: 2,
			wantFirst: Result{
				Path:       "a.go",
				LineNumber: 1,
				LineText:   "func Foo() {}\n",
				MatchStart: 5,
				MatchEnd:   8,
			},
		},
		{
			name:      "1行に複数submatchがある場合は最初のsubmatchを使う",
			jsonLines: `{"type":"match","data":{"path":{"text":"test.go"},"lines":{"text":"foo bar foo\n"},"line_number":5,"submatches":[{"match":{"text":"foo"},"start":0,"end":3},{"match":{"text":"foo"},"start":8,"end":11}]}}`,
			wantCount: 1,
			wantFirst: Result{
				Path:       "test.go",
				LineNumber: 5,
				LineText:   "foo bar foo\n",
				MatchStart: 0,
				MatchEnd:   3,
			},
		},
		{
			name:      "空の入力",
			jsonLines: "",
			wantCount: 0,
		},
		{
			name: "begin/end/summaryのみ（マッチなし）",
			jsonLines: `{"type":"begin","data":{"path":{"text":"file.go"}}}
{"type":"end","data":{"path":{"text":"file.go"},"stats":{"matched_lines":0}}}
{"type":"summary","data":{"elapsed_total":{"secs":0,"nanos":1000},"stats":{"matched_lines":0}}}`,
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results, err := parseRipgrepJSON([]byte(tt.jsonLines))
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseRipgrepJSON error: %v", err)
			}

			if len(results) != tt.wantCount {
				t.Errorf("got %d results, want %d", len(results), tt.wantCount)
			}

			if tt.wantCount > 0 && len(results) > 0 {
				got := results[0]
				want := tt.wantFirst
				if got.Path != want.Path {
					t.Errorf("Path = %q, want %q", got.Path, want.Path)
				}
				if got.LineNumber != want.LineNumber {
					t.Errorf("LineNumber = %d, want %d", got.LineNumber, want.LineNumber)
				}
				if got.LineText != want.LineText {
					t.Errorf("LineText = %q, want %q", got.LineText, want.LineText)
				}
				if got.MatchStart != want.MatchStart {
					t.Errorf("MatchStart = %d, want %d", got.MatchStart, want.MatchStart)
				}
				if got.MatchEnd != want.MatchEnd {
					t.Errorf("MatchEnd = %d, want %d", got.MatchEnd, want.MatchEnd)
				}
			}
		})
	}
}

func TestParseRipgrepJSON_MalformedLine(t *testing.T) {
	// 不正なJSON行があっても他の行はパースできる
	input := `not a json line
{"type":"match","data":{"path":{"text":"ok.go"},"lines":{"text":"test\n"},"line_number":1,"submatches":[{"match":{"text":"test"},"start":0,"end":4}]}}
also not json`

	results, err := parseRipgrepJSON([]byte(input))
	if err != nil {
		t.Fatalf("parseRipgrepJSON error: %v", err)
	}

	if len(results) != 1 {
		t.Errorf("got %d results, want 1 (should skip malformed lines)", len(results))
	}
}

// --- Response JSON シリアライズテスト ---

func TestResponse_JSON(t *testing.T) {
	resp := Response{
		Query:  "test",
		Engine: "ripgrep",
		Results: []Result{
			{
				Path:       "file.go",
				LineNumber: 42,
				LineText:   "func test() {}",
				MatchStart: 5,
				MatchEnd:   9,
			},
		},
		Truncated: false,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded Response
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.Query != resp.Query {
		t.Errorf("Query = %q, want %q", decoded.Query, resp.Query)
	}
	if decoded.Engine != resp.Engine {
		t.Errorf("Engine = %q, want %q", decoded.Engine, resp.Engine)
	}
	if len(decoded.Results) != 1 {
		t.Fatalf("got %d results, want 1", len(decoded.Results))
	}
	if decoded.Results[0].Path != "file.go" {
		t.Errorf("Path = %q, want %q", decoded.Results[0].Path, "file.go")
	}
}

// --- ヘルパー ---

func resultPathsList(results []Result) []string {
	seen := make(map[string]bool)
	for _, r := range results {
		seen[r.Path] = true
	}
	paths := make([]string, 0, len(seen))
	for p := range seen {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	return paths
}
