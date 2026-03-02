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

func newMockLSPServer(reader io.Reader, writer io.Writer) *mockLSPServer {
	br := bufio.NewReader(reader)
	return &mockLSPServer{
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
	resultRaw, _ := json.Marshal(result)
	s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Result:  json.RawMessage(resultRaw),
	})
}

func (s *mockLSPServer) respondError(id *json.RawMessage, rpcErr *jsonrpcError) {
	s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Error:   rpcErr,
	})
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
		language:    "go",
		rootDir:     "/tmp/test-project",
		status:      StatusStarting,
		maxRestarts: 3,
	}

	ls.conn = newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)

	mock := newMockLSPServer(clientToServerR, serverToClientW)

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

	if ls.Language() != "go" {
		t.Errorf("Language() = %q, want %q", ls.Language(), "go")
	}

	if ls.RootDir() != "/home/user/project" {
		t.Errorf("RootDir() = %q, want %q", ls.RootDir(), "/home/user/project")
	}
}
