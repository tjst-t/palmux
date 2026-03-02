package lsp

// ServerStatus は言語サーバーの状態を表す。
type ServerStatus string

const (
	StatusStarting ServerStatus = "starting"
	StatusReady    ServerStatus = "ready"
	StatusStopped  ServerStatus = "stopped"
	StatusError    ServerStatus = "error"
)

// ServerConfig は言語サーバーの設定を表す。
type ServerConfig struct {
	Language string   `json:"language"`
	Command  string   `json:"command"`
	Args     []string `json:"args"`
	Enabled  bool     `json:"enabled"`
}

// Config は LSP マネージャーの設定を表す。
type Config struct {
	Servers []ServerConfig `json:"servers"`
}

// ServerInfo はサーバーのステータス報告用の構造体。
type ServerInfo struct {
	Language string       `json:"language"`
	Status   ServerStatus `json:"status"`
	Server   string       `json:"server"`
	RootDir  string       `json:"root_dir"`
}
