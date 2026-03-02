package lsp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// Service は LSPService インターフェースの実装。
// Manager を内部で使用し、ファイルの読み込みや DidOpen 通知を自動的に処理する。
type Service struct {
	manager *Manager
}

// NewService は新しい Service を作成する。
func NewService(configs []ServerConfig) *Service {
	return &Service{manager: NewManager(configs)}
}

// Available は LSP サービスが利用可能かどうかを返す。
func (s *Service) Available() bool {
	return s.manager != nil
}

// Status は全ての言語サーバーのステータスを返す。
func (s *Service) Status() []ServerInfo {
	return s.manager.Status()
}

// Definition は指定ファイル・位置のシンボル定義場所を返す。
// file は rootDir からの相対パス、line/col は 0-based。
func (s *Service) Definition(ctx context.Context, rootDir, file string, line, col int) ([]Location, error) {
	absPath := filepath.Join(rootDir, file)
	srv, err := s.manager.GetServerForFile(absPath, rootDir)
	if err != nil {
		return nil, err
	}

	// DidOpen でファイル内容を通知
	content, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	lang := LanguageForFile(file)
	if err := srv.DidOpen(ctx, absPath, lang, string(content)); err != nil {
		return nil, fmt.Errorf("didOpen: %w", err)
	}

	return srv.Definition(ctx, absPath, line, col)
}

// DocumentSymbols は指定ファイルの全シンボルを返す。
// file は rootDir からの相対パス。
func (s *Service) DocumentSymbols(ctx context.Context, rootDir, file string) ([]DocumentSymbol, error) {
	absPath := filepath.Join(rootDir, file)
	srv, err := s.manager.GetServerForFile(absPath, rootDir)
	if err != nil {
		return nil, err
	}

	// DidOpen でファイル内容を通知
	content, err := os.ReadFile(absPath)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	lang := LanguageForFile(file)
	if err := srv.DidOpen(ctx, absPath, lang, string(content)); err != nil {
		return nil, fmt.Errorf("didOpen: %w", err)
	}

	return srv.DocumentSymbols(ctx, absPath)
}

// Shutdown は全ての言語サーバーを停止する。
func (s *Service) Shutdown(ctx context.Context) error {
	return s.manager.Shutdown(ctx)
}
