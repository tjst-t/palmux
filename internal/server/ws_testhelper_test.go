package server

import (
	"os"

	"github.com/creack/pty"
)

// createPtyPair はテスト用の pty ペアを作成する。
// ptmx: ハンドラが読み書きする側（マスター）
// pts: テスト側が読み書きする側（スレーブ）
// 実際の pty デバイスを使うため、Go のランタイムと正しく連携する。
func createPtyPair() (ptmx *os.File, pts *os.File, err error) {
	ptmx, pts, err = pty.Open()
	return
}
