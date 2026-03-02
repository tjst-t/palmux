package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/tjst-t/palmux/internal/lsp"
	"github.com/tjst-t/palmux/internal/tmux"
)

// mockLSPService は LSPService のモック実装。
type mockLSPService struct {
	available     bool
	servers       []lsp.ServerInfo
	definition    []lsp.Location
	definitionErr error
	symbols       []lsp.DocumentSymbol
	symbolsErr    error

	// 呼び出し記録
	calledDefinition       bool
	lastDefRootDir         string
	lastDefFile            string
	lastDefLine            int
	lastDefCol             int
	calledDocumentSymbols  bool
	lastSymbolsRootDir     string
	lastSymbolsFile        string
}

func (m *mockLSPService) Available() bool { return m.available }
func (m *mockLSPService) Status() []lsp.ServerInfo { return m.servers }

func (m *mockLSPService) Definition(ctx context.Context, rootDir, file string, line, col int) ([]lsp.Location, error) {
	m.calledDefinition = true
	m.lastDefRootDir = rootDir
	m.lastDefFile = file
	m.lastDefLine = line
	m.lastDefCol = col
	return m.definition, m.definitionErr
}

func (m *mockLSPService) DocumentSymbols(ctx context.Context, rootDir, file string) ([]lsp.DocumentSymbol, error) {
	m.calledDocumentSymbols = true
	m.lastSymbolsRootDir = rootDir
	m.lastSymbolsFile = file
	return m.symbols, m.symbolsErr
}

func (m *mockLSPService) Shutdown(ctx context.Context) error { return nil }

// newTestServerWithLSP はテスト用 Server を LSP サービス付きで作成するヘルパー。
func newTestServerWithLSP(mock TmuxManager, lspSvc lsp.LSPService) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
		LSP:      lspSvc,
	})
	return srv, token
}

func TestLspStatus(t *testing.T) {
	tests := []struct {
		name       string
		lspSvc     lsp.LSPService // nil = LSP disabled
		wantStatus int
		wantAvail  bool
		wantCount  int
	}{
		{
			name:       "LSPがnilの場合: available=falseで空配列を返す",
			lspSvc:     nil,
			wantStatus: http.StatusOK,
			wantAvail:  false,
			wantCount:  0,
		},
		{
			name: "LSPが有効でサーバーが存在する場合: サーバー一覧を返す",
			lspSvc: &mockLSPService{
				available: true,
				servers: []lsp.ServerInfo{
					{Language: "go", Status: lsp.StatusReady, Server: "gopls", RootDir: "/project"},
				},
			},
			wantStatus: http.StatusOK,
			wantAvail:  true,
			wantCount:  1,
		},
		{
			name: "LSPが有効でサーバーが空の場合: 空配列を返す",
			lspSvc: &mockLSPService{
				available: true,
				servers:   []lsp.ServerInfo{},
			},
			wantStatus: http.StatusOK,
			wantAvail:  true,
			wantCount:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				projectDir: "/project",
			}
			srv, token := newTestServerWithLSP(mock, tt.lspSvc)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/lsp/status", token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}

			var resp lspStatusResponse
			if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			if resp.Available != tt.wantAvail {
				t.Errorf("available = %v, want %v", resp.Available, tt.wantAvail)
			}

			if len(resp.Servers) != tt.wantCount {
				t.Errorf("servers count = %d, want %d", len(resp.Servers), tt.wantCount)
			}
		})
	}
}

func TestLspDefinition(t *testing.T) {
	tests := []struct {
		name       string
		lspSvc     lsp.LSPService
		queryStr   string
		projectDir string
		projDirErr error
		wantStatus int
		wantLocs   int
		// 呼び出し検証
		wantDefFile string
		wantDefLine int
		wantDefCol  int
	}{
		{
			name: "正常: 定義場所を返す（1-based→0-basedの変換）",
			lspSvc: &mockLSPService{
				available: true,
				definition: []lsp.Location{
					{
						URI: "file:///project/internal/server/server.go",
						Range: lsp.Range{
							Start: lsp.Position{Line: 9, Character: 5},
							End:   lsp.Position{Line: 9, Character: 11},
						},
					},
				},
			},
			queryStr:    "?file=server.go&line=43&col=11",
			projectDir:  "/project",
			wantStatus:  http.StatusOK,
			wantLocs:    1,
			wantDefFile: "server.go",
			wantDefLine: 42, // API 1-based (43) → LSP 0-based (42)
			wantDefCol:  10, // API 1-based (11) → LSP 0-based (10)
		},
		{
			name:       "LSPが無効: 503を返す",
			lspSvc:     nil,
			queryStr:   "?file=server.go&line=1&col=1",
			projectDir: "/project",
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name: "fileパラメータなし: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?line=1&col=1",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "lineパラメータなし: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go&col=1",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "colパラメータなし: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go&line=1",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "lineが不正な整数: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go&line=abc&col=1",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "colが不正な整数: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go&line=1&col=xyz",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "セッションが存在しない: 404を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go&line=1&col=1",
			projDirErr: tmux.ErrSessionNotFound,
			wantStatus: http.StatusNotFound,
		},
		{
			name: "LSPエラー: 500を返す",
			lspSvc: &mockLSPService{
				available:     true,
				definitionErr: errors.New("LSP request failed"),
			},
			queryStr:   "?file=server.go&line=1&col=1",
			projectDir: "/project",
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "定義が見つからない: 空配列を返す",
			lspSvc: &mockLSPService{
				available:  true,
				definition: nil,
			},
			queryStr:   "?file=server.go&line=1&col=1",
			projectDir: "/project",
			wantStatus: http.StatusOK,
			wantLocs:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				projectDir:    tt.projectDir,
				projectDirErr: tt.projDirErr,
			}
			srv, token := newTestServerWithLSP(mock, tt.lspSvc)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/lsp/definition"+tt.queryStr, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var resp lspDefinitionResponse
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if len(resp.Locations) != tt.wantLocs {
					t.Errorf("locations count = %d, want %d", len(resp.Locations), tt.wantLocs)
				}

				// 呼び出しパラメータの検証
				if tt.wantDefFile != "" {
					lspMock := tt.lspSvc.(*mockLSPService)
					if !lspMock.calledDefinition {
						t.Error("Definition was not called")
					}
					if lspMock.lastDefFile != tt.wantDefFile {
						t.Errorf("Definition file = %q, want %q", lspMock.lastDefFile, tt.wantDefFile)
					}
					if lspMock.lastDefLine != tt.wantDefLine {
						t.Errorf("Definition line = %d, want %d", lspMock.lastDefLine, tt.wantDefLine)
					}
					if lspMock.lastDefCol != tt.wantDefCol {
						t.Errorf("Definition col = %d, want %d", lspMock.lastDefCol, tt.wantDefCol)
					}
				}
			}
		})
	}
}

func TestLspDefinition_LocationConversion(t *testing.T) {
	// URI → 相対パス変換、line は 0-based → 1-based の検証
	lspMock := &mockLSPService{
		available: true,
		definition: []lsp.Location{
			{
				URI: "file:///project/internal/server/server.go",
				Range: lsp.Range{
					Start: lsp.Position{Line: 41, Character: 5},
					End:   lsp.Position{Line: 41, Character: 11},
				},
			},
			{
				URI: "file:///project/main.go",
				Range: lsp.Range{
					Start: lsp.Position{Line: 0, Character: 0},
					End:   lsp.Position{Line: 0, Character: 4},
				},
			},
		},
	}
	mock := &configurableMock{
		projectDir: "/project",
	}
	srv, token := newTestServerWithLSP(mock, lspMock)
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/lsp/definition?file=server.go&line=10&col=5", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resp lspDefinitionResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Locations) != 2 {
		t.Fatalf("locations count = %d, want 2", len(resp.Locations))
	}

	// 1つ目: file:///project/internal/server/server.go → internal/server/server.go
	loc := resp.Locations[0]
	if loc.File != "internal/server/server.go" {
		t.Errorf("loc[0].File = %q, want %q", loc.File, "internal/server/server.go")
	}
	// LSP 0-based line=41 → API 1-based line=42
	if loc.Line != 42 {
		t.Errorf("loc[0].Line = %d, want %d", loc.Line, 42)
	}
	// LSP 0-based character=5 → API 1-based column=6
	if loc.Column != 6 {
		t.Errorf("loc[0].Column = %d, want %d", loc.Column, 6)
	}

	// 2つ目: file:///project/main.go → main.go
	loc = resp.Locations[1]
	if loc.File != "main.go" {
		t.Errorf("loc[1].File = %q, want %q", loc.File, "main.go")
	}
	// LSP 0-based line=0 → API 1-based line=1
	if loc.Line != 1 {
		t.Errorf("loc[1].Line = %d, want %d", loc.Line, 1)
	}
	// LSP 0-based character=0 → API 1-based column=1
	if loc.Column != 1 {
		t.Errorf("loc[1].Column = %d, want %d", loc.Column, 1)
	}
}

func TestLspDocumentSymbols(t *testing.T) {
	tests := []struct {
		name        string
		lspSvc      lsp.LSPService
		queryStr    string
		projectDir  string
		projDirErr  error
		wantStatus  int
		wantSymbols int
	}{
		{
			name: "正常: シンボル一覧を返す",
			lspSvc: &mockLSPService{
				available: true,
				symbols: []lsp.DocumentSymbol{
					{
						Name:   "Server",
						Kind:   lsp.SymbolKindStruct,
						Range:  lsp.Range{Start: lsp.Position{Line: 10}, End: lsp.Position{Line: 20}},
						Detail: "struct",
					},
					{
						Name:   "NewServer",
						Kind:   lsp.SymbolKindFunction,
						Range:  lsp.Range{Start: lsp.Position{Line: 22}, End: lsp.Position{Line: 50}},
					},
				},
			},
			queryStr:    "?file=server.go",
			projectDir:  "/project",
			wantStatus:  http.StatusOK,
			wantSymbols: 2,
		},
		{
			name:       "LSPが無効: 503を返す",
			lspSvc:     nil,
			queryStr:   "?file=server.go",
			projectDir: "/project",
			wantStatus: http.StatusServiceUnavailable,
		},
		{
			name: "fileパラメータなし: 400を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "",
			projectDir: "/project",
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "セッションが存在しない: 404を返す",
			lspSvc: &mockLSPService{
				available: true,
			},
			queryStr:   "?file=server.go",
			projDirErr: tmux.ErrSessionNotFound,
			wantStatus: http.StatusNotFound,
		},
		{
			name: "LSPエラー: 500を返す",
			lspSvc: &mockLSPService{
				available:  true,
				symbolsErr: errors.New("LSP request failed"),
			},
			queryStr:   "?file=server.go",
			projectDir: "/project",
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "シンボルが見つからない: 空配列を返す",
			lspSvc: &mockLSPService{
				available: true,
				symbols:   nil,
			},
			queryStr:    "?file=server.go",
			projectDir:  "/project",
			wantStatus:  http.StatusOK,
			wantSymbols: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := &configurableMock{
				projectDir:    tt.projectDir,
				projectDirErr: tt.projDirErr,
			}
			srv, token := newTestServerWithLSP(mock, tt.lspSvc)
			rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/lsp/document-symbols"+tt.queryStr, token, "")

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d; body = %s", rec.Code, tt.wantStatus, rec.Body.String())
			}

			if tt.wantStatus == http.StatusOK {
				var resp lspDocumentSymbolsResponse
				if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
					t.Fatalf("failed to decode response: %v", err)
				}

				if len(resp.Symbols) != tt.wantSymbols {
					t.Errorf("symbols count = %d, want %d", len(resp.Symbols), tt.wantSymbols)
				}
			}
		})
	}
}

func TestLspDocumentSymbols_SymbolConversion(t *testing.T) {
	lspMock := &mockLSPService{
		available: true,
		symbols: []lsp.DocumentSymbol{
			{
				Name:   "Server",
				Detail: "struct",
				Kind:   lsp.SymbolKindStruct,
				Range: lsp.Range{
					Start: lsp.Position{Line: 10},
					End:   lsp.Position{Line: 20},
				},
				Children: []lsp.DocumentSymbol{
					{
						Name: "handler",
						Kind: lsp.SymbolKindField,
						Range: lsp.Range{
							Start: lsp.Position{Line: 12},
							End:   lsp.Position{Line: 12},
						},
					},
				},
			},
			{
				Name: "NewServer",
				Kind: lsp.SymbolKindFunction,
				Range: lsp.Range{
					Start: lsp.Position{Line: 22},
					End:   lsp.Position{Line: 50},
				},
			},
		},
	}
	mock := &configurableMock{
		projectDir: "/project",
	}
	srv, token := newTestServerWithLSP(mock, lspMock)
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/sessions/main/lsp/document-symbols?file=server.go", token, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var resp lspDocumentSymbolsResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Symbols) != 2 {
		t.Fatalf("symbols count = %d, want 2", len(resp.Symbols))
	}

	// Server struct
	sym := resp.Symbols[0]
	if sym.Name != "Server" {
		t.Errorf("sym[0].Name = %q, want %q", sym.Name, "Server")
	}
	if sym.Detail != "struct" {
		t.Errorf("sym[0].Detail = %q, want %q", sym.Detail, "struct")
	}
	if sym.Kind != "struct" {
		t.Errorf("sym[0].Kind = %q, want %q", sym.Kind, "struct")
	}
	// line は 0-based → 1-based
	if sym.Line != 11 {
		t.Errorf("sym[0].Line = %d, want %d", sym.Line, 11)
	}
	if sym.EndLine != 21 {
		t.Errorf("sym[0].EndLine = %d, want %d", sym.EndLine, 21)
	}

	// Children
	if len(sym.Children) != 1 {
		t.Fatalf("sym[0].Children count = %d, want 1", len(sym.Children))
	}
	child := sym.Children[0]
	if child.Name != "handler" {
		t.Errorf("child.Name = %q, want %q", child.Name, "handler")
	}
	if child.Kind != "field" {
		t.Errorf("child.Kind = %q, want %q", child.Kind, "field")
	}

	// NewServer function
	sym = resp.Symbols[1]
	if sym.Name != "NewServer" {
		t.Errorf("sym[1].Name = %q, want %q", sym.Name, "NewServer")
	}
	if sym.Kind != "function" {
		t.Errorf("sym[1].Kind = %q, want %q", sym.Kind, "function")
	}
	if sym.Line != 23 {
		t.Errorf("sym[1].Line = %d, want %d", sym.Line, 23)
	}
	if sym.EndLine != 51 {
		t.Errorf("sym[1].EndLine = %d, want %d", sym.EndLine, 51)
	}
}

func TestSymbolKindName(t *testing.T) {
	tests := []struct {
		kind lsp.SymbolKind
		want string
	}{
		{lsp.SymbolKindFile, "file"},
		{lsp.SymbolKindModule, "module"},
		{lsp.SymbolKindNamespace, "namespace"},
		{lsp.SymbolKindPackage, "package"},
		{lsp.SymbolKindClass, "class"},
		{lsp.SymbolKindMethod, "method"},
		{lsp.SymbolKindProperty, "property"},
		{lsp.SymbolKindField, "field"},
		{lsp.SymbolKindConstructor, "constructor"},
		{lsp.SymbolKindEnum, "enum"},
		{lsp.SymbolKindInterface, "interface"},
		{lsp.SymbolKindFunction, "function"},
		{lsp.SymbolKindVariable, "variable"},
		{lsp.SymbolKindConstant, "constant"},
		{lsp.SymbolKindString, "string"},
		{lsp.SymbolKindNumber, "number"},
		{lsp.SymbolKindBoolean, "boolean"},
		{lsp.SymbolKindArray, "array"},
		{lsp.SymbolKindObject, "object"},
		{lsp.SymbolKindKey, "key"},
		{lsp.SymbolKindNull, "null"},
		{lsp.SymbolKindEnumMember, "enum_member"},
		{lsp.SymbolKindStruct, "struct"},
		{lsp.SymbolKindEvent, "event"},
		{lsp.SymbolKindOperator, "operator"},
		{lsp.SymbolKindTypeParameter, "type_parameter"},
		{lsp.SymbolKind(999), "unknown"},
	}

	for _, tt := range tests {
		got := symbolKindName(tt.kind)
		if got != tt.want {
			t.Errorf("symbolKindName(%d) = %q, want %q", tt.kind, got, tt.want)
		}
	}
}
