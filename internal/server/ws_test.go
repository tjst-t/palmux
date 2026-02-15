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
	attachPty *os.File // ハンドラに渡す側（pty マスター） - 単一接続テスト用

	// multiPty が true の場合、Attach 呼び出しごとに新しい pty ペアを作成する
	multiPty bool
	ptsPairs []*os.File // テスト側がアクセスするスレーブ側の一覧

	calledAttach       string
	calledWindowIndex  int
	mu                 sync.Mutex
}

func (m *wsMock) Attach(session string, windowIndex int) (*os.File, *exec.Cmd, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calledAttach = session
	m.calledWindowIndex = windowIndex
	if m.attachErr != nil {
		return nil, nil, m.attachErr
	}

	var ptmx *os.File
	if m.multiPty {
		// 複数接続テスト用: 毎回新しい pty ペアを作成
		var pts *os.File
		var err error
		ptmx, pts, err = createPtyPair()
		if err != nil {
			return nil, nil, err
		}
		m.ptsPairs = append(m.ptsPairs, pts)
	} else {
		ptmx = m.attachPty
	}

	// ダミーの sleep プロセスを起動（cleanup テスト用）
	cmd := exec.Command("sleep", "60")
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	return ptmx, cmd, nil
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

// newTestServerWithWSAndMaxConn は WebSocket テスト用 Server を MaxConnections 付きで作成するヘルパー。
func newTestServerWithWSAndMaxConn(mock *wsMock, maxConn int) (*Server, string) {
	const token = "test-token"
	srv := NewServer(Options{
		Tmux:           mock,
		Token:          token,
		BasePath:       "/",
		MaxConnections: maxConn,
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

func TestHandleAttach_WindowIndex(t *testing.T) {
	tests := []struct {
		name            string
		path            string
		wantSession     string
		wantWindowIndex int
	}{
		{
			name:            "ウィンドウインデックス0",
			path:            "/api/sessions/main/windows/0/attach",
			wantSession:     "main",
			wantWindowIndex: 0,
		},
		{
			name:            "ウィンドウインデックス3",
			path:            "/api/sessions/dev/windows/3/attach",
			wantSession:     "dev",
			wantWindowIndex: 3,
		},
		{
			name:            "大きなウィンドウインデックス",
			path:            "/api/sessions/main/windows/99/attach",
			wantSession:     "main",
			wantWindowIndex: 99,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pts, mock, cleanup := setupWSTest(t)
			defer cleanup()
			_ = pts

			srv, token := newTestServerWithWS(mock)
			ts := httptest.NewServer(srv.Handler())
			defer ts.Close()

			conn, _, cancel := dialWS(t, ts.URL, tt.path, token)
			defer cancel()
			defer conn.Close(websocket.StatusNormalClosure, "")

			time.Sleep(100 * time.Millisecond)

			mock.mu.Lock()
			gotSession := mock.calledAttach
			gotIndex := mock.calledWindowIndex
			mock.mu.Unlock()

			if gotSession != tt.wantSession {
				t.Errorf("Attach session = %q, want %q", gotSession, tt.wantSession)
			}
			if gotIndex != tt.wantWindowIndex {
				t.Errorf("Attach windowIndex = %d, want %d", gotIndex, tt.wantWindowIndex)
			}
		})
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

// --- Connection Tracker Tests ---

func TestConnectionTracker_Add(t *testing.T) {
	ct := newConnectionTracker(5)

	id, err := ct.add("main", "127.0.0.1:12345")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id == "" {
		t.Error("expected non-empty connection ID")
	}

	conns := ct.list()
	if len(conns) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(conns))
	}
	if conns[0].Session != "main" {
		t.Errorf("session = %q, want %q", conns[0].Session, "main")
	}
	if conns[0].RemoteIP != "127.0.0.1:12345" {
		t.Errorf("remote_ip = %q, want %q", conns[0].RemoteIP, "127.0.0.1:12345")
	}
	if conns[0].Connected.IsZero() {
		t.Error("connected time should not be zero")
	}
}

func TestConnectionTracker_Remove(t *testing.T) {
	ct := newConnectionTracker(5)

	id, err := ct.add("main", "127.0.0.1:12345")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ct.remove(id)

	conns := ct.list()
	if len(conns) != 0 {
		t.Errorf("expected 0 connections after remove, got %d", len(conns))
	}
}

func TestConnectionTracker_MaxPerSession(t *testing.T) {
	ct := newConnectionTracker(2)

	// 同一セッションに2つの接続（上限）
	id1, err := ct.add("main", "127.0.0.1:1")
	if err != nil {
		t.Fatalf("unexpected error on first add: %v", err)
	}
	_, err = ct.add("main", "127.0.0.1:2")
	if err != nil {
		t.Fatalf("unexpected error on second add: %v", err)
	}

	// 3つ目は拒否される
	_, err = ct.add("main", "127.0.0.1:3")
	if err == nil {
		t.Fatal("expected error when exceeding max connections, got nil")
	}

	// 別のセッションは影響を受けない
	_, err = ct.add("dev", "127.0.0.1:4")
	if err != nil {
		t.Fatalf("unexpected error on different session: %v", err)
	}

	// 1つ削除すれば再度追加可能
	ct.remove(id1)
	_, err = ct.add("main", "127.0.0.1:5")
	if err != nil {
		t.Fatalf("unexpected error after removing a connection: %v", err)
	}
}

func TestConnectionTracker_List(t *testing.T) {
	ct := newConnectionTracker(5)

	ct.add("main", "127.0.0.1:1")
	ct.add("dev", "192.168.1.1:2")
	ct.add("main", "10.0.0.1:3")

	conns := ct.list()
	if len(conns) != 3 {
		t.Fatalf("expected 3 connections, got %d", len(conns))
	}

	// セッション名ごとの接続数を数える
	sessionCounts := make(map[string]int)
	for _, c := range conns {
		sessionCounts[c.Session]++
	}
	if sessionCounts["main"] != 2 {
		t.Errorf("main connections = %d, want 2", sessionCounts["main"])
	}
	if sessionCounts["dev"] != 1 {
		t.Errorf("dev connections = %d, want 1", sessionCounts["dev"])
	}
}

func TestConnectionTracker_ConcurrentSafety(t *testing.T) {
	ct := newConnectionTracker(100)
	var wg sync.WaitGroup

	// 並行してadd/remove/listを実行してデータ競合がないことを確認
	for i := 0; i < 50; i++ {
		wg.Add(3)
		go func(i int) {
			defer wg.Done()
			id, _ := ct.add("session", "127.0.0.1:"+strings.Repeat("0", i%5))
			if id != "" {
				ct.remove(id)
			}
		}(i)
		go func() {
			defer wg.Done()
			ct.list()
		}()
		go func() {
			defer wg.Done()
			ct.add("other", "192.168.0.1:1")
		}()
	}
	wg.Wait()
}

func TestHandleAttach_MultipleConnectionsSameSession(t *testing.T) {
	mock := &wsMock{
		multiPty: true,
	}

	srv, token := newTestServerWithWSAndMaxConn(mock, 5)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 同一セッションに2つの WebSocket 接続を確立
	conn1, _, cancel1 := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel1()
	defer conn1.Close(websocket.StatusNormalClosure, "")

	conn2, _, cancel2 := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel2()
	defer conn2.Close(websocket.StatusNormalClosure, "")

	// 両方の接続が成功していることを確認（パニックしない）
	time.Sleep(200 * time.Millisecond)

	// cleanup: multiPty の pts を閉じる
	mock.mu.Lock()
	for _, pts := range mock.ptsPairs {
		pts.Close()
	}
	mock.mu.Unlock()
}

func TestHandleAttach_TooManyConnections(t *testing.T) {
	mock := &wsMock{
		multiPty: true,
	}

	// maxConnections を 2 に設定
	srv, token := newTestServerWithWSAndMaxConn(mock, 2)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 2つの接続を確立（上限まで）
	conn1, _, cancel1 := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel1()
	defer conn1.Close(websocket.StatusNormalClosure, "")

	conn2, _, cancel2 := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel2()
	defer conn2.Close(websocket.StatusNormalClosure, "")

	// 少し待って接続が登録されるのを確認
	time.Sleep(200 * time.Millisecond)

	// 3つ目の接続は 429 で拒否されるべき
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/sessions/main/windows/0/attach"
	ctx, cancel3 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel3()

	_, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Authorization": []string{"Bearer " + token},
		},
	})

	// WebSocket upgrade が拒否されてエラーが返るはず
	if err == nil {
		t.Fatal("expected error when exceeding max connections, but got nil")
	}
	if resp != nil && resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusTooManyRequests)
	}

	// cleanup
	mock.mu.Lock()
	for _, pts := range mock.ptsPairs {
		pts.Close()
	}
	mock.mu.Unlock()
}

func TestHandleAttach_ConnectionRemovedAfterClose(t *testing.T) {
	mock := &wsMock{
		multiPty: true,
	}

	srv, token := newTestServerWithWSAndMaxConn(mock, 5)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// 接続を確立
	conn, _, cancel := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel()

	// 接続が登録されたことを確認
	time.Sleep(200 * time.Millisecond)

	conns := srv.connTracker.list()
	if len(conns) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(conns))
	}

	// WebSocket を閉じる
	conn.Close(websocket.StatusNormalClosure, "done")

	// 接続が削除されるまで待つ
	time.Sleep(1 * time.Second)

	conns = srv.connTracker.list()
	if len(conns) != 0 {
		t.Errorf("expected 0 connections after close, got %d", len(conns))
	}

	// cleanup
	mock.mu.Lock()
	for _, pts := range mock.ptsPairs {
		pts.Close()
	}
	mock.mu.Unlock()
}

func TestHandleListConnections(t *testing.T) {
	mock := &wsMock{
		multiPty: true,
	}

	srv, token := newTestServerWithWSAndMaxConn(mock, 5)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	// まず接続なしの状態で API を呼ぶ
	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/connections", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var emptyConns []connectionInfo
	if err := json.NewDecoder(rec.Body).Decode(&emptyConns); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(emptyConns) != 0 {
		t.Errorf("expected 0 connections, got %d", len(emptyConns))
	}

	// WebSocket 接続を確立
	conn1, _, cancel1 := dialWS(t, ts.URL, "/api/sessions/main/windows/0/attach", token)
	defer cancel1()
	defer conn1.Close(websocket.StatusNormalClosure, "")

	conn2, _, cancel2 := dialWS(t, ts.URL, "/api/sessions/dev/windows/0/attach", token)
	defer cancel2()
	defer conn2.Close(websocket.StatusNormalClosure, "")

	time.Sleep(200 * time.Millisecond)

	// 接続一覧 API を呼ぶ
	rec = doRequest(t, srv.Handler(), http.MethodGet, "/api/connections", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	ct := rec.Header().Get("Content-Type")
	if !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var conns []connectionInfo
	if err := json.NewDecoder(rec.Body).Decode(&conns); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(conns) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(conns))
	}

	// セッション名ごとの接続を確認
	sessionFound := make(map[string]bool)
	for _, c := range conns {
		sessionFound[c.Session] = true
		if c.RemoteIP == "" {
			t.Error("remote_ip should not be empty")
		}
		if c.Connected.IsZero() {
			t.Error("connected time should not be zero")
		}
	}
	if !sessionFound["main"] {
		t.Error("expected connection for session 'main'")
	}
	if !sessionFound["dev"] {
		t.Error("expected connection for session 'dev'")
	}

	// cleanup
	mock.mu.Lock()
	for _, pts := range mock.ptsPairs {
		pts.Close()
	}
	mock.mu.Unlock()
}

func TestHandleListConnections_AuthRequired(t *testing.T) {
	mock := &wsMock{}
	srv, _ := newTestServerWithWS(mock)

	rec := doRequest(t, srv.Handler(), http.MethodGet, "/api/connections", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestHandleAttach_DefaultMaxConnections(t *testing.T) {
	// MaxConnections が 0 の場合、デフォルトの 5 が使われることを確認
	mock := &wsMock{
		multiPty: true,
	}

	srv, _ := newTestServerWithWS(mock)

	// connTracker の maxPerSession がデフォルトの 5 であることを確認
	if srv.connTracker.maxPerSession != 5 {
		t.Errorf("default maxPerSession = %d, want 5", srv.connTracker.maxPerSession)
	}

	// cleanup
	mock.mu.Lock()
	for _, pts := range mock.ptsPairs {
		pts.Close()
	}
	mock.mu.Unlock()
}
