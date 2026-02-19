package fileserver

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxReadSize = 1024 * 1024 // 1MB

var (
	ErrPathOutsideRoot = errors.New("path outside root")
	ErrAbsolutePath    = errors.New("absolute path not allowed")
	ErrNotDirectory    = errors.New("not a directory")
	ErrIsDirectory     = errors.New("is a directory")
	ErrFileTooLarge    = errors.New("file too large")
)

// DirEntry はディレクトリ内のエントリ（ファイルまたはサブディレクトリ）を表す。
type DirEntry struct {
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	IsDir     bool      `json:"is_dir"`
	ModTime   time.Time `json:"mod_time"`
	Extension string    `json:"extension,omitempty"`
}

// DirListing はディレクトリの一覧情報を表す。
type DirListing struct {
	Path    string     `json:"path"`
	AbsPath string    `json:"abs_path"`
	Entries []DirEntry `json:"entries"`
}

// FileContent はファイルの内容情報を表す。
type FileContent struct {
	Path        string `json:"path"`
	AbsPath     string `json:"abs_path"`
	IsDir       bool   `json:"is_dir"`
	Size        int64  `json:"size"`
	Extension   string `json:"extension,omitempty"`
	Content     string `json:"content,omitempty"`
	ContentType string `json:"content_type"`
	Truncated   bool   `json:"truncated,omitempty"`
}

// FileServer はファイルの一覧と読み取りを提供する。
type FileServer struct {
	RootDir string
}

// ValidatePath はパストラバーサルを防止するパス検証を行う。
// filepath.Clean → filepath.Join(root, cleaned) → filepath.EvalSymlinks → ルート外なら error。
func (fs *FileServer) ValidatePath(relPath string) (string, error) {
	// ルートを実パスに解決
	rootReal, err := filepath.EvalSymlinks(fs.RootDir)
	if err != nil {
		return "", fmt.Errorf("resolve root: %w", err)
	}
	rootReal = filepath.Clean(rootReal)

	// 絶対パスの場合はルート外アクセスとして拒否
	if filepath.IsAbs(relPath) {
		return "", fmt.Errorf("validate path: %w", ErrAbsolutePath)
	}

	// パスをクリーンアップして結合
	cleaned := filepath.Clean(relPath)
	joined := filepath.Join(rootReal, cleaned)

	// シンボリックリンクを解決
	resolved, err := filepath.EvalSymlinks(joined)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}

	// 解決後のパスがルート内であることを検証
	// ルートそのものか、ルート+セパレータで始まるか
	if resolved != rootReal && !strings.HasPrefix(resolved, rootReal+string(filepath.Separator)) {
		return "", fmt.Errorf("validate path: %w", ErrPathOutsideRoot)
	}

	return resolved, nil
}

// List はディレクトリの一覧を返す。
// ソートはディレクトリ優先、名前昇順。
// 隠しファイル（.始まり）は含めるが、.gitディレクトリの中身は除外。
func (fs *FileServer) List(relPath string) (*DirListing, error) {
	absPath, err := fs.ValidatePath(relPath)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("list: %w", ErrNotDirectory)
	}

	// .git ディレクトリの中身は除外
	if isGitDir(relPath) {
		return &DirListing{
			Path:    relPath,
			AbsPath: absPath,
			Entries: []DirEntry{},
		}, nil
	}

	dirEntries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, fmt.Errorf("read directory: %w", err)
	}

	entries := make([]DirEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		fi, err := de.Info()
		if err != nil {
			continue // スキップ
		}

		ext := ""
		if !de.IsDir() {
			ext = filepath.Ext(de.Name())
		}

		entries = append(entries, DirEntry{
			Name:      de.Name(),
			Size:      fi.Size(),
			IsDir:     de.IsDir(),
			ModTime:   fi.ModTime(),
			Extension: ext,
		})
	}

	// ディレクトリ優先、名前昇順でソート
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir // ディレクトリ優先
		}
		return entries[i].Name < entries[j].Name
	})

	return &DirListing{
		Path:    relPath,
		AbsPath: absPath,
		Entries: entries,
	}, nil
}

// Read はファイルの内容を返す。
// テキストファイルは UTF-8 として内容を返す（最大 1MB）。
// バイナリ判定は先頭 512 バイトの http.DetectContentType で行う。
func (fs *FileServer) Read(relPath string) (*FileContent, error) {
	absPath, err := fs.ValidatePath(relPath)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}

	ext := ""
	if !info.IsDir() {
		ext = filepath.Ext(info.Name())
	}

	fc := &FileContent{
		Path:    relPath,
		AbsPath: absPath,
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		Extension: ext,
	}

	// ディレクトリの場合はメタ情報のみ返す
	if info.IsDir() {
		fc.ContentType = "text"
		return fc, nil
	}

	// ファイルを開く
	f, err := os.Open(absPath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	// 先頭 512 バイトを読んでコンテンツタイプを判定
	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("read header: %w", err)
	}
	header = header[:n]

	detectedType := http.DetectContentType(header)
	fc.ContentType = classifyContentType(detectedType)

	// classifyContentType が "binary" を返した場合、ヌルバイトチェックで再判定
	// ソースコードファイル (.go, .js, .py 等) は application/octet-stream と検出されるため
	if fc.ContentType == "binary" && isTextContent(header) {
		fc.ContentType = "text"
	}

	// バイナリファイルの場合は内容を返さない
	if fc.ContentType != "text" {
		return fc, nil
	}

	// テキストファイルの場合、先頭から読み直し
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek file: %w", err)
	}

	if info.Size() <= maxReadSize {
		data, err := io.ReadAll(f)
		if err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		fc.Content = string(data)
	} else {
		// 1MB 超過: 先頭 1MB + truncated
		data := make([]byte, maxReadSize)
		if _, err := io.ReadFull(f, data); err != nil {
			return nil, fmt.Errorf("read file: %w", err)
		}
		fc.Content = string(data)
		fc.Truncated = true
	}

	return fc, nil
}

// RawFile はファイルの生データを io.ReadCloser で返す。
// 第2戻り値は Content-Type 文字列。
func (fs *FileServer) RawFile(relPath string) (io.ReadCloser, string, error) {
	absPath, err := fs.ValidatePath(relPath)
	if err != nil {
		return nil, "", err
	}

	f, err := os.Open(absPath)
	if err != nil {
		return nil, "", err
	}

	// 先頭 512 バイトを読んでコンテンツタイプを判定
	header := make([]byte, 512)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		f.Close()
		return nil, "", fmt.Errorf("read header: %w", err)
	}
	header = header[:n]

	detectedType := http.DetectContentType(header)

	// ファイルを先頭に巻き戻す
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		return nil, "", fmt.Errorf("seek file: %w", err)
	}

	return f, detectedType, nil
}

// Write はファイルに内容を書き込む。
// Atomic write（一時ファイル + rename）でデータ破損を防止する。
// 元ファイルのパーミッションを保持する。
func (fs *FileServer) Write(relPath string, content []byte) error {
	absPath, err := fs.ValidatePath(relPath)
	if err != nil {
		return err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return err
	}

	if info.IsDir() {
		return fmt.Errorf("write: %w", ErrIsDirectory)
	}

	if len(content) > maxReadSize {
		return fmt.Errorf("write: %w", ErrFileTooLarge)
	}

	// 元ファイルのパーミッションを取得
	perm := info.Mode().Perm()

	// Atomic write: 同じディレクトリに一時ファイルを作成して rename
	dir := filepath.Dir(absPath)
	tmp, err := os.CreateTemp(dir, ".palmux-write-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmp.Name()

	// エラー時に一時ファイルを削除
	defer func() {
		if tmpPath != "" {
			os.Remove(tmpPath)
		}
	}()

	if _, err := tmp.Write(content); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	// パーミッションを設定
	if err := os.Chmod(tmpPath, perm); err != nil {
		return fmt.Errorf("chmod temp file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, absPath); err != nil {
		return fmt.Errorf("rename temp file: %w", err)
	}

	// rename 成功後は一時ファイル削除不要
	tmpPath = ""
	return nil
}

// classifyContentType は http.DetectContentType の結果を "text", "image", "binary" に分類する。
func classifyContentType(contentType string) string {
	if strings.HasPrefix(contentType, "text/") {
		return "text"
	}
	if strings.HasPrefix(contentType, "image/") {
		return "image"
	}
	// application/xml, application/json 等もテキストとして扱う
	if strings.Contains(contentType, "xml") || strings.Contains(contentType, "json") {
		return "text"
	}
	return "binary"
}

// isTextContent はデータにヌルバイト (0x00) が含まれていないかチェックする。
// ヌルバイトがなければテキストファイルとみなす。
// ソースコードファイル (.go, .js, .py 等) は http.DetectContentType が
// application/octet-stream を返すため、このフォールバックで正しくテキスト判定する。
func isTextContent(data []byte) bool {
	return !bytes.Contains(data, []byte{0})
}

// isGitDir は指定パスが .git ディレクトリ（またはそのサブディレクトリ）かどうかを判定する。
func isGitDir(relPath string) bool {
	cleaned := filepath.Clean(relPath)
	parts := strings.Split(cleaned, string(filepath.Separator))
	for _, part := range parts {
		if part == ".git" {
			return true
		}
	}
	return false
}
