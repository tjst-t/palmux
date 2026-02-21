//go:build !linux

package server

import "os"

// getPTSName は Linux 以外では空文字列を返す（Palmux は Linux 専用）。
func getPTSName(ptmx *os.File) string {
	return ""
}
