package lsp

import "context"

// LSPManager は server パッケージから使用される LSP マネージャーのインターフェース。
type LSPManager interface {
	GetServer(language, rootDir string) (*LanguageServer, error)
	Shutdown(ctx context.Context) error
	Status() []ServerInfo
}
