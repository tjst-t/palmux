package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/textproto"
	"strconv"
	"sync"
	"testing"
	"time"
)

// mockServer はテスト用の疑似サーバー。
// io.Pipe() で接続された reader/writer を通じて JSON-RPC メッセージを送受信する。
type mockServer struct {
	reader *bufio.Reader
	tp     *textproto.Reader
	writer io.Writer
	mu     sync.Mutex
}

func newMockServer(reader io.Reader, writer io.Writer) *mockServer {
	br := bufio.NewReader(reader)
	return &mockServer{
		reader: br,
		tp:     textproto.NewReader(br),
		writer: writer,
	}
}

// readMessage はクライアントからの JSON-RPC メッセージを1つ読む。
func (s *mockServer) readMessage() (*jsonrpcMessage, error) {
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

// writeMessage はサーバーからのレスポンスを送信する。
func (s *mockServer) writeMessage(msg *jsonrpcMessage) error {
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

// respond はリクエストに対するレスポンスを送信する。
func (s *mockServer) respond(id *json.RawMessage, result interface{}) error {
	resultRaw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Result:  json.RawMessage(resultRaw),
	})
}

// respondError はリクエストに対するエラーレスポンスを送信する。
func (s *mockServer) respondError(id *json.RawMessage, code int, message string) error {
	return s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      id,
		Error: &jsonrpcError{
			Code:    code,
			Message: message,
		},
	})
}

// sendNotification はサーバーから通知を送信する。
func (s *mockServer) sendNotification(method string, params interface{}) error {
	paramsRaw, err := json.Marshal(params)
	if err != nil {
		return err
	}
	return s.writeMessage(&jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		Method:  method,
		Params:  json.RawMessage(paramsRaw),
	})
}

// setupTestConn はテスト用の JSON-RPC 接続とモックサーバーを作成する。
func setupTestConn(t *testing.T) (*jsonrpcConn, *mockServer) {
	t.Helper()

	// クライアント → サーバー
	clientToServerR, clientToServerW := io.Pipe()
	// サーバー → クライアント
	serverToClientR, serverToClientW := io.Pipe()

	conn := newJSONRPCConn(serverToClientR, clientToServerW, clientToServerW, serverToClientR)
	server := newMockServer(clientToServerR, serverToClientW)

	t.Cleanup(func() {
		conn.Close()
		serverToClientW.Close()
		clientToServerR.Close()
	})

	return conn, server
}

func TestContentLengthFraming(t *testing.T) {
	t.Run("メッセージにContent-Lengthヘッダーが付与される", func(t *testing.T) {
		conn, server := setupTestConn(t)

		// クライアントからリクエストを送信（応答を待たないようにgoroutineで）
		go func() {
			ctx := context.Background()
			conn.Notify(ctx, "test/method", map[string]string{"key": "value"})
		}()

		// サーバー側で受信
		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("メッセージ読み取りエラー: %v", err)
		}

		if msg.Method != "test/method" {
			t.Errorf("method = %q, want %q", msg.Method, "test/method")
		}
	})

	t.Run("マルチバイト文字を含むメッセージが正しくフレーミングされる", func(t *testing.T) {
		conn, server := setupTestConn(t)

		go func() {
			ctx := context.Background()
			conn.Notify(ctx, "test/method", map[string]string{"message": "日本語テスト"})
		}()

		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("メッセージ読み取りエラー: %v", err)
		}

		var params map[string]string
		if err := json.Unmarshal(msg.Params, &params); err != nil {
			t.Fatalf("params デコードエラー: %v", err)
		}

		if params["message"] != "日本語テスト" {
			t.Errorf("message = %q, want %q", params["message"], "日本語テスト")
		}
	})
}

func TestRequestResponse(t *testing.T) {
	t.Run("リクエストを送信しレスポンスを受信する", func(t *testing.T) {
		conn, server := setupTestConn(t)

		type testResult struct {
			Value string `json:"value"`
		}

		var result testResult
		errCh := make(chan error, 1)

		go func() {
			errCh <- conn.Request(context.Background(), "test/echo", map[string]string{"input": "hello"}, &result)
		}()

		// サーバー側でリクエストを読み、レスポンスを返す
		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("リクエスト読み取りエラー: %v", err)
		}

		if msg.Method != "test/echo" {
			t.Errorf("method = %q, want %q", msg.Method, "test/echo")
		}

		if msg.ID == nil {
			t.Fatal("リクエストに ID がない")
		}

		if err := server.respond(msg.ID, testResult{Value: "world"}); err != nil {
			t.Fatalf("レスポンス送信エラー: %v", err)
		}

		if err := <-errCh; err != nil {
			t.Fatalf("Request エラー: %v", err)
		}

		if result.Value != "world" {
			t.Errorf("result.Value = %q, want %q", result.Value, "world")
		}
	})

	t.Run("resultがnilでも正常に動作する", func(t *testing.T) {
		conn, server := setupTestConn(t)

		errCh := make(chan error, 1)

		go func() {
			errCh <- conn.Request(context.Background(), "test/void", nil, nil)
		}()

		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("リクエスト読み取りエラー: %v", err)
		}

		if err := server.respond(msg.ID, nil); err != nil {
			t.Fatalf("レスポンス送信エラー: %v", err)
		}

		if err := <-errCh; err != nil {
			t.Fatalf("Request エラー: %v", err)
		}
	})
}

func TestRequestIDIncrement(t *testing.T) {
	t.Run("リクエストIDが順番にインクリメントされる", func(t *testing.T) {
		conn, server := setupTestConn(t)

		ids := make([]int64, 3)
		var wg sync.WaitGroup

		// 3つのリクエストを順番に送信
		for i := 0; i < 3; i++ {
			wg.Add(1)
			go func(idx int) {
				defer wg.Done()
				conn.Request(context.Background(), "test/id", nil, nil)
			}(i)

			msg, err := server.readMessage()
			if err != nil {
				t.Fatalf("リクエスト読み取りエラー: %v", err)
			}

			var id int64
			if err := json.Unmarshal(*msg.ID, &id); err != nil {
				t.Fatalf("ID デコードエラー: %v", err)
			}
			ids[i] = id

			if err := server.respond(msg.ID, nil); err != nil {
				t.Fatalf("レスポンス送信エラー: %v", err)
			}
		}

		wg.Wait()

		// IDが順番に増加していることを確認
		for i := 1; i < len(ids); i++ {
			if ids[i] <= ids[i-1] {
				t.Errorf("ID[%d]=%d は ID[%d]=%d より大きくあるべき", i, ids[i], i-1, ids[i-1])
			}
		}
	})
}

func TestConcurrentRequests(t *testing.T) {
	t.Run("並行リクエストが正しくルーティングされる", func(t *testing.T) {
		conn, server := setupTestConn(t)

		type result struct {
			ID int `json:"id"`
		}

		const numRequests = 10
		results := make([]result, numRequests)
		errCh := make(chan error, numRequests)

		// 全リクエストを並行送信
		for i := 0; i < numRequests; i++ {
			go func(idx int) {
				errCh <- conn.Request(
					context.Background(),
					"test/concurrent",
					map[string]int{"index": idx},
					&results[idx],
				)
			}(i)
		}

		// サーバー側で全リクエストを読み、それぞれに応答
		// リクエストの到着順は不定なので、indexから対応付ける
		for i := 0; i < numRequests; i++ {
			msg, err := server.readMessage()
			if err != nil {
				t.Fatalf("リクエスト読み取りエラー: %v", err)
			}

			var params map[string]int
			if err := json.Unmarshal(msg.Params, &params); err != nil {
				t.Fatalf("params デコードエラー: %v", err)
			}

			// index をそのまま結果として返す
			if err := server.respond(msg.ID, result{ID: params["index"]}); err != nil {
				t.Fatalf("レスポンス送信エラー: %v", err)
			}
		}

		// 全リクエストの完了を待つ
		for i := 0; i < numRequests; i++ {
			if err := <-errCh; err != nil {
				t.Errorf("リクエスト %d エラー: %v", i, err)
			}
		}

		// 各レスポンスが正しいリクエストにルーティングされたか確認
		for i, r := range results {
			if r.ID != i {
				t.Errorf("results[%d].ID = %d, want %d", i, r.ID, i)
			}
		}
	})
}

func TestNotification(t *testing.T) {
	t.Run("通知にはIDがない", func(t *testing.T) {
		conn, server := setupTestConn(t)

		errCh := make(chan error, 1)
		go func() {
			errCh <- conn.Notify(context.Background(), "test/notify", map[string]string{"key": "val"})
		}()

		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("通知読み取りエラー: %v", err)
		}

		if msg.ID != nil {
			t.Error("通知にはIDがないべき")
		}

		if msg.Method != "test/notify" {
			t.Errorf("method = %q, want %q", msg.Method, "test/notify")
		}

		if err := <-errCh; err != nil {
			t.Fatalf("Notify エラー: %v", err)
		}
	})

	t.Run("サーバーからの通知をコールバックで受信する", func(t *testing.T) {
		conn, server := setupTestConn(t)

		receivedCh := make(chan struct{}, 1)
		var receivedMethod string
		var receivedParams json.RawMessage

		conn.onNotification = func(method string, params json.RawMessage) {
			receivedMethod = method
			receivedParams = params
			receivedCh <- struct{}{}
		}

		if err := server.sendNotification("window/logMessage", map[string]string{"message": "hello"}); err != nil {
			t.Fatalf("通知送信エラー: %v", err)
		}

		select {
		case <-receivedCh:
		case <-time.After(2 * time.Second):
			t.Fatal("通知を受信できなかった")
		}

		if receivedMethod != "window/logMessage" {
			t.Errorf("method = %q, want %q", receivedMethod, "window/logMessage")
		}

		var params map[string]string
		if err := json.Unmarshal(receivedParams, &params); err != nil {
			t.Fatalf("params デコードエラー: %v", err)
		}
		if params["message"] != "hello" {
			t.Errorf("message = %q, want %q", params["message"], "hello")
		}
	})
}

func TestErrorResponse(t *testing.T) {
	t.Run("エラーレスポンスがRPCErrorとして返される", func(t *testing.T) {
		conn, server := setupTestConn(t)

		errCh := make(chan error, 1)
		go func() {
			errCh <- conn.Request(context.Background(), "test/error", nil, nil)
		}()

		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("リクエスト読み取りエラー: %v", err)
		}

		if err := server.respondError(msg.ID, -32600, "Invalid Request"); err != nil {
			t.Fatalf("エラーレスポンス送信エラー: %v", err)
		}

		requestErr := <-errCh
		if requestErr == nil {
			t.Fatal("エラーが返るべき")
		}

		rpcErr, ok := requestErr.(*RPCError)
		if !ok {
			t.Fatalf("エラー型が *RPCError ではない: %T", requestErr)
		}

		if rpcErr.Code != -32600 {
			t.Errorf("code = %d, want %d", rpcErr.Code, -32600)
		}

		if rpcErr.Message != "Invalid Request" {
			t.Errorf("message = %q, want %q", rpcErr.Message, "Invalid Request")
		}
	})

	t.Run("RPCErrorのErrorメソッド", func(t *testing.T) {
		err := &RPCError{Code: -32601, Message: "Method not found"}
		expected := "jsonrpc error -32601: Method not found"
		if err.Error() != expected {
			t.Errorf("Error() = %q, want %q", err.Error(), expected)
		}
	})
}

func TestRequestCancellation(t *testing.T) {
	t.Run("コンテキストキャンセルで$/cancelRequestが送信される", func(t *testing.T) {
		conn, server := setupTestConn(t)

		ctx, cancel := context.WithCancel(context.Background())
		errCh := make(chan error, 1)

		go func() {
			errCh <- conn.Request(ctx, "test/slow", nil, nil)
		}()

		// リクエストを読む
		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("リクエスト読み取りエラー: %v", err)
		}

		if msg.Method != "test/slow" {
			t.Fatalf("method = %q, want %q", msg.Method, "test/slow")
		}

		// キャンセルする
		cancel()

		// キャンセルリクエストが送信されるのを待つ
		cancelMsg, err := server.readMessage()
		if err != nil {
			t.Fatalf("キャンセルリクエスト読み取りエラー: %v", err)
		}

		if cancelMsg.Method != "$/cancelRequest" {
			t.Errorf("method = %q, want %q", cancelMsg.Method, "$/cancelRequest")
		}

		// クライアント側ではcontext.Canceledが返る
		requestErr := <-errCh
		if requestErr != context.Canceled {
			t.Errorf("err = %v, want %v", requestErr, context.Canceled)
		}
	})
}

func TestConnectionClose(t *testing.T) {
	t.Run("接続が閉じられるとpendingリクエストがエラーになる", func(t *testing.T) {
		conn, server := setupTestConn(t)
		_ = server // サーバーは使わないが setup で作成

		errCh := make(chan error, 1)

		go func() {
			errCh <- conn.Request(context.Background(), "test/hang", nil, nil)
		}()

		// リクエストが送信されるのを少し待つ
		time.Sleep(50 * time.Millisecond)

		// 接続を閉じる
		conn.Close()

		err := <-errCh
		if err == nil {
			t.Fatal("エラーが返るべき")
		}
	})
}

func TestParamsNil(t *testing.T) {
	t.Run("paramsがnilの場合はparamsフィールドが省略される", func(t *testing.T) {
		conn, server := setupTestConn(t)

		go func() {
			conn.Notify(context.Background(), "test/noparams", nil)
		}()

		msg, err := server.readMessage()
		if err != nil {
			t.Fatalf("メッセージ読み取りエラー: %v", err)
		}

		if msg.Params != nil {
			t.Errorf("params = %s, want nil", string(msg.Params))
		}
	})
}
