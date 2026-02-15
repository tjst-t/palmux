package tmux

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Session は tmux セッションの情報を表す。
type Session struct {
	Name     string    `json:"name"`
	Windows  int       `json:"windows"`
	Attached bool      `json:"attached"`
	Created  time.Time `json:"created"`
}

// Window は tmux ウィンドウの情報を表す。
type Window struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// ParseSessions は tmux list-sessions の出力をパースして Session スライスを返す。
// フォーマット: #{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}
func ParseSessions(data []byte) ([]Session, error) {
	lines := splitLines(data)
	sessions := make([]Session, 0, len(lines))

	for _, line := range lines {
		fields := strings.Split(line, "\t")
		if len(fields) != 4 {
			return nil, fmt.Errorf("invalid session line: expected 4 fields, got %d: %q", len(fields), line)
		}

		windows, err := strconv.Atoi(fields[1])
		if err != nil {
			return nil, fmt.Errorf("invalid session windows count %q: %w", fields[1], err)
		}

		attached, err := strconv.Atoi(fields[2])
		if err != nil {
			return nil, fmt.Errorf("invalid session attached value %q: %w", fields[2], err)
		}

		createdUnix, err := strconv.ParseInt(fields[3], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid session created timestamp %q: %w", fields[3], err)
		}

		sessions = append(sessions, Session{
			Name:     fields[0],
			Windows:  windows,
			Attached: attached != 0,
			Created:  time.Unix(createdUnix, 0),
		})
	}

	return sessions, nil
}

// ParseWindows は tmux list-windows の出力をパースして Window スライスを返す。
// フォーマット: #{window_index}\t#{window_name}\t#{window_active}
func ParseWindows(data []byte) ([]Window, error) {
	lines := splitLines(data)
	windows := make([]Window, 0, len(lines))

	for _, line := range lines {
		fields := strings.Split(line, "\t")
		if len(fields) != 3 {
			return nil, fmt.Errorf("invalid window line: expected 3 fields, got %d: %q", len(fields), line)
		}

		index, err := strconv.Atoi(fields[0])
		if err != nil {
			return nil, fmt.Errorf("invalid window index %q: %w", fields[0], err)
		}

		active, err := strconv.Atoi(fields[2])
		if err != nil {
			return nil, fmt.Errorf("invalid window active value %q: %w", fields[2], err)
		}

		windows = append(windows, Window{
			Index:  index,
			Name:   fields[1],
			Active: active != 0,
		})
	}

	return windows, nil
}

// splitLines は入力バイト列を行に分割し、空行を除外する。
func splitLines(data []byte) []string {
	s := strings.TrimSpace(string(data))
	if s == "" {
		return nil
	}

	lines := strings.Split(s, "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
