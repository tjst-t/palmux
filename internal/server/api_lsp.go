package server

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/tjst-t/palmux/internal/lsp"
	"github.com/tjst-t/palmux/internal/tmux"
)

// --- レスポンス型 ---

// lspStatusResponse は GET /api/sessions/{session}/lsp/status のレスポンス。
type lspStatusResponse struct {
	Servers   []lsp.ServerInfo `json:"servers"`
	Available bool             `json:"available"`
}

// lspDefinitionResponse は GET /api/sessions/{session}/lsp/definition のレスポンス。
type lspDefinitionResponse struct {
	Locations []lspLocation `json:"locations"`
}

// lspLocation は定義場所を表すレスポンス型。
type lspLocation struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

// lspDocumentSymbolsResponse は GET /api/sessions/{session}/lsp/document-symbols のレスポンス。
type lspDocumentSymbolsResponse struct {
	Symbols []lspSymbol `json:"symbols"`
}

// lspSymbol はドキュメントシンボルを表すレスポンス型。
type lspSymbol struct {
	Name     string      `json:"name"`
	Detail   string      `json:"detail,omitempty"`
	Kind     string      `json:"kind"`
	Line     int         `json:"line"`
	EndLine  int         `json:"end_line"`
	Children []lspSymbol `json:"children,omitempty"`
}

// --- ハンドラ ---

// handleLspStatus は GET /api/sessions/{session}/lsp/status のハンドラ。
// LSP サービスの可用性と実行中のサーバー一覧を返す。
func (s *Server) handleLspStatus() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.lsp == nil {
			writeJSON(w, http.StatusOK, lspStatusResponse{
				Servers:   []lsp.ServerInfo{},
				Available: false,
			})
			return
		}

		servers := s.lsp.Status()
		if servers == nil {
			servers = []lsp.ServerInfo{}
		}

		writeJSON(w, http.StatusOK, lspStatusResponse{
			Servers:   servers,
			Available: s.lsp.Available(),
		})
	})
}

// handleLspDefinition は GET /api/sessions/{session}/lsp/definition のハンドラ。
// 指定ファイル・位置のシンボル定義場所を返す。
// クエリパラメータ: file (必須), line (必須, 1-based), col (必須, 1-based)
func (s *Server) handleLspDefinition() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.lsp == nil {
			writeError(w, http.StatusServiceUnavailable, "LSP not available")
			return
		}

		session := r.PathValue("session")

		rootDir, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		file := r.URL.Query().Get("file")
		if file == "" {
			writeError(w, http.StatusBadRequest, "file parameter is required")
			return
		}

		lineStr := r.URL.Query().Get("line")
		if lineStr == "" {
			writeError(w, http.StatusBadRequest, "line parameter is required")
			return
		}
		line, err := strconv.Atoi(lineStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "line must be a valid integer")
			return
		}

		colStr := r.URL.Query().Get("col")
		if colStr == "" {
			writeError(w, http.StatusBadRequest, "col parameter is required")
			return
		}
		col, err := strconv.Atoi(colStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "col must be a valid integer")
			return
		}

		// API は 1-based、LSP は 0-based なので変換
		lspLine := line - 1
		lspCol := col - 1

		locations, err := s.lsp.Definition(r.Context(), rootDir, file, lspLine, lspCol)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		resp := lspDefinitionResponse{
			Locations: convertLocations(locations, rootDir),
		}

		writeJSON(w, http.StatusOK, resp)
	})
}

// handleLspDocumentSymbols は GET /api/sessions/{session}/lsp/document-symbols のハンドラ。
// 指定ファイルの全シンボルを返す。
// クエリパラメータ: file (必須)
func (s *Server) handleLspDocumentSymbols() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.lsp == nil {
			writeError(w, http.StatusServiceUnavailable, "LSP not available")
			return
		}

		session := r.PathValue("session")

		rootDir, err := s.tmux.GetSessionProjectDir(session)
		if err != nil {
			if errors.Is(err, tmux.ErrSessionNotFound) {
				writeError(w, http.StatusNotFound, "session not found")
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		file := r.URL.Query().Get("file")
		if file == "" {
			writeError(w, http.StatusBadRequest, "file parameter is required")
			return
		}

		symbols, err := s.lsp.DocumentSymbols(r.Context(), rootDir, file)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		resp := lspDocumentSymbolsResponse{
			Symbols: convertSymbols(symbols),
		}

		writeJSON(w, http.StatusOK, resp)
	})
}

// --- ヘルパー ---

// convertLocations は LSP Location を API レスポンス用の lspLocation に変換する。
// URI はファイルパスに変換し、rootDir からの相対パスにする。
// line/col は 0-based → 1-based に変換する。
func convertLocations(locations []lsp.Location, rootDir string) []lspLocation {
	if locations == nil {
		return []lspLocation{}
	}

	result := make([]lspLocation, 0, len(locations))
	for _, loc := range locations {
		filePath := uriToFilePath(string(loc.URI))
		relPath := toRelativePath(filePath, rootDir)

		result = append(result, lspLocation{
			File:   relPath,
			Line:   loc.Range.Start.Line + 1,   // 0-based → 1-based
			Column: loc.Range.Start.Character + 1, // 0-based → 1-based
		})
	}

	return result
}

// convertSymbols は LSP DocumentSymbol を API レスポンス用の lspSymbol に変換する。
// line は 0-based → 1-based に変換する。
func convertSymbols(symbols []lsp.DocumentSymbol) []lspSymbol {
	if symbols == nil {
		return []lspSymbol{}
	}

	result := make([]lspSymbol, 0, len(symbols))
	for _, sym := range symbols {
		converted := lspSymbol{
			Name:    sym.Name,
			Detail:  sym.Detail,
			Kind:    symbolKindName(sym.Kind),
			Line:    sym.Range.Start.Line + 1, // 0-based → 1-based
			EndLine: sym.Range.End.Line + 1,   // 0-based → 1-based
		}

		if len(sym.Children) > 0 {
			converted.Children = convertSymbols(sym.Children)
		}

		result = append(result, converted)
	}

	return result
}

// uriToFilePath は file:// URI をファイルパスに変換する。
func uriToFilePath(uri string) string {
	if strings.HasPrefix(uri, "file://") {
		return uri[len("file://"):]
	}
	return uri
}

// toRelativePath はファイルパスを rootDir からの相対パスに変換する。
func toRelativePath(filePath, rootDir string) string {
	rel, err := filepath.Rel(rootDir, filePath)
	if err != nil {
		return filePath
	}
	return rel
}

// symbolKindName は SymbolKind 整数を人間可読な文字列に変換する。
func symbolKindName(kind lsp.SymbolKind) string {
	switch kind {
	case lsp.SymbolKindFile:
		return "file"
	case lsp.SymbolKindModule:
		return "module"
	case lsp.SymbolKindNamespace:
		return "namespace"
	case lsp.SymbolKindPackage:
		return "package"
	case lsp.SymbolKindClass:
		return "class"
	case lsp.SymbolKindMethod:
		return "method"
	case lsp.SymbolKindProperty:
		return "property"
	case lsp.SymbolKindField:
		return "field"
	case lsp.SymbolKindConstructor:
		return "constructor"
	case lsp.SymbolKindEnum:
		return "enum"
	case lsp.SymbolKindInterface:
		return "interface"
	case lsp.SymbolKindFunction:
		return "function"
	case lsp.SymbolKindVariable:
		return "variable"
	case lsp.SymbolKindConstant:
		return "constant"
	case lsp.SymbolKindString:
		return "string"
	case lsp.SymbolKindNumber:
		return "number"
	case lsp.SymbolKindBoolean:
		return "boolean"
	case lsp.SymbolKindArray:
		return "array"
	case lsp.SymbolKindObject:
		return "object"
	case lsp.SymbolKindKey:
		return "key"
	case lsp.SymbolKindNull:
		return "null"
	case lsp.SymbolKindEnumMember:
		return "enum_member"
	case lsp.SymbolKindStruct:
		return "struct"
	case lsp.SymbolKindEvent:
		return "event"
	case lsp.SymbolKindOperator:
		return "operator"
	case lsp.SymbolKindTypeParameter:
		return "type_parameter"
	default:
		return "unknown"
	}
}
