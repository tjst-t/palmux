package lsp

import (
	"context"
	"fmt"
	"sync"
)

// serverFactory はサーバーを作成する関数型。テストでの注入に使用する。
type serverFactory func(config ServerConfig, rootDir string) *LanguageServer

// Manager は複数の言語サーバーを管理する。
type Manager struct {
	servers   map[string]*LanguageServer // key: "language:rootDir"
	configs   []ServerConfig
	mu        sync.RWMutex
	newServer serverFactory
}

// NewManager は新しい Manager を作成する。
func NewManager(configs []ServerConfig) *Manager {
	return &Manager{
		servers:   make(map[string]*LanguageServer),
		configs:   configs,
		newServer: newLanguageServer,
	}
}

// serverKey はサーバーの一意なキーを生成する。
func serverKey(language, rootDir string) string {
	return language + ":" + rootDir
}

// findConfig は指定された言語の設定を検索する。
func (m *Manager) findConfig(language string) (ServerConfig, bool) {
	for _, c := range m.configs {
		if c.Language == language && c.Enabled {
			return c, true
		}
	}
	return ServerConfig{}, false
}

// GetServer は指定された言語とルートディレクトリの言語サーバーを返す。
// 既存のサーバーがあればそれを返し、なければ新たに起動する。
func (m *Manager) GetServer(language, rootDir string) (*LanguageServer, error) {
	key := serverKey(language, rootDir)

	// まず読み取りロックで既存サーバーを確認
	m.mu.RLock()
	if srv, ok := m.servers[key]; ok {
		m.mu.RUnlock()
		return srv, nil
	}
	m.mu.RUnlock()

	// 書き込みロックで再確認 + 新規作成
	m.mu.Lock()
	defer m.mu.Unlock()

	// 二重チェック
	if srv, ok := m.servers[key]; ok {
		return srv, nil
	}

	config, ok := m.findConfig(language)
	if !ok {
		return nil, fmt.Errorf("no server configured for language %q", language)
	}

	srv := m.newServer(config, rootDir)
	if err := srv.Start(context.Background()); err != nil {
		return nil, fmt.Errorf("start server for %q: %w", language, err)
	}

	m.servers[key] = srv
	return srv, nil
}

// Shutdown は全ての言語サーバーを停止する。
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var lastErr error
	for key, srv := range m.servers {
		if err := srv.Shutdown(ctx); err != nil {
			lastErr = fmt.Errorf("shutdown %s: %w", key, err)
		}
	}
	m.servers = make(map[string]*LanguageServer)
	return lastErr
}

// Status は全ての言語サーバーのステータスを返す。
func (m *Manager) Status() []ServerInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	infos := make([]ServerInfo, 0, len(m.servers))
	for _, srv := range m.servers {
		infos = append(infos, ServerInfo{
			Language: srv.language,
			Status:   srv.Status(),
			Server:   srv.config.Command,
			RootDir:  srv.rootDir,
		})
	}
	return infos
}
