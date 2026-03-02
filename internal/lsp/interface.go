package lsp

import "context"

// LSPManager は server パッケージから使用される LSP マネージャーのインターフェース。
type LSPManager interface {
	GetServer(language, rootDir string) (*LanguageServer, error)
	GetServerForFile(filePath, rootDir string) (*LanguageServer, error)
	Shutdown(ctx context.Context) error
	Status() []ServerInfo
}

// LSPService は HTTP ハンドラから使用する LSP サービスのインターフェース。
// LSPManager よりも高レベルな API を提供し、テスタビリティを向上させる。
type LSPService interface {
	// Available は LSP サービスが利用可能かどうかを返す。
	Available() bool

	// Status は全ての言語サーバーのステータスを返す。
	Status() []ServerInfo

	// Definition は指定ファイル・位置のシンボル定義場所を返す。
	// file は rootDir からの相対パス、line/col は 0-based。
	Definition(ctx context.Context, rootDir, file string, line, col int) ([]Location, error)

	// DocumentSymbols は指定ファイルの全シンボルを返す。
	// file は rootDir からの相対パス。
	DocumentSymbols(ctx context.Context, rootDir, file string) ([]DocumentSymbol, error)

	// Shutdown は全ての言語サーバーを停止する。
	Shutdown(ctx context.Context) error
}
