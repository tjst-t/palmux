package portman

import (
	"encoding/json"
	"os/exec"
)

// Lease は portman のリース情報を表す。
type Lease struct {
	Name     string `json:"name"`
	Project  string `json:"project"`
	Worktree string `json:"worktree"`
	Port     int    `json:"port"`
	Hostname string `json:"hostname"`
	Expose   bool   `json:"expose"`
	Status   string `json:"status"`
	PID      int    `json:"pid"`
	URL      string `json:"url"`
}

// Runner は portman コマンドの実行を抽象化する。
// テスト時にはモック実装を注入する。
type Runner interface {
	ListCurrentDir(dir string) ([]Lease, error)
}

// RealRunner は実際の portman バイナリを実行する。
type RealRunner struct{}

// ListCurrentDir は指定ディレクトリで portman list -c --json を実行し、リース一覧を返す。
func (r *RealRunner) ListCurrentDir(dir string) ([]Lease, error) {
	cmd := exec.Command("portman", "list", "-c", "--json")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parseLeasesJSON(out)
}

// parseLeasesJSON は portman list の JSON 出力をパースする。
func parseLeasesJSON(data []byte) ([]Lease, error) {
	var leases []Lease
	if err := json.Unmarshal(data, &leases); err != nil {
		return nil, err
	}
	return leases, nil
}
