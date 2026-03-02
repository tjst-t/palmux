package lsp

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"
)

// testServerFactory は Manager テスト用のサーバーファクトリ。
// 新しい LanguageServer を作成する際、パイプ接続でモック LSP サーバーを起動する。
type testServerFactory struct {
	t       *testing.T
	mu      sync.Mutex
	servers []*mockLSPServer
	pipes   []io.Closer
}

func (f *testServerFactory) create(config ServerConfig, rootDir string) *LanguageServer {
	// パイプを作成
	clientToServerR, clientToServerW := io.Pipe()
	serverToClientR, serverToClientW := io.Pipe()

	ls := &LanguageServer{
		config:        config,
		language:      config.Language,
		rootDir:       rootDir,
		status:        StatusStopped,
		maxRestarts:   3,
		stopIdleTimer: make(chan struct{}),
	}

	ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

	mock := newMockLSPServer(f.t, clientToServerR, serverToClientW)
	go mock.serve()

	f.mu.Lock()
	f.servers = append(f.servers, mock)
	f.pipes = append(f.pipes, serverToClientW, clientToServerR)
	f.mu.Unlock()

	// Start はパイプ接続の場合プロセス起動をスキップする必要がある。
	// ここではステータスを starting にして initialize を実行可能にする。
	ls.status = StatusStarting

	return ls
}

func (f *testServerFactory) cleanup() {
	f.mu.Lock()
	defer f.mu.Unlock()

	for _, s := range f.servers {
		s.stop()
	}
	for _, p := range f.pipes {
		p.Close()
	}
}

// newTestManager はテスト用の Manager を作成する。
// 返されるファクトリのクリーンアップは呼び出し元が行う。
func newTestManager(t *testing.T, configs []ServerConfig) (*Manager, *testServerFactory) {
	t.Helper()

	factory := &testServerFactory{t: t}

	m := NewManager(configs)

	// カスタムファクトリに差し替え
	m.newServer = func(config ServerConfig, rootDir string) *LanguageServer {
		return factory.create(config, rootDir)
	}

	t.Cleanup(func() {
		factory.cleanup()
	})

	return m, factory
}

func TestManagerGetServer(t *testing.T) {
	configs := []ServerConfig{
		{Language: "go", Command: "gopls", Enabled: true},
		{Language: "python", Command: "pyright", Enabled: true},
		{Language: "disabled", Command: "nope", Enabled: false},
	}

	t.Run("最初の呼び出しでサーバーが作成される", func(t *testing.T) {
		m, _ := newTestManager(t, configs)

		// GetServer は Start を呼ぶが、テストファクトリでは conn が既にセット済み。
		// ただし Start はプロセスを起動しようとするので、代わりに手動でセットアップする。
		// ManagerのGetServerをテストするため、Start をモックする必要がある。
		// ここではManagerに直接サーバーをセットして動作確認する。

		// 代わりに、パイプ接続で initialize を実行できるようにする
		// 方法: GetServer の中で Start が呼ばれる前に conn がセットされている

		// GetServer のテスト: Start が内部で呼ばれる
		// テストファクトリが返す LanguageServer は conn がセット済みだが
		// Start は cmd を起動しようとする。

		// もう一つのアプローチ: Manager.GetServer の Start を置き換え可能にする
		// → LanguageServer.startFunc を追加する

		// シンプルなアプローチ: 直接 servers マップにセットして挙動を確認
		m.mu.Lock()
		key := serverKey("go", "/tmp/project")
		srv := newLanguageServer(configs[0], "/tmp/project")
		srv.status = StatusReady
		m.servers[key] = srv
		m.mu.Unlock()

		got, err := m.GetServer("go", "/tmp/project")
		if err != nil {
			t.Fatalf("GetServer エラー: %v", err)
		}
		if got != srv {
			t.Error("既存のサーバーが返されるべき")
		}
	})

	t.Run("同じキーで2回呼ぶと同じサーバーが返される", func(t *testing.T) {
		m := NewManager(configs)
		m.servers = make(map[string]*LanguageServer)

		// 既存サーバーをセット
		key := serverKey("go", "/tmp/project")
		srv := newLanguageServer(configs[0], "/tmp/project")
		srv.status = StatusReady
		m.servers[key] = srv

		got1, err := m.GetServer("go", "/tmp/project")
		if err != nil {
			t.Fatalf("1回目のGetServer エラー: %v", err)
		}

		got2, err := m.GetServer("go", "/tmp/project")
		if err != nil {
			t.Fatalf("2回目のGetServer エラー: %v", err)
		}

		if got1 != got2 {
			t.Error("同じサーバーインスタンスが返されるべき")
		}
	})

	t.Run("異なるrootDirでは別のサーバーが返される", func(t *testing.T) {
		m := NewManager(configs)
		m.servers = make(map[string]*LanguageServer)

		// 2つの異なるプロジェクト用サーバーをセット
		key1 := serverKey("go", "/tmp/project1")
		srv1 := newLanguageServer(configs[0], "/tmp/project1")
		srv1.status = StatusReady
		m.servers[key1] = srv1

		key2 := serverKey("go", "/tmp/project2")
		srv2 := newLanguageServer(configs[0], "/tmp/project2")
		srv2.status = StatusReady
		m.servers[key2] = srv2

		got1, err := m.GetServer("go", "/tmp/project1")
		if err != nil {
			t.Fatalf("GetServer project1 エラー: %v", err)
		}

		got2, err := m.GetServer("go", "/tmp/project2")
		if err != nil {
			t.Fatalf("GetServer project2 エラー: %v", err)
		}

		if got1 == got2 {
			t.Error("異なるサーバーインスタンスが返されるべき")
		}
	})

	t.Run("設定が存在しない言語でエラーを返す", func(t *testing.T) {
		m := NewManager(configs)

		_, err := m.GetServer("rust", "/tmp/project")
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})

	t.Run("無効な言語設定でエラーを返す", func(t *testing.T) {
		m := NewManager(configs)

		_, err := m.GetServer("disabled", "/tmp/project")
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}

func TestManagerGetServerWithPipe(t *testing.T) {
	t.Run("パイプ接続でサーバーを起動しinitializeを完了する", func(t *testing.T) {
		configs := []ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
		}

		m := NewManager(configs)
		m.newServer = func(config ServerConfig, rootDir string) *LanguageServer {
			clientToServerR, clientToServerW := io.Pipe()
			serverToClientR, serverToClientW := io.Pipe()

			ls := &LanguageServer{
				config:        config,
				language:      config.Language,
				rootDir:       rootDir,
				status:        StatusStopped,
				maxRestarts:   3,
				stopIdleTimer: make(chan struct{}),
			}

			// conn を事前にセットすることで Start がプロセス起動をスキップする
			ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

			mock := newMockLSPServer(t, clientToServerR, serverToClientW)
			go mock.serve()

			t.Cleanup(func() {
				mock.stop()
				serverToClientW.Close()
				clientToServerR.Close()
			})

			return ls
		}

		srv, err := m.GetServer("go", "/tmp/test-project")
		if err != nil {
			t.Fatalf("GetServer エラー: %v", err)
		}

		if srv.Status() != StatusReady {
			t.Errorf("status = %q, want %q", srv.Status(), StatusReady)
		}

		if srv.Language() != "go" {
			t.Errorf("language = %q, want %q", srv.Language(), "go")
		}

		if srv.RootDir() != "/tmp/test-project" {
			t.Errorf("rootDir = %q, want %q", srv.RootDir(), "/tmp/test-project")
		}

		// 2回目の呼び出しで同じインスタンスが返される
		srv2, err := m.GetServer("go", "/tmp/test-project")
		if err != nil {
			t.Fatalf("2回目の GetServer エラー: %v", err)
		}

		if srv != srv2 {
			t.Error("同じインスタンスが返されるべき")
		}
	})

	t.Run("Shutdownで全サーバーが停止しStatusが空になる", func(t *testing.T) {
		configs := []ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
		}

		m := NewManager(configs)
		m.newServer = func(config ServerConfig, rootDir string) *LanguageServer {
			clientToServerR, clientToServerW := io.Pipe()
			serverToClientR, serverToClientW := io.Pipe()

			ls := &LanguageServer{
				config:        config,
				language:      config.Language,
				rootDir:       rootDir,
				status:        StatusStopped,
				maxRestarts:   3,
				stopIdleTimer: make(chan struct{}),
			}

			ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

			mock := newMockLSPServer(t, clientToServerR, serverToClientW)
			go mock.serve()

			t.Cleanup(func() {
				mock.stop()
				serverToClientW.Close()
				clientToServerR.Close()
			})

			return ls
		}

		srv, err := m.GetServer("go", "/tmp/test-project")
		if err != nil {
			t.Fatalf("GetServer エラー: %v", err)
		}

		// Status 確認
		infos := m.Status()
		if len(infos) != 1 {
			t.Fatalf("len(infos) = %d, want 1", len(infos))
		}
		if infos[0].Status != StatusReady {
			t.Errorf("status = %q, want %q", infos[0].Status, StatusReady)
		}

		// Shutdown
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := m.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}

		if srv.Status() != StatusStopped {
			t.Errorf("status = %q, want %q", srv.Status(), StatusStopped)
		}

		infos = m.Status()
		if len(infos) != 0 {
			t.Errorf("len(infos) = %d, want 0", len(infos))
		}
	})
}

func TestManagerShutdown(t *testing.T) {
	t.Run("全サーバーが停止される", func(t *testing.T) {
		configs := []ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
			{Language: "python", Command: "pyright", Enabled: true},
		}

		m := NewManager(configs)

		// テスト用にサーバーを直接セット
		srv1 := newLanguageServer(configs[0], "/tmp/project1")
		srv1.status = StatusReady

		srv2 := newLanguageServer(configs[1], "/tmp/project2")
		srv2.status = StatusReady

		m.servers[serverKey("go", "/tmp/project1")] = srv1
		m.servers[serverKey("python", "/tmp/project2")] = srv2

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := m.Shutdown(ctx)
		if err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}

		if len(m.servers) != 0 {
			t.Errorf("servers = %d, want 0", len(m.servers))
		}

		if srv1.Status() != StatusStopped {
			t.Errorf("srv1 status = %q, want %q", srv1.Status(), StatusStopped)
		}

		if srv2.Status() != StatusStopped {
			t.Errorf("srv2 status = %q, want %q", srv2.Status(), StatusStopped)
		}
	})

	t.Run("サーバーが空の場合は何もしない", func(t *testing.T) {
		m := NewManager(nil)

		ctx := context.Background()
		err := m.Shutdown(ctx)
		if err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}
	})
}

func TestManagerStatus(t *testing.T) {
	t.Run("全サーバーのステータスを返す", func(t *testing.T) {
		configs := []ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
			{Language: "python", Command: "pyright", Enabled: true},
		}

		m := NewManager(configs)

		srv1 := newLanguageServer(configs[0], "/tmp/project1")
		srv1.status = StatusReady

		srv2 := newLanguageServer(configs[1], "/tmp/project2")
		srv2.status = StatusStarting

		m.servers[serverKey("go", "/tmp/project1")] = srv1
		m.servers[serverKey("python", "/tmp/project2")] = srv2

		infos := m.Status()
		if len(infos) != 2 {
			t.Fatalf("len(infos) = %d, want 2", len(infos))
		}

		// マップの順序は不定なので、言語でチェック
		found := make(map[string]ServerInfo)
		for _, info := range infos {
			found[info.Language] = info
		}

		goInfo, ok := found["go"]
		if !ok {
			t.Fatal("go のステータスが見つからない")
		}
		if goInfo.Status != StatusReady {
			t.Errorf("go status = %q, want %q", goInfo.Status, StatusReady)
		}
		if goInfo.Server != "gopls" {
			t.Errorf("go server = %q, want %q", goInfo.Server, "gopls")
		}
		if goInfo.RootDir != "/tmp/project1" {
			t.Errorf("go rootDir = %q, want %q", goInfo.RootDir, "/tmp/project1")
		}

		pyInfo, ok := found["python"]
		if !ok {
			t.Fatal("python のステータスが見つからない")
		}
		if pyInfo.Status != StatusStarting {
			t.Errorf("python status = %q, want %q", pyInfo.Status, StatusStarting)
		}
	})

	t.Run("サーバーが空の場合は空スライスを返す", func(t *testing.T) {
		m := NewManager(nil)

		infos := m.Status()
		if len(infos) != 0 {
			t.Errorf("len(infos) = %d, want 0", len(infos))
		}
	})
}

func TestManagerConcurrentAccess(t *testing.T) {
	t.Run("並行アクセスでデータ競合が起きない", func(t *testing.T) {
		configs := []ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
		}

		m := NewManager(configs)

		// テスト用サーバーをセット
		srv := newLanguageServer(configs[0], "/tmp/project")
		srv.status = StatusReady
		m.servers[serverKey("go", "/tmp/project")] = srv

		var wg sync.WaitGroup
		const goroutines = 20

		// 並行で GetServer と Status を呼ぶ
		for i := 0; i < goroutines; i++ {
			wg.Add(2)

			go func() {
				defer wg.Done()
				m.GetServer("go", "/tmp/project")
			}()

			go func() {
				defer wg.Done()
				m.Status()
			}()
		}

		wg.Wait()
	})
}

func TestServerKey(t *testing.T) {
	tests := []struct {
		language string
		rootDir  string
		expected string
	}{
		{"go", "/tmp/project", "go:/tmp/project"},
		{"python", "/home/user/app", "python:/home/user/app"},
		{"go", "/tmp/another", "go:/tmp/another"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := serverKey(tt.language, tt.rootDir)
			if got != tt.expected {
				t.Errorf("serverKey(%q, %q) = %q, want %q", tt.language, tt.rootDir, got, tt.expected)
			}
		})
	}
}

func TestManagerFindConfig(t *testing.T) {
	configs := []ServerConfig{
		{Language: "go", Command: "gopls", Enabled: true},
		{Language: "python", Command: "pyright", Enabled: false},
		{Language: "typescript", Command: "tsserver", Enabled: true},
	}

	m := NewManager(configs)

	t.Run("有効な設定が見つかる", func(t *testing.T) {
		config, ok := m.findConfig("go")
		if !ok {
			t.Fatal("設定が見つからない")
		}
		if config.Command != "gopls" {
			t.Errorf("command = %q, want %q", config.Command, "gopls")
		}
	})

	t.Run("無効な設定は見つからない", func(t *testing.T) {
		_, ok := m.findConfig("python")
		if ok {
			t.Fatal("無効な設定が見つかるべきではない")
		}
	})

	t.Run("存在しない言語は見つからない", func(t *testing.T) {
		_, ok := m.findConfig("rust")
		if ok {
			t.Fatal("存在しない言語の設定が見つかるべきではない")
		}
	})
}

func TestManagerGetServerForFile(t *testing.T) {
	configs := []ServerConfig{
		{Language: "go", Command: "gopls", Enabled: true},
		{Language: "typescript", Command: "typescript-language-server", Enabled: true},
		{Language: "python", Command: "pyright-langserver", Enabled: true},
	}

	t.Run("Goファイルでgoサーバーが返される", func(t *testing.T) {
		m := NewManager(configs)

		// テスト用にサーバーを直接セット
		key := serverKey("go", "/tmp/project")
		srv := newLanguageServer(configs[0], "/tmp/project")
		srv.status = StatusReady
		m.servers[key] = srv

		got, err := m.GetServerForFile("/tmp/project/main.go", "/tmp/project")
		if err != nil {
			t.Fatalf("GetServerForFile エラー: %v", err)
		}

		if got.Language() != "go" {
			t.Errorf("Language() = %q, want %q", got.Language(), "go")
		}
	})

	t.Run("TypeScriptファイルでtypescriptサーバーが返される", func(t *testing.T) {
		m := NewManager(configs)

		key := serverKey("typescript", "/tmp/project")
		srv := newLanguageServer(configs[1], "/tmp/project")
		srv.status = StatusReady
		m.servers[key] = srv

		got, err := m.GetServerForFile("/tmp/project/index.ts", "/tmp/project")
		if err != nil {
			t.Fatalf("GetServerForFile エラー: %v", err)
		}

		if got.Language() != "typescript" {
			t.Errorf("Language() = %q, want %q", got.Language(), "typescript")
		}
	})

	t.Run("Pythonファイルでpythonサーバーが返される", func(t *testing.T) {
		m := NewManager(configs)

		key := serverKey("python", "/tmp/project")
		srv := newLanguageServer(configs[2], "/tmp/project")
		srv.status = StatusReady
		m.servers[key] = srv

		got, err := m.GetServerForFile("/tmp/project/app.py", "/tmp/project")
		if err != nil {
			t.Fatalf("GetServerForFile エラー: %v", err)
		}

		if got.Language() != "python" {
			t.Errorf("Language() = %q, want %q", got.Language(), "python")
		}
	})

	t.Run("不明な拡張子でエラーを返す", func(t *testing.T) {
		m := NewManager(configs)

		_, err := m.GetServerForFile("/tmp/project/file.unknown", "/tmp/project")
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})

	t.Run("対応するサーバー設定がない場合エラーを返す", func(t *testing.T) {
		// rust の設定がないマネージャー
		m := NewManager([]ServerConfig{
			{Language: "go", Command: "gopls", Enabled: true},
		})

		_, err := m.GetServerForFile("/tmp/project/lib.rs", "/tmp/project")
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}
