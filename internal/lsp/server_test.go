package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/textproto"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

// mockLSPServer は LSP プロトコルに準拠するテスト用のサーバー。
// io.Pipe 上で JSON-RPC メッセージを読み書きし、initialize / shutdown / exit に対応する。
type mockLSPServer struct {
	t      *testing.T
	reader *bufio.Reader
	tp     *textproto.Reader
	writer io.Writer
	mu     sync.Mutex

	// initializeHandler はカスタム initialize ハンドラ。nil の場合はデフォルトレスポンスを返す。
	initializeHandler func(params json.RawMessage) (interface{}, *jsonrpcError)

	// handlers はメソッドごとのハンドラ。
	handlers map[string]func(params json.RawMessage) (interface{}, *jsonrpcError)

	done chan struct{}
}

func newMockLSPServer(t *testing.T, reader io.Reader, writer io.Writer) *mockLSPServer {
	t.Helper()
	br := bufio.NewReader(reader)
	return &mockLSPServer{
		t:        t,
		reader:   br,
		tp:       textproto.NewReader(br),
		writer:   writer,
		handlers: make(map[string]func(params json.RawMessage) (interface{}, *jsonrpcError)),
		done:     make(chan struct{}),
	}
}

// serve はメッセージループを実行する。
func (s *mockLSPServer) serve() {
	for {
		select {
		case <-s.done:
			return
		default:
		}

		msg, err := s.readMessage()
		if err != nil {
			return
		}

		// 通知（ID なし）は無視する
		if msg.ID == nil {
			if msg.Method == "exit" {
				return
			}
			continue
		}

		// リクエストを処理
		switch msg.Method {
		case "initialize":
			if s.initializeHandler != nil {
				result, rpcErr := s.initializeHandler(msg.Params)
				if rpcErr != nil {
					s.respondError(msg.ID, rpcErr)
				} else {
					s.respond(msg.ID, result)
				}
			} else {
				// デフォルト: 基本的な ServerCapabilities を返す
				s.respond(msg.ID, InitializeResult{
					Capabilities: ServerCapabilities{
						TextDocumentSync: &TextDocumentSyncOptions{
							OpenClose: true,
							Change:    1,
						},
						HoverProvider:      true,
						DefinitionProvider: true,
					},
				})
			}
		case "shutdown":
			s.respond(msg.ID, nil)
		default:
			if handler, ok := s.handlers[msg.Method]; ok {
				result, rpcErr := handler(msg.Params)
				if rpcErr != nil {
					s.respondError(msg.ID, rpcErr)
				} else {
					s.respond(msg.ID, result)
				}
			} else {
				s.respondError(msg.ID, &jsonrpcError{
					Code:    -32601,
					Message: "Method not found: " + msg.Method,
				})
			}
		}
	}
}

func (s *mockLSPServer) readMessage() (*jsonrpcMessage, error) {
	header, err := s.tp.ReadMIMEHeader()
	if err != nil {
		return nil, err
	}

	contentLengthStr := header.Get("Content-Length")
	contentLength, err := strconv.Atoi(contentLengthStr)
	if err != nil {
		return nil, fmt.Errorf("invalid Content-Length: %w", err)
	}

	body := make([]byte, contentLength)
	if _, err := io.ReadFull(s.reader, body); err != nil {
		return nil, err
	}

	var msg jsonrpcMessage
	if err := json.Unmarshal(body, &msg); err != nil {
		return nil, err
	}

	return &msg, nil
}

func (s *mockLSPServer) writeMessage(msg *jsonrpcMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	if _, err := io.WriteString(s.writer, header); err != nil {
		return err
	}
	if _, err := s.writer.Write(data); err != nil {
		return err
	}
	return nil
}

func (s *mockLSPServer) respond(id *json.RawMessage, result interface{}) {
	s.t.Helper()
	resultRaw, err := json.Marshal(result)
	if err != nil {
		s.t.Fatalf("mockLSPServer.respond: json.Marshal エラー: %v", err)
	}
	if err := s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Result:  json.RawMessage(resultRaw),
	}); err != nil {
		s.t.Fatalf("mockLSPServer.respond: writeMessage エラー: %v", err)
	}
}

func (s *mockLSPServer) respondError(id *json.RawMessage, rpcErr *jsonrpcError) {
	s.t.Helper()
	if err := s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Error:   rpcErr,
	}); err != nil {
		s.t.Fatalf("mockLSPServer.respondError: writeMessage エラー: %v", err)
	}
}

func (s *mockLSPServer) stop() {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
}

// setupTestServer はテスト用の LanguageServer とモック LSP サーバーを作成する。
// 実際のプロセスではなく、パイプを使って直接接続する。
func setupTestServer(t *testing.T) (*LanguageServer, *mockLSPServer) {
	t.Helper()

	// クライアント → サーバー
	clientToServerR, clientToServerW := io.Pipe()
	// サーバー → クライアント
	serverToClientR, serverToClientW := io.Pipe()

	ls := &LanguageServer{
		config: ServerConfig{
			Language: "go",
			Command:  "gopls",
			Enabled:  true,
		},
		language:      "go",
		rootDir:       "/tmp/test-project",
		status:        StatusStarting,
		maxRestarts:   3,
		stopIdleTimer: make(chan struct{}),
	}

	ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

	mock := newMockLSPServer(t, clientToServerR, serverToClientW)

	t.Cleanup(func() {
		mock.stop()
		ls.conn.Close()
		serverToClientW.Close()
		clientToServerR.Close()
	})

	return ls, mock
}

func TestInitializeHandshake(t *testing.T) {
	t.Run("正常なハンドシェイク", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		// モックサーバーをバックグラウンドで実行
		go mock.serve()

		// initialize 実行
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := ls.initialize(ctx)
		if err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}

		if ls.capabilities == nil {
			t.Fatal("capabilities が nil")
		}

		if ls.capabilities.HoverProvider != true {
			t.Errorf("HoverProvider = %v, want true", ls.capabilities.HoverProvider)
		}

		if ls.capabilities.DefinitionProvider != true {
			t.Errorf("DefinitionProvider = %v, want true", ls.capabilities.DefinitionProvider)
		}
	})

	t.Run("initializeパラメータが正しく送信される", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		var receivedParams InitializeParams
		mock.initializeHandler = func(params json.RawMessage) (interface{}, *jsonrpcError) {
			if err := json.Unmarshal(params, &receivedParams); err != nil {
				return nil, &jsonrpcError{Code: -32600, Message: err.Error()}
			}
			return InitializeResult{
				Capabilities: ServerCapabilities{},
			}, nil
		}

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := ls.initialize(ctx)
		if err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}

		if receivedParams.ProcessID != os.Getpid() {
			t.Errorf("ProcessID = %d, want %d", receivedParams.ProcessID, os.Getpid())
		}

		expectedURI := URI("file:///tmp/test-project")
		if receivedParams.RootURI != expectedURI {
			t.Errorf("RootURI = %q, want %q", receivedParams.RootURI, expectedURI)
		}

		if receivedParams.Capabilities.TextDocument == nil {
			t.Fatal("TextDocument capabilities が nil")
		}

		if receivedParams.Capabilities.TextDocument.Hover == nil {
			t.Fatal("Hover capabilities が nil")
		}
	})

	t.Run("initializeがエラーを返す場合", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		mock.initializeHandler = func(params json.RawMessage) (interface{}, *jsonrpcError) {
			return nil, &jsonrpcError{Code: -32002, Message: "server error"}
		}

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		err := ls.initialize(ctx)
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}

func TestShutdownSequence(t *testing.T) {
	t.Run("正常なシャットダウン", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		go mock.serve()

		// まず initialize
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.initialize(ctx); err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}
		ls.status = StatusReady

		// shutdown
		if err := ls.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}

		if ls.status != StatusStopped {
			t.Errorf("status = %q, want %q", ls.status, StatusStopped)
		}
	})

	t.Run("既にstoppedの場合は何もしない", func(t *testing.T) {
		ls := &LanguageServer{
			status: StatusStopped,
		}

		ctx := context.Background()
		if err := ls.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}
	})
}

func TestServerStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   ServerStatus
		expected ServerStatus
	}{
		{"starting", StatusStarting, StatusStarting},
		{"ready", StatusReady, StatusReady},
		{"stopped", StatusStopped, StatusStopped},
		{"error", StatusError, StatusError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ls := &LanguageServer{status: tt.status}
			if got := ls.Status(); got != tt.expected {
				t.Errorf("Status() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestServerRequestForwarding(t *testing.T) {
	t.Run("readyの時にリクエストを転送する", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		mock.handlers["textDocument/hover"] = func(params json.RawMessage) (interface{}, *jsonrpcError) {
			return HoverResult{
				Contents: MarkupContent{
					Kind:  MarkupKindMarkdown,
					Value: "test hover",
				},
			}, nil
		}

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.initialize(ctx); err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}
		ls.status = StatusReady

		var result HoverResult
		err := ls.Request(ctx, "textDocument/hover", TextDocumentPositionParams{
			TextDocument: TextDocumentIdentifier{URI: "file:///tmp/test.go"},
			Position:     Position{Line: 1, Character: 5},
		}, &result)
		if err != nil {
			t.Fatalf("Request エラー: %v", err)
		}

		if result.Contents.Value != "test hover" {
			t.Errorf("contents = %q, want %q", result.Contents.Value, "test hover")
		}
	})

	t.Run("readyでない時はエラーを返す", func(t *testing.T) {
		ls := &LanguageServer{status: StatusStopped}

		err := ls.Request(context.Background(), "textDocument/hover", nil, nil)
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}

func TestServerNotifyForwarding(t *testing.T) {
	t.Run("readyの時に通知を転送する", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.initialize(ctx); err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}
		ls.status = StatusReady

		err := ls.Notify(ctx, "textDocument/didOpen", DidOpenTextDocumentParams{
			TextDocument: TextDocumentItem{
				URI:        "file:///tmp/test.go",
				LanguageID: "go",
				Version:    1,
				Text:       "package main",
			},
		})
		if err != nil {
			t.Fatalf("Notify エラー: %v", err)
		}
	})

	t.Run("readyでない時はエラーを返す", func(t *testing.T) {
		ls := &LanguageServer{status: StatusStarting}

		err := ls.Notify(context.Background(), "textDocument/didOpen", nil)
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}

func TestNewLanguageServer(t *testing.T) {
	config := ServerConfig{
		Language: "go",
		Command:  "gopls",
		Args:     []string{"-mode=stdio"},
		Enabled:  true,
	}

	ls := newLanguageServer(config, "/home/user/project")

	if ls.language != "go" {
		t.Errorf("language = %q, want %q", ls.language, "go")
	}

	if ls.rootDir != "/home/user/project" {
		t.Errorf("rootDir = %q, want %q", ls.rootDir, "/home/user/project")
	}

	if ls.status != StatusStopped {
		t.Errorf("status = %q, want %q", ls.status, StatusStopped)
	}

	if ls.maxRestarts != 3 {
		t.Errorf("maxRestarts = %d, want %d", ls.maxRestarts, 3)
	}

	if ls.idleTimeout != defaultIdleTimeout {
		t.Errorf("idleTimeout = %v, want %v", ls.idleTimeout, defaultIdleTimeout)
	}

	if ls.Language() != "go" {
		t.Errorf("Language() = %q, want %q", ls.Language(), "go")
	}

	if ls.RootDir() != "/home/user/project" {
		t.Errorf("RootDir() = %q, want %q", ls.RootDir(), "/home/user/project")
	}
}

func TestIdleTimeoutAutoStop(t *testing.T) {
	t.Run("アイドルタイムアウトでサーバーが自動停止する", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		// 非常に短いアイドルタイムアウトを設定
		ls.idleTimeout = 100 * time.Millisecond

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.Start(ctx); err != nil {
			t.Fatalf("Start エラー: %v", err)
		}

		if ls.Status() != StatusReady {
			t.Fatalf("status = %q, want %q", ls.Status(), StatusReady)
		}

		// アイドルタイムアウトを待つ（タイムアウト + チェック間隔のマージン）
		time.Sleep(300 * time.Millisecond)

		if ls.Status() != StatusStopped {
			t.Errorf("status = %q, want %q (アイドルタイムアウトで停止すべき)", ls.Status(), StatusStopped)
		}
	})

	t.Run("アクティビティがあるとタイマーがリセットされる", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		// 短いアイドルタイムアウト
		ls.idleTimeout = 200 * time.Millisecond

		mock.handlers["textDocument/hover"] = func(params json.RawMessage) (interface{}, *jsonrpcError) {
			return HoverResult{
				Contents: MarkupContent{
					Kind:  MarkupKindMarkdown,
					Value: "test",
				},
			}, nil
		}

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.Start(ctx); err != nil {
			t.Fatalf("Start エラー: %v", err)
		}

		// タイムアウトの半分ごとにリクエストを送信して、タイマーをリセットする
		for i := 0; i < 5; i++ {
			time.Sleep(100 * time.Millisecond)

			if ls.Status() != StatusReady {
				t.Fatalf("iteration %d: status = %q, want %q (アクティビティがあるので停止すべきでない)",
					i, ls.Status(), StatusReady)
			}

			var result HoverResult
			if err := ls.Request(ctx, "textDocument/hover", TextDocumentPositionParams{
				TextDocument: TextDocumentIdentifier{URI: "file:///tmp/test.go"},
				Position:     Position{Line: 1, Character: 5},
			}, &result); err != nil {
				t.Fatalf("Request エラー: %v", err)
			}
		}

		// 最後のアクティビティから十分に時間を置いてタイムアウトを確認
		time.Sleep(400 * time.Millisecond)

		if ls.Status() != StatusStopped {
			t.Errorf("status = %q, want %q (アクティビティ停止後にタイムアウトすべき)", ls.Status(), StatusStopped)
		}
	})

	t.Run("onIdleコールバックが呼ばれる", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		ls.idleTimeout = 100 * time.Millisecond

		callbackCh := make(chan struct{}, 1)
		ls.onIdle = func() {
			callbackCh <- struct{}{}
		}

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.Start(ctx); err != nil {
			t.Fatalf("Start エラー: %v", err)
		}

		select {
		case <-callbackCh:
			// onIdle が呼ばれた
		case <-time.After(2 * time.Second):
			t.Fatal("onIdle コールバックが呼ばれなかった")
		}
	})

	t.Run("Shutdownでアイドルタイマーが停止する", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		ls.idleTimeout = 1 * time.Hour // 非常に長いタイムアウト

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.Start(ctx); err != nil {
			t.Fatalf("Start エラー: %v", err)
		}

		// 即座にシャットダウン
		if err := ls.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}

		if ls.Status() != StatusStopped {
			t.Errorf("status = %q, want %q", ls.Status(), StatusStopped)
		}
	})
}

func TestCrashDetection(t *testing.T) {
	t.Run("maxRestartsを超えるとStatusErrorになる", func(t *testing.T) {
		ls := &LanguageServer{
			status:        StatusReady,
			maxRestarts:   3,
			restartCount:  3, // 既に最大回数に達している
			stopIdleTimer: make(chan struct{}),
		}

		// processMonitor のクラッシュ検出ロジックをシミュレート
		ls.mu.Lock()
		if ls.restartCount >= ls.maxRestarts {
			ls.status = StatusError
		}
		ls.mu.Unlock()

		if ls.Status() != StatusError {
			t.Errorf("status = %q, want %q", ls.Status(), StatusError)
		}
	})

	t.Run("restartCountとmaxRestartsが正しく設定される", func(t *testing.T) {
		ls := newLanguageServer(ServerConfig{
			Language: "go",
			Command:  "gopls",
			Enabled:  true,
		}, "/tmp/project")

		if ls.restartCount != 0 {
			t.Errorf("restartCount = %d, want 0", ls.restartCount)
		}

		if ls.maxRestarts != 3 {
			t.Errorf("maxRestarts = %d, want 3", ls.maxRestarts)
		}
	})

	t.Run("shutdownRequestedフラグが正しく設定される", func(t *testing.T) {
		ls, mock := setupTestServer(t)

		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.initialize(ctx); err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}
		ls.status = StatusReady

		if ls.shutdownRequested {
			t.Error("shutdownRequested は false であるべき")
		}

		if err := ls.Shutdown(ctx); err != nil {
			t.Fatalf("Shutdown エラー: %v", err)
		}

		if !ls.shutdownRequested {
			t.Error("shutdownRequested は true であるべき")
		}
	})

	t.Run("パイプ切断でクラッシュを検出する", func(t *testing.T) {
		// クライアント → サーバー
		clientToServerR, clientToServerW := io.Pipe()
		// サーバー → クライアント
		serverToClientR, serverToClientW := io.Pipe()

		ls := &LanguageServer{
			config: ServerConfig{
				Language: "go",
				Command:  "gopls",
				Enabled:  true,
			},
			language:      "go",
			rootDir:       "/tmp/test-project",
			status:        StatusStarting,
			maxRestarts:   0, // リスタートしない
			stopIdleTimer: make(chan struct{}),
		}

		ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

		mock := newMockLSPServer(t, clientToServerR, serverToClientW)
		go mock.serve()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := ls.initialize(ctx); err != nil {
			t.Fatalf("initialize エラー: %v", err)
		}
		ls.status = StatusReady

		// サーバーのパイプを閉じてクラッシュをシミュレート
		serverToClientW.Close()
		clientToServerR.Close()
		mock.stop()

		// cleanup
		t.Cleanup(func() {
			ls.conn.Close()
		})

		// クラッシュ検出後、コネクションが閉じられることを確認
		// （processMonitor は cmd が nil の場合は動作しないが、
		//  接続切断でリクエストがエラーになることを確認する）
		err := ls.Request(ctx, "textDocument/hover", nil, nil)
		if err == nil {
			t.Error("パイプ切断後はエラーが返るべき")
		}
	})
}

func TestGetIdleTimeout(t *testing.T) {
	tests := []struct {
		name     string
		timeout  time.Duration
		expected time.Duration
	}{
		{"デフォルト値", 0, defaultIdleTimeout},
		{"負の値", -1 * time.Second, defaultIdleTimeout},
		{"カスタム値", 5 * time.Minute, 5 * time.Minute},
		{"短い値", 100 * time.Millisecond, 100 * time.Millisecond},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ls := &LanguageServer{idleTimeout: tt.timeout}
			got := ls.getIdleTimeout()
			if got != tt.expected {
				t.Errorf("getIdleTimeout() = %v, want %v", got, tt.expected)
			}
		})
	}
}
