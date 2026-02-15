package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"syscall"

	"github.com/creack/pty"
	"nhooyr.io/websocket"
)

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
func (s *Server) handleAttach() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.PathValue("session")

		// WebSocket アップグレード
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			log.Printf("websocket accept error: %v", err)
			return
		}
		defer conn.Close(websocket.StatusInternalError, "internal error")

		// tmux attach
		ptmx, cmd, err := s.tmux.Attach(session)
		if err != nil {
			log.Printf("attach error: %v", err)
			conn.Close(websocket.StatusInternalError, "attach failed: "+err.Error())
			return
		}

		// クリーンアップ
		ctx, cancel := context.WithCancel(r.Context())
		var once sync.Once
		cleanup := func() {
			once.Do(func() {
				cancel()
				ptmx.Close()
				if cmd != nil && cmd.Process != nil {
					cmd.Process.Signal(syscall.SIGTERM)
					cmd.Wait()
				}
			})
		}
		defer cleanup()

		// pty → WebSocket (出力)
		go s.ptyToWS(ctx, conn, ptmx, cleanup)

		// WebSocket → pty (入力)
		s.wsToPty(ctx, conn, ptmx, cleanup)
	})
}

// ptyToWS は pty からの出力を WebSocket に中継する。
func (s *Server) ptyToWS(ctx context.Context, conn *websocket.Conn, ptmx *os.File, cleanup func()) {
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

		if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
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
		default:
			log.Printf("unknown message type: %q", msg.Type)
		}
	}
}
