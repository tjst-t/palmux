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
	"sync/atomic"
)

// jsonrpcVersion は JSON-RPC のバージョン。
const jsonrpcVersion = "2.0"

// jsonrpcMessage は JSON-RPC 2.0 メッセージの汎用構造。
// Request, Response, Notification を同じ構造体で扱う。
type jsonrpcMessage struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id,omitempty"`
	Method  string           `json:"method,omitempty"`
	Params  json.RawMessage  `json:"params,omitempty"`
	Result  json.RawMessage  `json:"result,omitempty"`
	Error   *jsonrpcError    `json:"error,omitempty"`
}

// jsonrpcError は JSON-RPC 2.0 のエラーオブジェクト。
type jsonrpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Error は jsonrpcError を error インターフェースに適合させる。
func (e *jsonrpcError) Error() string {
	return fmt.Sprintf("jsonrpc error %d: %s", e.Code, e.Message)
}

// RPCError は JSON-RPC のエラーレスポンスを表す公開型。
type RPCError struct {
	Code    int
	Message string
}

// Error は RPCError を error インターフェースに適合させる。
func (e *RPCError) Error() string {
	return fmt.Sprintf("jsonrpc error %d: %s", e.Code, e.Message)
}

// pendingRequest は応答待ちのリクエストを表す。
type pendingRequest struct {
	result chan *jsonrpcMessage
}

// jsonrpcConn は JSON-RPC 2.0 over stdio の接続を表す。
type jsonrpcConn struct {
	writer io.Writer
	reader io.Reader

	// closers は Close 時に閉じるリソース。
	closers []io.Closer

	writeMu sync.Mutex
	nextID  atomic.Int64

	pendingMu sync.Mutex
	pending   map[int64]*pendingRequest

	// onNotification はサーバーからの通知を受け取るコールバック。
	onNotification func(method string, params json.RawMessage)

	done      chan struct{}
	closeOnce sync.Once
}

// newJSONRPCConn は新しい JSON-RPC 接続を作成する。
// reader はサーバーの stdout、writer はサーバーの stdin に接続する。
// closers は Close 時に閉じるリソース（stdin, stdout 等）。
func newJSONRPCConn(reader io.Reader, writer io.Writer, closers ...io.Closer) *jsonrpcConn {
	c := &jsonrpcConn{
		writer:  writer,
		reader:  reader,
		closers: closers,
		pending: make(map[int64]*pendingRequest),
		done:    make(chan struct{}),
	}
	go c.readLoop()
	return c
}

// Request は JSON-RPC リクエストを送信し、レスポンスを待つ。
// result が nil の場合、レスポンスの result フィールドは破棄される。
func (c *jsonrpcConn) Request(ctx context.Context, method string, params, result interface{}) error {
	id := c.nextID.Add(1)

	paramsRaw, err := marshalParams(params)
	if err != nil {
		return fmt.Errorf("marshal params: %w", err)
	}

	idRaw := json.RawMessage(strconv.FormatInt(id, 10))
	msg := &jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		ID:      &idRaw,
		Method:  method,
		Params:  paramsRaw,
	}

	pending := &pendingRequest{
		result: make(chan *jsonrpcMessage, 1),
	}

	c.pendingMu.Lock()
	c.pending[id] = pending
	c.pendingMu.Unlock()

	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
	}()

	if err := c.writeMessage(msg); err != nil {
		return fmt.Errorf("write request: %w", err)
	}

	select {
	case <-ctx.Done():
		// キャンセル時は $/cancelRequest を送信する
		_ = c.Notify(context.Background(), "$/cancelRequest", map[string]int64{"id": id})
		return ctx.Err()
	case resp, ok := <-pending.result:
		if !ok {
			return fmt.Errorf("connection closed")
		}
		if resp.Error != nil {
			return &RPCError{
				Code:    resp.Error.Code,
				Message: resp.Error.Message,
			}
		}
		if result != nil && resp.Result != nil {
			if err := json.Unmarshal(resp.Result, result); err != nil {
				return fmt.Errorf("unmarshal result: %w", err)
			}
		}
		return nil
	case <-c.done:
		return fmt.Errorf("connection closed")
	}
}

// Notify は JSON-RPC 通知（レスポンスを期待しない）を送信する。
func (c *jsonrpcConn) Notify(ctx context.Context, method string, params interface{}) error {
	paramsRaw, err := marshalParams(params)
	if err != nil {
		return fmt.Errorf("marshal params: %w", err)
	}

	msg := &jsonrpcMessage{
		JSONRPC: jsonrpcVersion,
		Method:  method,
		Params:  paramsRaw,
	}

	if err := c.writeMessage(msg); err != nil {
		return fmt.Errorf("write notification: %w", err)
	}

	return nil
}

// Close は接続を閉じる。
func (c *jsonrpcConn) Close() {
	c.closeOnce.Do(func() {
		close(c.done)

		// 全ての pending リクエストのチャネルを閉じる
		c.pendingMu.Lock()
		for _, p := range c.pending {
			close(p.result)
		}
		c.pending = make(map[int64]*pendingRequest)
		c.pendingMu.Unlock()

		// 基盤のリソースを閉じる（パイプ書き込みのブロックを解放する）
		for _, closer := range c.closers {
			closer.Close()
		}
	})
}

// writeMessage は Content-Length ヘッダー付きで JSON-RPC メッセージを書き込む。
func (c *jsonrpcConn) writeMessage(msg *jsonrpcMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	if _, err := io.WriteString(c.writer, header); err != nil {
		return fmt.Errorf("write header: %w", err)
	}
	if _, err := c.writer.Write(data); err != nil {
		return fmt.Errorf("write body: %w", err)
	}

	return nil
}

// readLoop はサーバーからのメッセージを読み続け、対応する pending リクエストにルーティングする。
func (c *jsonrpcConn) readLoop() {
	reader := bufio.NewReader(c.reader)
	tp := textproto.NewReader(reader)

	for {
		select {
		case <-c.done:
			return
		default:
		}

		// MIME ヘッダーを読む（Content-Length: N）
		header, err := tp.ReadMIMEHeader()
		if err != nil {
			// EOF や接続断はループ終了
			c.Close()
			return
		}

		contentLengthStr := header.Get("Content-Length")
		if contentLengthStr == "" {
			continue
		}

		contentLength, err := strconv.Atoi(contentLengthStr)
		if err != nil {
			continue
		}

		// ボディを読む
		body := make([]byte, contentLength)
		if _, err := io.ReadFull(reader, body); err != nil {
			c.Close()
			return
		}

		var msg jsonrpcMessage
		if err := json.Unmarshal(body, &msg); err != nil {
			continue
		}

		// レスポンス（ID あり、Method なし）→ pending リクエストにルーティング
		if msg.ID != nil && msg.Method == "" {
			var id int64
			if err := json.Unmarshal(*msg.ID, &id); err != nil {
				continue
			}

			c.pendingMu.Lock()
			p, ok := c.pending[id]
			c.pendingMu.Unlock()
			if ok {
				select {
				case p.result <- &msg:
				default:
				}
			}
			continue
		}

		// 通知（ID なし、Method あり）→ コールバック
		if msg.ID == nil && msg.Method != "" {
			if c.onNotification != nil {
				c.onNotification(msg.Method, msg.Params)
			}
			continue
		}

		// サーバーからのリクエスト（ID あり、Method あり）は現在未対応
	}
}

// marshalParams は params を json.RawMessage に変換する。
// nil の場合は nil を返す。
func marshalParams(params interface{}) (json.RawMessage, error) {
	if params == nil {
		return nil, nil
	}
	data, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}
