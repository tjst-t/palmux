package lsp

// LSP プロトコルの型定義（最小限）。
// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/

// URI はドキュメントの URI を表す。
type URI string

// Position はテキストドキュメント内の位置を表す。
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// Range はテキストドキュメント内の範囲を表す。
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Location はテキストドキュメント内の位置（URI + Range）を表す。
type Location struct {
	URI   URI   `json:"uri"`
	Range Range `json:"range"`
}

// TextDocumentIdentifier はテキストドキュメントの識別子を表す。
type TextDocumentIdentifier struct {
	URI URI `json:"uri"`
}

// TextDocumentItem はテキストドキュメントの内容を表す。
type TextDocumentItem struct {
	URI        URI    `json:"uri"`
	LanguageID string `json:"languageId"`
	Version    int    `json:"version"`
	Text       string `json:"text"`
}

// TextDocumentPositionParams はテキストドキュメント内の位置パラメータ。
type TextDocumentPositionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

// DidOpenTextDocumentParams は textDocument/didOpen の通知パラメータ。
type DidOpenTextDocumentParams struct {
	TextDocument TextDocumentItem `json:"textDocument"`
}

// DidCloseTextDocumentParams は textDocument/didClose の通知パラメータ。
type DidCloseTextDocumentParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// SymbolKind はシンボルの種類を表す。
type SymbolKind int

const (
	SymbolKindFile          SymbolKind = 1
	SymbolKindModule        SymbolKind = 2
	SymbolKindNamespace     SymbolKind = 3
	SymbolKindPackage       SymbolKind = 4
	SymbolKindClass         SymbolKind = 5
	SymbolKindMethod        SymbolKind = 6
	SymbolKindProperty      SymbolKind = 7
	SymbolKindField         SymbolKind = 8
	SymbolKindConstructor   SymbolKind = 9
	SymbolKindEnum          SymbolKind = 10
	SymbolKindInterface     SymbolKind = 11
	SymbolKindFunction      SymbolKind = 12
	SymbolKindVariable      SymbolKind = 13
	SymbolKindConstant      SymbolKind = 14
	SymbolKindString        SymbolKind = 15
	SymbolKindNumber        SymbolKind = 16
	SymbolKindBoolean       SymbolKind = 17
	SymbolKindArray         SymbolKind = 18
	SymbolKindObject        SymbolKind = 19
	SymbolKindKey           SymbolKind = 20
	SymbolKindNull          SymbolKind = 21
	SymbolKindEnumMember    SymbolKind = 22
	SymbolKindStruct        SymbolKind = 23
	SymbolKindEvent         SymbolKind = 24
	SymbolKindOperator      SymbolKind = 25
	SymbolKindTypeParameter SymbolKind = 26
)

// DocumentSymbol はドキュメント内のシンボルを表す。
type DocumentSymbol struct {
	Name           string           `json:"name"`
	Detail         string           `json:"detail,omitempty"`
	Kind           SymbolKind       `json:"kind"`
	Range          Range            `json:"range"`
	SelectionRange Range            `json:"selectionRange"`
	Children       []DocumentSymbol `json:"children,omitempty"`
}

// MarkupKind はマークアップの種類を表す。
type MarkupKind string

const (
	MarkupKindPlainText MarkupKind = "plaintext"
	MarkupKindMarkdown  MarkupKind = "markdown"
)

// MarkupContent はマークアップコンテンツを表す。
type MarkupContent struct {
	Kind  MarkupKind `json:"kind"`
	Value string     `json:"value"`
}

// HoverResult は textDocument/hover の結果を表す。
type HoverResult struct {
	Contents MarkupContent `json:"contents"`
	Range    *Range        `json:"range,omitempty"`
}

// InitializeParams は initialize リクエストのパラメータ。
type InitializeParams struct {
	ProcessID    int                `json:"processId"`
	RootURI      URI                `json:"rootUri"`
	Capabilities ClientCapabilities `json:"capabilities"`
}

// ClientCapabilities はクライアントのケイパビリティ。
type ClientCapabilities struct {
	TextDocument *TextDocumentClientCapabilities `json:"textDocument,omitempty"`
}

// TextDocumentClientCapabilities はテキストドキュメントのクライアントケイパビリティ。
type TextDocumentClientCapabilities struct {
	Hover          *HoverClientCapabilities          `json:"hover,omitempty"`
	Definition     *DefinitionClientCapabilities     `json:"definition,omitempty"`
	DocumentSymbol *DocumentSymbolClientCapabilities `json:"documentSymbol,omitempty"`
}

// HoverClientCapabilities は hover のクライアントケイパビリティ。
type HoverClientCapabilities struct {
	ContentFormat []MarkupKind `json:"contentFormat,omitempty"`
}

// DefinitionClientCapabilities は definition のクライアントケイパビリティ。
type DefinitionClientCapabilities struct {
	LinkSupport bool `json:"linkSupport,omitempty"`
}

// DocumentSymbolClientCapabilities は documentSymbol のクライアントケイパビリティ。
type DocumentSymbolClientCapabilities struct {
	HierarchicalDocumentSymbolSupport bool `json:"hierarchicalDocumentSymbolSupport,omitempty"`
}

// InitializeResult は initialize リクエストの結果。
type InitializeResult struct {
	Capabilities ServerCapabilities `json:"capabilities"`
	ServerInfo   *ServerInfoLSP     `json:"serverInfo,omitempty"`
}

// ServerInfoLSP はサーバー情報（LSP プロトコルの serverInfo フィールド）。
// ServerInfo と名前が衝突するため LSP サフィックスを付与。
type ServerInfoLSP struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

// ServerCapabilities はサーバーのケイパビリティ。
type ServerCapabilities struct {
	TextDocumentSync       *TextDocumentSyncOptions `json:"textDocumentSync,omitempty"`
	HoverProvider          interface{}              `json:"hoverProvider,omitempty"`
	DefinitionProvider     interface{}              `json:"definitionProvider,omitempty"`
	DocumentSymbolProvider interface{}              `json:"documentSymbolProvider,omitempty"`
}

// TextDocumentSyncOptions はテキストドキュメント同期のオプション。
type TextDocumentSyncOptions struct {
	OpenClose bool `json:"openClose,omitempty"`
	Change    int  `json:"change,omitempty"` // 0=None, 1=Full, 2=Incremental
}
