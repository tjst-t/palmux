# メモリリーク修正・診断ログ・リソース制限 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** サーバーの OOM クラッシュを防止するため、HTTP タイムアウト設定・graceful shutdown・リソース制限・診断ログを追加する

**Architecture:** `http.Server` を明示的に構成してタイムアウトを設定し、シグナルハンドリングで graceful shutdown を実装する。WebSocket cleanup にタイムアウト付き SIGKILL フォールバックを追加。API ボディサイズを `http.MaxBytesReader` で制限。`log/slog` による構造化ログで接続・リソース状態を記録する。

**Tech Stack:** Go 標準ライブラリ (`net/http`, `os/signal`, `context`, `log/slog`, `runtime`)

---

### Task 1: HTTP サーバーにタイムアウトを設定する

`http.ListenAndServe` は内部でデフォルト `http.Server` を使い、タイムアウトがすべてゼロ。
`http.Server` を明示的に構成し、`ReadHeaderTimeout`, `IdleTimeout` を設定する。
`ReadTimeout`/`WriteTimeout` は WebSocket の長時間接続と衝突するため設定しない。

**Files:**
- Modify: `internal/server/server.go` (ListenAndServe, ListenAndServeTLS メソッド)
- Test: `internal/server/server_test.go` (既存テストが引き続きパスすることを確認)

**Step 1: テストを書く**

`server_test.go` に以下を追加:

```go
func TestServer_ListenAndServe_UsesConfiguredTimeouts(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
		Frontend: newTestFrontendFS(),
	})

	// httpServer メソッドが適切な設定の *http.Server を返すことを確認
	hs := srv.httpServer("127.0.0.1:0")
	if hs.ReadHeaderTimeout == 0 {
		t.Error("ReadHeaderTimeout should not be zero")
	}
	if hs.IdleTimeout == 0 {
		t.Error("IdleTimeout should not be zero")
	}
	if hs.MaxHeaderBytes == 0 {
		t.Error("MaxHeaderBytes should not be zero")
	}
}
```

**Step 2: テストが失敗することを確認**

Run: `go test ./internal/server/ -run TestServer_ListenAndServe_UsesConfiguredTimeouts -v`
Expected: FAIL — `srv.httpServer` メソッドが未定義

**Step 3: 実装**

`server.go` を修正。`ListenAndServe` / `ListenAndServeTLS` を `http.Server` を使う形に変更:

```go
import "time"

// httpServer は適切なタイムアウトが設定された *http.Server を返す。
func (s *Server) httpServer(addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           s.handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}
}

func (s *Server) ListenAndServe(addr string) error {
	return s.httpServer(addr).ListenAndServe()
}

func (s *Server) ListenAndServeTLS(addr, certFile, keyFile string) error {
	return s.httpServer(addr).ListenAndServeTLS(certFile, keyFile)
}
```

注意: `ReadTimeout` / `WriteTimeout` は WebSocket 接続を切断してしまうため設定しない。`ReadHeaderTimeout` でヘッダー読み取りだけを制限し、slowloris 対策とする。

**Step 4: テストを実行**

Run: `go test ./internal/server/ -run TestServer_ListenAndServe_UsesConfiguredTimeouts -v`
Expected: PASS

**Step 5: 既存テストの確認**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 6: コミット**

```bash
git add internal/server/server.go internal/server/server_test.go
git commit -m "fix: add HTTP server timeouts to prevent slowloris and idle connection accumulation"
```

---

### Task 2: Graceful shutdown を実装する

`main.go` にシグナルハンドリングを追加。SIGTERM/SIGINT 受信時に `http.Server.Shutdown()` でアクティブ接続の終了を待つ。
これにより WebSocket の cleanup 関数が正常に実行され、PTY/子プロセスのリーク防止。

**Files:**
- Modify: `internal/server/server.go` (ListenAndServe 系メソッドで `*http.Server` を返す or Shutdown 対応)
- Modify: `main.go` (シグナルハンドリング追加)
- Test: `internal/server/server_test.go`

**Step 1: server.go に Shutdown 対応を追加**

`ListenAndServe` / `ListenAndServeTLS` のシグネチャは変えず、新たに `Serve` メソッドを追加して `*http.Server` を外部から利用可能にする:

```go
// Serve は http.Server を構成して返す。呼び出し元で ListenAndServe と Shutdown を制御する。
func (s *Server) NewHTTPServer(addr string) *http.Server {
	return s.httpServer(addr)
}
```

**Step 2: main.go を修正**

```go
import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// ... 既存のフラグ解析・初期化は変更なし ...

	httpSrv := srv.NewHTTPServer(addr)

	// graceful shutdown
	done := make(chan struct{})
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		sig := <-sigCh
		log.Printf("received signal %v, shutting down...", sig)

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(ctx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
		close(done)
	}()

	fmt.Printf("Palmux started on %s ...\n", addr)
	fmt.Printf("Auth token: %s\n", authToken)

	var err error
	if *tlsCert != "" {
		err = httpSrv.ListenAndServeTLS(*tlsCert, *tlsKey)
	} else {
		err = httpSrv.ListenAndServe()
	}
	if err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	<-done
	log.Println("server stopped")
}
```

**Step 3: テストを書く**

```go
func TestServer_NewHTTPServer(t *testing.T) {
	srv := NewServer(Options{
		Tmux:     &mockTmuxManager{},
		Token:    "test-token",
		BasePath: "/",
	})

	hs := srv.NewHTTPServer("127.0.0.1:0")
	if hs == nil {
		t.Fatal("NewHTTPServer returned nil")
	}
	if hs.Handler == nil {
		t.Error("Handler should not be nil")
	}
	if hs.ReadHeaderTimeout == 0 {
		t.Error("ReadHeaderTimeout should not be zero")
	}
}
```

**Step 4: テストを実行**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 5: コミット**

```bash
git add internal/server/server.go internal/server/server_test.go main.go
git commit -m "feat: add graceful shutdown with signal handling for clean resource cleanup"
```

---

### Task 3: WebSocket cleanup の cmd.Wait() にタイムアウトを追加

`ws.go` の cleanup 関数で `cmd.Process.Signal(SIGTERM)` 後の `cmd.Wait()` が無期限ブロックする問題を修正。
タイムアウト (5秒) 後に SIGKILL へエスカレーション。

**Files:**
- Modify: `internal/server/ws.go` (cleanup 関数)
- Test: `internal/server/ws_test.go`

**Step 1: テストを書く**

```go
func TestHandleAttach_CleanupWithSIGKILLFallback(t *testing.T) {
	// SIGTERM を無視するプロセスでテスト
	// cleanup が SIGKILL でプロセスを終了できることを確認
	// (このテストは waitWithTimeout ヘルパーの動作確認)
}

func TestWaitWithTimeout_NormalExit(t *testing.T) {
	cmd := exec.Command("sleep", "0")
	cmd.Start()
	err := waitWithTimeout(cmd, 5*time.Second)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestWaitWithTimeout_Timeout(t *testing.T) {
	cmd := exec.Command("sleep", "60")
	cmd.Start()
	defer cmd.Process.Kill()

	start := time.Now()
	waitWithTimeout(cmd, 100*time.Millisecond)
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Errorf("waitWithTimeout took too long: %v", elapsed)
	}
}
```

**Step 2: テストが失敗することを確認**

Run: `go test ./internal/server/ -run TestWaitWithTimeout -v`
Expected: FAIL — `waitWithTimeout` 未定義

**Step 3: 実装**

`ws.go` に `waitWithTimeout` ヘルパーを追加し、cleanup で使う:

```go
// waitWithTimeout は cmd の終了を timeout まで待ち、
// タイムアウト時は SIGKILL を送信する。
func waitWithTimeout(cmd *exec.Cmd, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	select {
	case err := <-done:
		return err
	case <-time.After(timeout):
		cmd.Process.Kill()
		return <-done
	}
}
```

cleanup 関数を更新:

```go
cleanup := func() {
	once.Do(func() {
		cancel()
		ptmx.Close()
		s.connTracker.remove(connID)
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Signal(syscall.SIGTERM)
			waitWithTimeout(cmd, 5*time.Second)
		}
	})
}
```

**Step 4: テストを実行**

Run: `go test ./internal/server/ -run TestWaitWithTimeout -v`
Expected: PASS

**Step 5: 全テスト確認**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 6: コミット**

```bash
git add internal/server/ws.go internal/server/ws_test.go
git commit -m "fix: add timeout to cmd.Wait() in WebSocket cleanup with SIGKILL fallback"
```

---

### Task 4: API リクエストボディサイズ制限を追加

`json.NewDecoder(r.Body).Decode()` を使うエンドポイントで、`http.MaxBytesReader` を使ってボディサイズを制限する。
API のリクエストボディは小さい JSON のみなので 1MB で十分。

**Files:**
- Modify: `internal/server/api_sessions.go` (handleCreateSession)
- Modify: `internal/server/api_window.go` (handleCreateWindow, handleRenameWindow)
- Test: `internal/server/api_sessions_test.go`
- Test: `internal/server/api_window_test.go`

**Step 1: テストを書く**

`api_sessions_test.go` に追加:

```go
func TestHandleCreateSession_OversizedBody(t *testing.T) {
	mock := &configurableMock{}
	srv, token := newTestServer(mock)

	// 2MB のボディを送信
	largeBody := strings.Repeat("x", 2*1024*1024)
	rec := doRequest(t, srv.Handler(), http.MethodPost, "/api/sessions", token, largeBody)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}
```

`api_window_test.go` に追加:

```go
func TestHandleRenameWindow_OversizedBody(t *testing.T) {
	mock := &configurableMock{}
	srv, token := newTestServer(mock)

	largeBody := strings.Repeat("x", 2*1024*1024)
	rec := doRequest(t, srv.Handler(), http.MethodPatch, "/api/sessions/main/windows/0", token, largeBody)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}
```

**Step 2: テストが失敗することを確認**

Run: `go test ./internal/server/ -run TestHandleCreateSession_OversizedBody -v`
Expected: FAIL — 400 (Bad Request) が返る（サイズ制限が効いていない）

**Step 3: 実装**

`api_sessions.go` の `handleCreateSession`:

```go
// MaxBytesReader でボディサイズを制限 (1MB)
r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
	// MaxBytesError の場合は 413 を返す
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
	return
}
```

`api_window.go` の `handleCreateWindow`, `handleRenameWindow` にも同様の修正を適用。

**Step 4: テストを実行**

Run: `go test ./internal/server/ -run "TestHandleCreateSession_OversizedBody|TestHandleRenameWindow_OversizedBody" -v`
Expected: PASS

**Step 5: 全テスト確認**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 6: コミット**

```bash
git add internal/server/api_sessions.go internal/server/api_window.go internal/server/api_sessions_test.go internal/server/api_window_test.go
git commit -m "fix: add request body size limit (1MB) to prevent OOM via large POST requests"
```

---

### Task 5: 診断ログを追加する

`log/slog` を使った構造化ログを導入。以下のイベントを記録:
- WebSocket 接続/切断 (セッション名、リモートIP、接続時間)
- cleanup イベント (SIGTERM 送信、SIGKILL フォールバック、所要時間)
- ランタイムメトリクス (goroutine 数、メモリ使用量) を定期ログ
- サーバー起動/シャットダウン

**Files:**
- Create: `internal/server/diag.go` (診断ログヘルパー、ランタイムメトリクス定期出力)
- Modify: `internal/server/ws.go` (接続/切断/cleanup ログ追加)
- Modify: `main.go` (起動時にメトリクスログ開始)
- Test: `internal/server/diag_test.go`

**Step 1: テストを書く**

`diag_test.go`:

```go
package server

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestStartDiagnostics_LogsMetrics(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	StartDiagnostics(ctx, logger, 50*time.Millisecond)
	time.Sleep(120 * time.Millisecond)
	cancel()

	output := buf.String()
	if !strings.Contains(output, "goroutines") {
		t.Errorf("diagnostics should log goroutine count, got: %s", output)
	}
	if !strings.Contains(output, "heap_alloc_mb") {
		t.Errorf("diagnostics should log heap alloc, got: %s", output)
	}
}
```

**Step 2: テストが失敗することを確認**

Run: `go test ./internal/server/ -run TestStartDiagnostics_LogsMetrics -v`
Expected: FAIL — `StartDiagnostics` 未定義

**Step 3: 実装**

`diag.go`:

```go
package server

import (
	"context"
	"log/slog"
	"runtime"
	"time"
)

// StartDiagnostics はランタイムメトリクスを定期的にログ出力するゴルーチンを起動する。
// ctx がキャンセルされると停止する。
func StartDiagnostics(ctx context.Context, logger *slog.Logger, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				logger.Info("runtime metrics",
					"goroutines", runtime.NumGoroutine(),
					"heap_alloc_mb", float64(m.HeapAlloc)/(1024*1024),
					"heap_sys_mb", float64(m.HeapSys)/(1024*1024),
					"num_gc", m.NumGC,
				)
			}
		}
	}()
}
```

**Step 4: ws.go に接続/切断ログを追加**

`Server` 構造体に `Logger *slog.Logger` フィールドを追加。
`NewServer` でデフォルトの slog.Logger を設定。
`Options` に `Logger` フィールドを追加（nil ならデフォルト）。

`handleAttach` に以下のログを追加:
- 接続時: `s.Logger.Info("ws connected", "session", session, "window", windowIndex, "remote", r.RemoteAddr)`
- 切断/cleanup 時: `s.Logger.Info("ws disconnected", "session", session, "remote", r.RemoteAddr, "duration", time.Since(connectedAt))`
- SIGKILL フォールバック時: `s.Logger.Warn("process did not exit after SIGTERM, sending SIGKILL", ...)`

**Step 5: main.go にメトリクスログ開始を追加**

```go
logger := slog.Default()
// 60秒ごとにランタイムメトリクスをログ出力
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
server.StartDiagnostics(ctx, logger, 60*time.Second)
```

**Step 6: テストを実行**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 7: コミット**

```bash
git add internal/server/diag.go internal/server/diag_test.go internal/server/ws.go internal/server/server.go main.go
git commit -m "feat: add structured diagnostic logging for connections, cleanup, and runtime metrics"
```

---

### Task 6: WebSocket 読み取りサイズ制限を明示設定

`nhooyr.io/websocket` のデフォルト読み取り制限 (32KB) に頼るのではなく、明示的に設定する。
これによりライブラリのバージョンアップ時の安全性を確保する。

**Files:**
- Modify: `internal/server/ws.go` (WebSocket accept 後に `conn.SetReadLimit` を呼ぶ)

**Step 1: 実装**

`handleAttach` の `websocket.Accept` 成功後に追加:

```go
conn.SetReadLimit(32768) // 32KB — ターミナル入力には十分
```

**Step 2: 全テスト確認**

Run: `go test ./internal/server/ -v`
Expected: ALL PASS

**Step 3: コミット**

```bash
git add internal/server/ws.go
git commit -m "fix: explicitly set WebSocket read limit to 32KB"
```

---

### Task 7: cgroup によるメモリ制限テストのドキュメント

テスト時に cgroup v2 でプロセスのメモリを制限する方法をドキュメント化する。

**Files:**
- Create: `docs/testing-memory-limit.md`

**内容:**

```markdown
# cgroup v2 でメモリ制限をかけてテストする

## 1. cgroup を作成してメモリ制限を設定

```bash
# cgroup を作成（要 root）
sudo mkdir -p /sys/fs/cgroup/palmux-test

# メモリ制限を 128MB に設定
echo 128M | sudo tee /sys/fs/cgroup/palmux-test/memory.max

# swap を無効化（OOM の挙動を正確に観察するため）
echo 0 | sudo tee /sys/fs/cgroup/palmux-test/memory.swap.max
```

## 2. palmux を cgroup 内で起動

```bash
# systemd-run を使う方法（推奨）
sudo systemd-run --scope -p MemoryMax=128M -p MemorySwapMax=0 ./palmux --port 8080

# 手動で cgroup に追加する方法
sudo sh -c "echo $$ > /sys/fs/cgroup/palmux-test/cgroup.procs" && ./palmux --port 8080
```

## 3. メモリ使用量を監視

```bash
# 現在のメモリ使用量
cat /sys/fs/cgroup/palmux-test/memory.current

# 人間が読みやすい形式
awk '{printf "%.1f MB\n", $1/1024/1024}' /sys/fs/cgroup/palmux-test/memory.current

# 継続監視（1秒ごと）
watch -n1 'awk "{printf \"%.1f MB\n\", \$1/1024/1024}" /sys/fs/cgroup/palmux-test/memory.current'

# OOM kill イベントを確認
cat /sys/fs/cgroup/palmux-test/memory.events
```

## 4. Go テストにメモリ制限をかける

```bash
# テスト全体にメモリ制限をかける
sudo systemd-run --scope -p MemoryMax=64M go test ./... -v

# 特定のテストだけ
sudo systemd-run --scope -p MemoryMax=32M go test ./internal/server/ -run TestHandleAttach -v
```

## 5. GOMEMLIMIT による Go ランタイムレベルの制限

cgroup とは別に、Go 1.19+ の `GOMEMLIMIT` 環境変数で GC の動作を最適化できる:

```bash
# ヒープサイズを 100MB に制限（ソフトリミット: GC が積極的に動く）
GOMEMLIMIT=100MiB ./palmux --port 8080

# テスト時
GOMEMLIMIT=50MiB go test ./... -v
```

注意: `GOMEMLIMIT` はソフトリミットであり、OOM を完全に防ぐものではない。
cgroup の `memory.max` と組み合わせて使うのが効果的。

## 6. クリーンアップ

```bash
sudo rmdir /sys/fs/cgroup/palmux-test
```
```

**Step 1: ファイルを作成**

上記の内容で `docs/testing-memory-limit.md` を作成。

**Step 2: コミット**

```bash
git add docs/testing-memory-limit.md
git commit -m "docs: add cgroup v2 memory limit testing guide"
```

---

## タスクの依存関係

```
Task 1 (HTTP タイムアウト) ──┐
                              ├──→ Task 2 (Graceful shutdown) ←── Task 1 の httpServer メソッドを使う
Task 3 (cmd.Wait タイムアウト)  (独立)
Task 4 (ボディサイズ制限)       (独立)
Task 5 (診断ログ)             ←── Task 2 の後が望ましい（main.go の変更が重複するため）
Task 6 (WS 読み取り制限)       (独立)
Task 7 (cgroup ドキュメント)    (独立)
```

推奨実行順: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7
