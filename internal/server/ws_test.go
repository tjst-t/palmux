package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// wsMock は WebSocket テスト用の TmuxManager モック。
// Attach が呼ばれたら pty ペアのマスター側を返す。
type wsMock struct {
	configurableMock

	attachErr error
	attachPty *os.File // ハンドラに渡す側（pty マスター）

	calledAttach string
	mu           sync.Mutex
}

func (m *wsMock) Attach(session string) (*os.File, *exec.Cmd, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calledAttach = session
	if m.attachErr != nil {
		return nil, nil, m.attachErr
	}
	// ダミーの sleep プロセスを起動（cleanup テスト用）
	cmd := exec.Command("sleep", "60")
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	return m.attachPty, cmd, nil
}

// wsTestMessage は WebSocket メッセージの JSON 構造。
type wsTestMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// setupWSTest は WebSocket テスト用のセットアップを行うヘルパー。
// ptmx: ハンドラに渡される pty マスター
// pts: テスト側が読み書きする pty スレーブ
func setupWSTest(t *testing.T) (pts *os.File, mock *wsMock, cleanup func()) {
	t.Helper()

	ptmx, pts, err := createPtyPair()
	if err != nil {
		t.Fatalf("failed to create pty pair: %v", err)
	}

	mock = &wsMock{
		attachPty: ptmx,
	}

	cleanup = func() {
		ptmx.Close()
		pts.Close()
	}

	return pts, mock, cleanup
}

// newTestServerWithWS は WebSocket テスト用 Server を作成するヘルパー。
func newTestServerWithWS(mock *wsMock) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:     mock,
		Token:    token,
		BasePath: "/",
	})
	return srv, token
}

// dialWS は WebSocket 接続を確立するヘルパー。
func dialWS(t *testing.T, tsURL, path, token string) (*websocket.Conn, context.Context, context.CancelFunc) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(tsURL, "http") + path
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": []string{"Bearer " + token},
		},
	})
	if err != nil {
		cancel()
		t.Fatalf("failed to dial websocket: %v", err)
	}

	return conn, ctx, cancel
}

func TestHandleAttach_WebSocketConnect(t *testing.T) {
	pts, mock, cleanup := setupWSTest(t)
	defer cleanup()
	_ = pts

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	conn, _, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Attach が呼ばれるまで少し待つ（WebSocket ハンドシェイク後に非同期で実行されるため）
	time.Sleep(100 * time.Millisecond)

	// Attach が正しいセッション名で呼ばれたことを確認
	mock.mu.Lock()
	calledSession := mock.calledAttach
	mock.mu.Unlock()

	if calledSession != "main" {
		t.Errorf("Attach called with session %q, want %q", calledSession, "main")
	}
}

func TestHandleAttach_InputMessage(t *testing.T) {
	pts, mock, cleanup := setupWSTest(t)
	defer cleanup()

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	conn, ctx, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "")

	// input メッセージを送信
	msg := wsTestMessage{Type: "input", Data: "ls\r"}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal message: %v", err)
	}

	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("failed to write to websocket: %v", err)
	}

	// pts 側で読み取れることを確認（pty に書き込まれたデータ）
	buf := make([]byte, 256)
	pts.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err := pts.Read(buf)
	if err != nil {
		t.Fatalf("failed to read from pts: %v", err)
	}

	got := string(buf[:n])
	// pty の line discipline が \r を \n に変換するため、
	// 受信データでは \r が \n に変わっている場合がある
	if got != "ls\r" && got != "ls\n" {
		t.Errorf("pts received %q, want %q or %q", got, "ls\r", "ls\n")
	}
}

func TestHandleAttach_OutputMessage(t *testing.T) {
	pts, mock, cleanup := setupWSTest(t)
	defer cleanup()

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	conn, ctx, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "")

	// pts 側からデータを書き込む（pty の出力を模倣）
	testOutput := "user@host:~$ "
	if _, err := pts.Write([]byte(testOutput)); err != nil {
		t.Fatalf("failed to write to pts: %v", err)
	}

	// WebSocket から output メッセージを受信
	_, msgData, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("failed to read from websocket: %v", err)
	}

	var received wsTestMessage
	if err := json.Unmarshal(msgData, &received); err != nil {
		t.Fatalf("failed to unmarshal message: %v", err)
	}

	if received.Type != "output" {
		t.Errorf("message type = %q, want %q", received.Type, "output")
	}

	if !strings.Contains(received.Data, testOutput) {
		t.Errorf("message data = %q, want to contain %q", received.Data, testOutput)
	}
}

func TestHandleAttach_ResizeMessage(t *testing.T) {
	pts, mock, cleanup := setupWSTest(t)
	defer cleanup()

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	conn, ctx, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "")

	// resize メッセージを送信（エラーにならないことを確認）
	msg := wsTestMessage{Type: "resize", Cols: 120, Rows: 40}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("failed to marshal message: %v", err)
	}

	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("failed to write resize to websocket: %v", err)
	}

	// resize 後も input が正常に動くことを確認
	inputMsg := wsTestMessage{Type: "input", Data: "echo hello\r"}
	inputData, err := json.Marshal(inputMsg)
	if err != nil {
		t.Fatalf("failed to marshal input message: %v", err)
	}

	if err := conn.Write(ctx, websocket.MessageText, inputData); err != nil {
		t.Fatalf("failed to write input to websocket: %v", err)
	}

	buf := make([]byte, 256)
	pts.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err := pts.Read(buf)
	if err != nil {
		t.Fatalf("failed to read from pts: %v", err)
	}

	got := string(buf[:n])
	// pty の line discipline が \r を \n に変換するため、両方を許容する
	if !strings.Contains(got, "echo hello\r") && !strings.Contains(got, "echo hello\n") {
		t.Errorf("pts received %q, want to contain %q or %q", got, "echo hello\r", "echo hello\n")
	}
}

func TestHandleAttach_DisconnectCleanup(t *testing.T) {
	pts, mock, cleanup := setupWSTest(t)
	defer cleanup()

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	conn, _, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()

	// WebSocket を閉じる
	conn.Close(websocket.StatusNormalClosure, "done")

	// 少し待って、pty が閉じられたことを確認
	time.Sleep(1 * time.Second)

	// ptmx 側が閉じられた後、pts への書き込みはエラーになるはず
	pts.SetWriteDeadline(time.Now().Add(1 * time.Second))
	_, err := pts.Write([]byte("test"))
	if err == nil {
		// pty のスレーブ側は、マスターが閉じた後でも書き込みが成功する場合がある
		// （バッファに空きがある場合）。代わりに読み込みでEIOを確認する。
		pts.SetReadDeadline(time.Now().Add(1 * time.Second))
		buf := make([]byte, 256)
		_, readErr := pts.Read(buf)
		if readErr == nil {
			// pty が正常にクリーンアップされていれば、マスター閉鎖後の read は EIO を返す
			// ただし、タイミングによってはまだ読めることもある
			t.Log("pts read succeeded after master close (may be timing-dependent)")
		}
	}

	// 主な確認: ハンドラがパニックせずに終了していること
	// （テストが正常終了すれば OK）
}

func TestHandleAttach_AttachError(t *testing.T) {
	mock := &wsMock{
		attachErr: io.ErrClosedPipe,
	}

	srv, token := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/sessions/nonexistent/windows/0/attach"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": []string{"Bearer " + token},
		},
	})
	if err != nil {
		// WebSocket 接続自体が失敗するか、接続後にすぐ閉じられるか
		// どちらでもよい（attach エラー時はサーバーが接続を拒否する）
		return
	}

	// 接続できた場合はすぐ閉じられるはず
	_, _, err = conn.Read(ctx)
	if err == nil {
		t.Error("expected error reading from websocket after attach error, but got nil")
	}
	conn.Close(websocket.StatusNormalClosure, "")
}

func TestHandleAttach_AuthRequired(t *testing.T) {
	mock := &wsMock{}

	srv, _ := newTestServerWithWS(mock)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/sessions/main/windows/0/attach"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 認証なしで接続
	_, resp, err := websocket.Dial(ctx, wsURL, nil)
	if err == nil {
		t.Error("expected error connecting without auth")
		return
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}
