package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"os"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"nhooyr.io/websocket"
)

// wsPingInterval は WebSocket の ping 送信間隔。
// Cloudflare Tunnel の 100 秒アイドルタイムアウト対策。
var wsPingInterval = 30 * time.Second

// wsWatchActiveWindowInterval は WebSocket のアクティブウィンドウ監視間隔。
// テスト時に上書き可能。
var wsWatchActiveWindowInterval = 2 * time.Second

// connectionInfo は個々の WebSocket 接続のメタデータ。
type connectionInfo struct {
	Session   string    `json:"session"`
	RemoteIP  string    `json:"remote_ip"`
	Connected time.Time `json:"connected"`
}

// connectionTracker は WebSocket 接続を追跡する。
// 同一セッションへの最大同時接続数を制限する。
type connectionTracker struct {
	mu            sync.Mutex
	connections   map[string]*connectionInfo // keyed by unique ID
	maxPerSession int
}

// newConnectionTracker は新しい connectionTracker を生成する。
func newConnectionTracker(maxPerSession int) *connectionTracker {
	if maxPerSession <= 0 {
		maxPerSession = 5
	}
	return &connectionTracker{
		connections:   make(map[string]*connectionInfo),
		maxPerSession: maxPerSession,
	}
}

// add は新しい接続を追加する。
// 同一セッションの接続数が maxPerSession を超える場合はエラーを返す。
func (ct *connectionTracker) add(session, remoteIP string) (string, error) {
	ct.mu.Lock()
	defer ct.mu.Unlock()

	// 同一セッションの接続数をカウント
	count := 0
	for _, c := range ct.connections {
		if c.Session == session {
			count++
		}
	}

	if count >= ct.maxPerSession {
		return "", fmt.Errorf("too many connections for session %q", session)
	}

	id := generateConnID()
	ct.connections[id] = &connectionInfo{
		Session:   session,
		RemoteIP:  remoteIP,
		Connected: time.Now(),
	}
	return id, nil
}

// remove は指定 ID の接続を削除する。
func (ct *connectionTracker) remove(id string) {
	ct.mu.Lock()
	defer ct.mu.Unlock()
	delete(ct.connections, id)
}

// list は全接続のリストを返す。
func (ct *connectionTracker) list() []connectionInfo {
	ct.mu.Lock()
	defer ct.mu.Unlock()
	result := make([]connectionInfo, 0, len(ct.connections))
	for _, c := range ct.connections {
		result = append(result, *c)
	}
	return result
}

// generateConnID はランダムな接続 ID を生成する。
func generateConnID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// フォールバック: タイムスタンプベースの ID
		return fmt.Sprintf("conn-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// wsClientStatusMessage はクライアントのセッション/ウィンドウ変更通知メッセージ。
// セッション切替・ウィンドウ切替の両方を通知する。
type wsClientStatusMessage struct {
	Type    string `json:"type"`
	Session string `json:"session"`
	Window  int    `json:"window"`
}

// wsInputMessage はクライアントから送られる入力メッセージ。
type wsInputMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// wsOutputMessage はクライアントに送る出力メッセージ。
type wsOutputMessage struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

// handleAttach は WebSocket pty ブリッジのハンドラ。
// WebSocket 接続を受け付け、tmux attach-session の pty と双方向にデータを中継する。
// 接続数が maxPerSession を超える場合は 429 Too Many Requests を返す。
func (s *Server) handleAttach() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")
		windowIndex := -1
		if idxStr := r.PathValue("index"); idxStr != "" {
			if idx, err := strconv.Atoi(idxStr); err == nil {
				windowIndex = idx
			}
		}

		// 接続数チェック（WebSocket upgrade の前に行う）
		connID, err := s.connTracker.add(session, r.RemoteAddr)
		if err != nil {
			http.Error(w, err.Error(), http.StatusTooManyRequests)
			return
		}

		// WebSocket アップグレード
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			log.Printf("websocket accept error: %v", err)
			s.connTracker.remove(connID)
			return
		}
		defer conn.Close(websocket.StatusInternalError, "internal error")

		// tmux attach（ウィンドウインデックス指定付き）
		ptmx, cmd, err := s.tmux.Attach(session, windowIndex)
		if err != nil {
			log.Printf("attach error: %v", err)
			s.connTracker.remove(connID)
			conn.Close(websocket.StatusInternalError, "attach failed: "+err.Error())
			return
		}

		// クリーンアップ
		ctx, cancel := context.WithCancel(r.Context())
		var once sync.Once
		cleanup := func() {
			once.Do(func() {
				cancel()
				s.connTracker.remove(connID)
				// プロセスを先にシグナルで終了させてから PTY を閉じる。
				// PTY を先に閉じるとプロセスが異常な状態で終了する可能性がある。
				if cmd != nil && cmd.Process != nil {
					cmd.Process.Signal(syscall.SIGTERM)
					// タイムアウト付きで終了を待つ（デッドロック防止）
					done := make(chan struct{})
					go func() {
						cmd.Wait()
						close(done)
					}()
					select {
					case <-done:
						// プロセスが正常終了
					case <-time.After(3 * time.Second):
						// タイムアウト: 強制終了
						cmd.Process.Signal(syscall.SIGKILL)
						<-done
					}
				}
				ptmx.Close()
			})
		}
		defer cleanup()

		// 全 WebSocket 書き込みをシリアライズする（concurrent writes 対策）
		var wsMu sync.Mutex
		writeWS := func(ctx context.Context, data []byte) error {
			wsMu.Lock()
			defer wsMu.Unlock()
			return conn.Write(ctx, websocket.MessageText, data)
		}

		// WebSocket ping (Cloudflare Tunnel の 100 秒アイドルタイムアウト対策)
		go s.wsPing(ctx, writeWS, cleanup)

		// pty → WebSocket (出力)
		go s.ptyToWS(ctx, writeWS, ptmx, cleanup)

		// クライアントのセッション/ウィンドウ変更を監視して WebSocket に通知
		go s.watchActiveWindow(ctx, writeWS, ptmx, cleanup)

		// WebSocket → pty (入力)
		s.wsToPty(ctx, conn, ptmx, cleanup)
	})
}

// handleListConnections は GET /api/connections のハンドラ。
// 全セッションの接続一覧を JSON 配列で返す。
func (s *Server) handleListConnections() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conns := s.connTracker.list()
		writeJSON(w, http.StatusOK, conns)
	})
}

// wsPing は定期的に ping メッセージを WebSocket に送信する。
// Cloudflare Tunnel 等のアイドルタイムアウトによる切断を防止する。
func (s *Server) wsPing(ctx context.Context, writeWS func(context.Context, []byte) error, cleanup func()) {
	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			msg := wsOutputMessage{Type: "ping"}
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			if err := writeWS(ctx, data); err != nil {
				cleanup()
				return
			}
		}
	}
}

// ptyToWS は pty からの出力を WebSocket に中継する。
func (s *Server) ptyToWS(ctx context.Context, writeWS func(context.Context, []byte) error, ptmx *os.File, cleanup func()) {
	buf := make([]byte, 4096)
	for {
		n, err := ptmx.Read(buf)
		if err != nil {
			// pty が閉じられた
			cleanup()
			return
		}

		msg := wsOutputMessage{
			Type: "output",
			Data: string(buf[:n]),
		}
		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("json marshal error: %v", err)
			continue
		}

		if err := writeWS(ctx, data); err != nil {
			// WebSocket 書き込みエラー（クライアント切断など）
			cleanup()
			return
		}
	}
}

// wsToPty は WebSocket からの入力を pty に中継する。
func (s *Server) wsToPty(ctx context.Context, conn *websocket.Conn, ptmx *os.File, cleanup func()) {
	for {
		_, msgData, err := conn.Read(ctx)
		if err != nil {
			// WebSocket 読み込みエラー（クライアント切断など）
			cleanup()
			return
		}

		var msg wsInputMessage
		if err := json.Unmarshal(msgData, &msg); err != nil {
			log.Printf("invalid ws message: %v", err)
			continue
		}

		switch msg.Type {
		case "input":
			if _, err := ptmx.Write([]byte(msg.Data)); err != nil {
				log.Printf("pty write error: %v", err)
				cleanup()
				return
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				if err := pty.Setsize(ptmx, &pty.Winsize{
					Cols: uint16(msg.Cols),
					Rows: uint16(msg.Rows),
				}); err != nil {
					log.Printf("pty resize error: %v", err)
					// resize エラーは致命的ではないので継続
				}
			}
		case "pong":
			// クライアントからの ping 応答 — 処理不要
		default:
			log.Printf("unknown message type: %q", msg.Type)
		}
	}
}

// watchActiveWindow は wsWatchActiveWindowInterval ごとにクライアントの
// セッション/ウィンドウを監視し、変化を検知したら client_status メッセージを送信する。
// ptmx からスレーブ pts 名を取得し、tmux display-message でクライアントの現在状態を問い合わせる。
// これによりセッション切替（tmux switch-client 等）もウィンドウ切替も検知できる。
func (s *Server) watchActiveWindow(
	ctx context.Context,
	writeWS func(context.Context, []byte) error,
	ptmx *os.File,
	cleanup func(),
) {
	ptsName := getPTSName(ptmx)
	if ptsName == "" {
		// pts 名を取得できない場合は監視不可
		return
	}

	ticker := time.NewTicker(wsWatchActiveWindowInterval)
	defer ticker.Stop()

	lastSession := "" // 空文字 = ベースライン未確立
	lastWindow := -1
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			curSession, curWindow, err := s.tmux.GetClientSessionWindow(ptsName)
			if err != nil || curSession == "" {
				continue
			}
			if lastSession == "" {
				// ベースライン確立（通知不要）
				lastSession = curSession
				lastWindow = curWindow
				continue
			}
			if curSession != lastSession || curWindow != lastWindow {
				lastSession = curSession
				lastWindow = curWindow
				msg := wsClientStatusMessage{
					Type:    "client_status",
					Session: curSession,
					Window:  curWindow,
				}
				data, err := json.Marshal(msg)
				if err != nil {
					continue
				}
				if err := writeWS(ctx, data); err != nil {
					cleanup()
					return
				}
			}
		}
	}
}
