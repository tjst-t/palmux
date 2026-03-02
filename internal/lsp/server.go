package lsp

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// defaultIdleTimeout はデフォルトのアイドルタイムアウト（10分）。
const defaultIdleTimeout = 10 * time.Minute

// LanguageServer は言語サーバープロセスとの接続を管理する。
type LanguageServer struct {
	config   ServerConfig
	cmd      *exec.Cmd
	conn     *jsonrpcConn
	language string
	rootDir  string
	status   ServerStatus
	mu       sync.RWMutex

	// Lifecycle
	lastActivity      time.Time
	restartCount      int
	maxRestarts       int
	shutdownRequested bool
	stopIdleTimer     chan struct{} // アイドルタイマー停止用

	// Idle timeout
	idleTimeout time.Duration // 0 の場合はデフォルト値を使用
	onIdle      func()        // アイドルタイムアウト時のコールバック

	// サーバーケイパビリティ（initialize 後に設定される）
	capabilities *ServerCapabilities
}

// newLanguageServer は新しい LanguageServer を作成する。
func newLanguageServer(config ServerConfig, rootDir string) *LanguageServer {
	return &LanguageServer{
		config:        config,
		language:      config.Language,
		rootDir:       rootDir,
		status:        StatusStopped,
		maxRestarts:   3,
		idleTimeout:   defaultIdleTimeout,
		stopIdleTimer: make(chan struct{}),
	}
}

// getIdleTimeout はアイドルタイムアウトを返す。0 の場合はデフォルト値を返す。
func (ls *LanguageServer) getIdleTimeout() time.Duration {
	if ls.idleTimeout <= 0 {
		return defaultIdleTimeout
	}
	return ls.idleTimeout
}

// Start はサーバープロセスを起動し、Initialize ハンドシェイクを実行する。
// conn が事前に設定されている場合はプロセス起動をスキップする（テスト用）。
func (ls *LanguageServer) Start(ctx context.Context) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	ls.status = StatusStarting
	ls.lastActivity = time.Now()

	// conn が事前に設定されていない場合はプロセスを起動する
	if ls.conn == nil {
		cmd := exec.CommandContext(ctx, ls.config.Command, ls.config.Args...)
		cmd.Stderr = os.Stderr

		stdin, err := cmd.StdinPipe()
		if err != nil {
			ls.status = StatusError
			return fmt.Errorf("create stdin pipe: %w", err)
		}

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			ls.status = StatusError
			return fmt.Errorf("create stdout pipe: %w", err)
		}

		if err := cmd.Start(); err != nil {
			ls.status = StatusError
			return fmt.Errorf("start server: %w", err)
		}

		ls.cmd = cmd
		ls.conn = newJSONRPCConn(stdout, stdin, stdin, stdout)
	}

	// Initialize ハンドシェイク
	if err := ls.initialize(ctx); err != nil {
		ls.status = StatusError
		if ls.cmd != nil && ls.cmd.Process != nil {
			ls.cmd.Process.Kill()
		}
		ls.conn.Close()
		return fmt.Errorf("initialize: %w", err)
	}

	ls.status = StatusReady

	// アイドルタイマーを起動
	go ls.idleChecker()

	// プロセス監視を起動（実プロセスの場合のみ）
	if ls.cmd != nil {
		go ls.processMonitor()
	}

	return nil
}

// initialize は LSP の Initialize ハンドシェイクを実行する。
func (ls *LanguageServer) initialize(ctx context.Context) error {
	params := InitializeParams{
		ProcessID: os.Getpid(),
		RootURI:   URI("file://" + ls.rootDir),
		Capabilities: ClientCapabilities{
			TextDocument: &TextDocumentClientCapabilities{
				Hover: &HoverClientCapabilities{
					ContentFormat: []MarkupKind{MarkupKindMarkdown, MarkupKindPlainText},
				},
				Definition: &DefinitionClientCapabilities{
					LinkSupport: true,
				},
				DocumentSymbol: &DocumentSymbolClientCapabilities{
					HierarchicalDocumentSymbolSupport: true,
				},
			},
		},
	}

	var result InitializeResult
	if err := ls.conn.Request(ctx, "initialize", params, &result); err != nil {
		return fmt.Errorf("initialize request: %w", err)
	}

	ls.capabilities = &result.Capabilities

	// initialized 通知を送信
	if err := ls.conn.Notify(ctx, "initialized", struct{}{}); err != nil {
		return fmt.Errorf("initialized notification: %w", err)
	}

	return nil
}

// Shutdown はサーバーをグレースフルにシャットダウンする。
func (ls *LanguageServer) Shutdown(ctx context.Context) error {
	ls.mu.Lock()

	if ls.status == StatusStopped {
		ls.mu.Unlock()
		return nil
	}

	ls.shutdownRequested = true

	// アイドルタイマーを停止
	select {
	case <-ls.stopIdleTimer:
		// already closed
	default:
		close(ls.stopIdleTimer)
	}

	// ロックを解放してから conn 操作（conn.Request はブロックする可能性がある）
	conn := ls.conn
	ls.mu.Unlock()

	if conn != nil {
		// shutdown リクエストを送信（失敗してもプロセス終了は試みる）
		_ = conn.Request(ctx, "shutdown", nil, nil)

		// exit 通知を送信
		_ = conn.Notify(ctx, "exit", nil)

		conn.Close()
	}

	ls.mu.Lock()
	defer ls.mu.Unlock()

	// プロセスの終了を待つ（タイムアウト付き）
	if ls.cmd != nil && ls.cmd.Process != nil {
		done := make(chan error, 1)
		go func() {
			done <- ls.cmd.Wait()
		}()

		select {
		case <-done:
			// 正常終了
		case <-time.After(5 * time.Second):
			// タイムアウト → kill
			ls.cmd.Process.Kill()
			<-done
		case <-ctx.Done():
			ls.cmd.Process.Kill()
			<-done
			return ctx.Err()
		}
	}

	ls.status = StatusStopped
	return nil
}

// Status はサーバーの現在のステータスを返す。
func (ls *LanguageServer) Status() ServerStatus {
	ls.mu.RLock()
	defer ls.mu.RUnlock()
	return ls.status
}

// Request は言語サーバーにリクエストを送信する。
func (ls *LanguageServer) Request(ctx context.Context, method string, params, result interface{}) error {
	ls.mu.RLock()
	if ls.status != StatusReady {
		ls.mu.RUnlock()
		return fmt.Errorf("server not ready: status=%s", ls.status)
	}
	conn := ls.conn
	ls.mu.RUnlock()

	ls.mu.Lock()
	ls.lastActivity = time.Now()
	ls.mu.Unlock()

	return conn.Request(ctx, method, params, result)
}

// Notify は言語サーバーに通知を送信する。
func (ls *LanguageServer) Notify(ctx context.Context, method string, params interface{}) error {
	ls.mu.RLock()
	if ls.status != StatusReady {
		ls.mu.RUnlock()
		return fmt.Errorf("server not ready: status=%s", ls.status)
	}
	conn := ls.conn
	ls.mu.RUnlock()

	ls.mu.Lock()
	ls.lastActivity = time.Now()
	ls.mu.Unlock()

	return conn.Notify(ctx, method, params)
}

// Language はサーバーの言語名を返す。
func (ls *LanguageServer) Language() string {
	return ls.language
}

// RootDir はサーバーのルートディレクトリを返す。
func (ls *LanguageServer) RootDir() string {
	return ls.rootDir
}

// Capabilities はサーバーのケイパビリティを返す。
func (ls *LanguageServer) Capabilities() *ServerCapabilities {
	ls.mu.RLock()
	defer ls.mu.RUnlock()
	return ls.capabilities
}

// idleChecker はアイドルタイムアウトを定期的にチェックするゴルーチン。
// lastActivity から idleTimeout が経過したら Shutdown を呼ぶ。
func (ls *LanguageServer) idleChecker() {
	timeout := ls.getIdleTimeout()
	// チェック間隔はタイムアウトの 1/4（ただし最小 50ms）
	interval := timeout / 4
	if interval < 50*time.Millisecond {
		interval = 50 * time.Millisecond
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ls.stopIdleTimer:
			return
		case <-ticker.C:
			ls.mu.RLock()
			elapsed := time.Since(ls.lastActivity)
			status := ls.status
			ls.mu.RUnlock()

			if status != StatusReady {
				return
			}

			if elapsed >= timeout {
				// アイドルタイムアウト → シャットダウン
				ls.Shutdown(context.Background())
				if ls.onIdle != nil {
					ls.onIdle()
				}
				return
			}
		}
	}
}

// processMonitor はプロセスの異常終了を検出し、自動再起動するゴルーチン。
func (ls *LanguageServer) processMonitor() {
	if ls.cmd == nil {
		return
	}

	err := ls.cmd.Wait()

	ls.mu.RLock()
	shutdownRequested := ls.shutdownRequested
	ls.mu.RUnlock()

	if shutdownRequested {
		// 意図的なシャットダウンの場合は何もしない
		return
	}

	// 予期しないクラッシュ
	_ = err // プロセス終了のエラーは記録のみ

	ls.mu.Lock()
	if ls.restartCount >= ls.maxRestarts {
		ls.status = StatusError
		ls.mu.Unlock()
		return
	}

	restartCount := ls.restartCount
	ls.restartCount++
	ls.status = StatusStarting
	ls.mu.Unlock()

	// 指数バックオフ（テスト用に上限を設ける: 最大 30 秒）
	backoff := time.Duration(1<<uint(restartCount)) * time.Second
	const maxBackoff = 30 * time.Second
	if backoff > maxBackoff {
		backoff = maxBackoff
	}

	select {
	case <-time.After(backoff):
	case <-ls.stopIdleTimer:
		return
	}

	// 再起動
	ls.mu.Lock()
	if ls.shutdownRequested {
		ls.mu.Unlock()
		return
	}

	// 古い conn をクリーンアップ
	if ls.conn != nil {
		ls.conn.Close()
		ls.conn = nil
	}
	ls.cmd = nil
	ls.mu.Unlock()

	// Start を再実行（新しいプロセスを起動）
	if err := ls.Start(context.Background()); err != nil {
		ls.mu.Lock()
		ls.status = StatusError
		ls.mu.Unlock()
	}
}

// fileToURI はファイルパスを file:// URI に変換する。
func fileToURI(path string) URI {
	return URI("file://" + path)
}

// uriToFile は file:// URI をファイルパスに変換する。
func uriToFile(uri URI) string {
	s := string(uri)
	if strings.HasPrefix(s, "file://") {
		return s[len("file://"):]
	}
	return s
}

// Definition は指定位置のシンボルの定義場所を返す。
func (ls *LanguageServer) Definition(ctx context.Context, file string, line, col int) ([]Location, error) {
	params := TextDocumentPositionParams{
		TextDocument: TextDocumentIdentifier{
			URI: fileToURI(file),
		},
		Position: Position{
			Line:      line,
			Character: col,
		},
	}

	var locations []Location
	if err := ls.Request(ctx, "textDocument/definition", params, &locations); err != nil {
		return nil, fmt.Errorf("textDocument/definition: %w", err)
	}

	return locations, nil
}

// DocumentSymbols は指定ドキュメントの全シンボルを返す。
func (ls *LanguageServer) DocumentSymbols(ctx context.Context, file string) ([]DocumentSymbol, error) {
	params := struct {
		TextDocument TextDocumentIdentifier `json:"textDocument"`
	}{
		TextDocument: TextDocumentIdentifier{
			URI: fileToURI(file),
		},
	}

	var symbols []DocumentSymbol
	if err := ls.Request(ctx, "textDocument/documentSymbol", params, &symbols); err != nil {
		return nil, fmt.Errorf("textDocument/documentSymbol: %w", err)
	}

	return symbols, nil
}

// DidOpen はドキュメントが開かれたことをサーバーに通知する。
func (ls *LanguageServer) DidOpen(ctx context.Context, file, languageID, content string) error {
	params := DidOpenTextDocumentParams{
		TextDocument: TextDocumentItem{
			URI:        fileToURI(file),
			LanguageID: languageID,
			Version:    1,
			Text:       content,
		},
	}

	if err := ls.Notify(ctx, "textDocument/didOpen", params); err != nil {
		return fmt.Errorf("textDocument/didOpen: %w", err)
	}

	return nil
}

// DidClose はドキュメントが閉じられたことをサーバーに通知する。
func (ls *LanguageServer) DidClose(ctx context.Context, file string) error {
	params := DidCloseTextDocumentParams{
		TextDocument: TextDocumentIdentifier{
			URI: fileToURI(file),
		},
	}

	if err := ls.Notify(ctx, "textDocument/didClose", params); err != nil {
		return fmt.Errorf("textDocument/didClose: %w", err)
	}

	return nil
}
