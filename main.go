package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/tjst-t/palmux/internal/server"
	"github.com/tjst-t/palmux/internal/tmux"
)

var version = "dev"

func main() {
	showVersion := flag.Bool("version", false, "Show version and exit")
	v := flag.Bool("v", false, "Show version and exit (shorthand)")
	port := flag.Int("port", 8080, "Listen port")
	host := flag.String("host", "0.0.0.0", "Listen address")
	tmuxBin := flag.String("tmux", "tmux", "tmux binary path")
	claudePath := flag.String("claude-path", "claude", "claude command path or wrapper script")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file")
	tlsKey := flag.String("tls-key", "", "TLS private key file")
	token := flag.String("token", "", "Fixed auth token (auto-generated if empty)")
	basePath := flag.String("base-path", "/", "Base path")
	maxConnections := flag.Int("max-connections", 5, "Max simultaneous connections per session")

	flag.Parse()

	if *showVersion || *v {
		fmt.Println("palmux " + version)
		return
	}

	// tmux の存在チェック
	tmuxPath, err := exec.LookPath(*tmuxBin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: tmux not found: %s\n", *tmuxBin)
		os.Exit(1)
	}

	// TLS フラグの検証: 片方だけ指定はエラー
	if (*tlsCert == "") != (*tlsKey == "") {
		fmt.Fprintf(os.Stderr, "Error: both --tls-cert and --tls-key must be specified together\n")
		os.Exit(1)
	}

	// トークン生成（未指定時）
	authToken := *token
	if authToken == "" {
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			fmt.Fprintf(os.Stderr, "Error: failed to generate token: %v\n", err)
			os.Exit(1)
		}
		authToken = hex.EncodeToString(tokenBytes)
	}

	// フロントエンド FS を準備（embed.FS からサブディレクトリを取得）
	frontFS, err := fs.Sub(frontendFS, "frontend/build")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to access embedded frontend: %v\n", err)
		os.Exit(1)
	}

	// tmux Manager を生成
	homeDir, _ := os.UserHomeDir()
	mgr := &tmux.Manager{
		Exec: &tmux.RealExecutor{
			TmuxBin: tmuxPath,
		},
		Ghq: &tmux.GhqResolver{
			Cmd:     &tmux.RealCommandRunner{},
			HomeDir: homeDir,
		},
	}

	// 起動時に残存グループセッションをクリーンアップ
	if cleaned := mgr.CleanupGroupedSessions(); cleaned > 0 {
		log.Printf("Cleaned up %d stale grouped session(s)", cleaned)
	}

	// サーバーを生成
	normalizedBasePath := server.NormalizeBasePath(*basePath)
	srv := server.NewServer(server.Options{
		Tmux:           mgr,
		Token:          authToken,
		BasePath:       normalizedBasePath,
		ClaudePath:     *claudePath,
		Frontend:       frontFS,
		MaxConnections: *maxConnections,
		Version:        version,
	})

	addr := fmt.Sprintf("%s:%d", *host, *port)

	// Hook スクリプト用の env ファイルを書き出す（ポート番号ごとに分離）
	envPath := writeEnvFile(*port, authToken, normalizedBasePath)

	// シグナルハンドラ: 終了時に env ファイルを削除
	if envPath != "" {
		go func() {
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
			<-sigCh
			os.Remove(envPath)
			os.Exit(0)
		}()
	}

	if *tlsCert != "" {
		// TLS 証明書ファイルの存在チェック
		if _, err := os.Stat(*tlsCert); os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "Error: TLS certificate file not found: %s\n", *tlsCert)
			os.Exit(1)
		}
		if _, err := os.Stat(*tlsKey); os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "Error: TLS key file not found: %s\n", *tlsKey)
			os.Exit(1)
		}

		fmt.Printf("Palmux started on %s (TLS) (base path: %s)\n", addr, normalizedBasePath)
		fmt.Printf("Auth token: %s\n", authToken)
		log.Fatal(srv.ListenAndServeTLS(addr, *tlsCert, *tlsKey))
	} else {
		fmt.Printf("Palmux started on %s (base path: %s)\n", addr, normalizedBasePath)
		fmt.Printf("Auth token: %s\n", authToken)
		log.Fatal(srv.ListenAndServe(addr))
	}
}

// writeEnvFile は ~/.config/palmux/env.<port> にサーバー情報を書き出す。
// ポート番号ごとにファイルを分離し、複数インスタンスの同時起動に対応する。
// Claude Code の Hook スクリプトが全 env.* ファイルを source して利用する。
// 書き出したファイルパスを返す（エラー時は空文字列）。
func writeEnvFile(port int, token, basePath string) string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("Warning: cannot determine home directory for env file: %v", err)
		return ""
	}

	dir := filepath.Join(homeDir, ".config", "palmux")
	if err := os.MkdirAll(dir, 0700); err != nil {
		log.Printf("Warning: cannot create config directory %s: %v", dir, err)
		return ""
	}

	envPath := filepath.Join(dir, fmt.Sprintf("env.%d", port))
	content := fmt.Sprintf("export PALMUX_PORT=%d\nexport PALMUX_TOKEN=%s\nexport PALMUX_BASE_PATH=%s\n",
		port, token, basePath)

	if err := os.WriteFile(envPath, []byte(content), 0600); err != nil {
		log.Printf("Warning: cannot write env file %s: %v", envPath, err)
		return ""
	}

	return envPath
}
