//go:build linux

package server

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

// tiocgptn は Linux の TIOCGPTN ioctl コマンド。
// マスター pty ファイルディスクリプタからスレーブ pts の番号を取得する。
const tiocgptn = 0x80045430

// getPTSName はマスター pty ファイルに対応するスレーブ pts のデバイスパスを返す。
// 取得できない場合は空文字列を返す。
func getPTSName(ptmx *os.File) string {
	var n uint32
	_, _, errno := syscall.Syscall(
		syscall.SYS_IOCTL,
		ptmx.Fd(),
		uintptr(tiocgptn),
		uintptr(unsafe.Pointer(&n)),
	)
	if errno != 0 {
		return ""
	}
	return fmt.Sprintf("/dev/pts/%d", n)
}
