package fileserver

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupTestDir はテスト用のディレクトリ構造を作成する。
//
//	root/
//	  file.txt         (テキストファイル)
//	  README.md        (マークダウン)
//	  .hidden          (隠しファイル)
//	  .gitignore       (dotfileだが.gitディレクトリではない)
//	  subdir/
//	    nested.txt
//	  .git/
//	    config         (.gitディレクトリ内のファイル)
//	  emptydir/
func setupTestDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()

	// file.txt
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("hello world"), 0644); err != nil {
		t.Fatal(err)
	}
	// README.md
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Title"), 0644); err != nil {
		t.Fatal(err)
	}
	// .hidden
	if err := os.WriteFile(filepath.Join(root, ".hidden"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	// .gitignore
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("build/"), 0644); err != nil {
		t.Fatal(err)
	}
	// subdir/nested.txt
	if err := os.MkdirAll(filepath.Join(root, "subdir"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "subdir", "nested.txt"), []byte("nested"), 0644); err != nil {
		t.Fatal(err)
	}
	// .git/config
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "config"), []byte("[core]"), 0644); err != nil {
		t.Fatal(err)
	}
	// emptydir/
	if err := os.MkdirAll(filepath.Join(root, "emptydir"), 0755); err != nil {
		t.Fatal(err)
	}

	return root
}

// --- ValidatePath テスト ---

func TestValidatePath(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	tests := []struct {
		name    string
		relPath string
		wantErr bool
	}{
		{
			name:    "正常: ルート直下のファイル",
			relPath: "file.txt",
			wantErr: false,
		},
		{
			name:    "正常: ドット（ルート自身）",
			relPath: ".",
			wantErr: false,
		},
		{
			name:    "正常: サブディレクトリ",
			relPath: "subdir",
			wantErr: false,
		},
		{
			name:    "正常: ネストしたファイル",
			relPath: "subdir/nested.txt",
			wantErr: false,
		},
		{
			name:    "拒否: ../でルート外アクセス",
			relPath: "../../../etc/passwd",
			wantErr: true,
		},
		{
			name:    "拒否: ..でルート外アクセス",
			relPath: "..",
			wantErr: true,
		},
		{
			name:    "拒否: 絶対パスによるルート外アクセス",
			relPath: "/etc/passwd",
			wantErr: true,
		},
		{
			name:    "エラー: 存在しないファイル",
			relPath: "nonexistent.txt",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := fs.ValidatePath(tt.relPath)
			if tt.wantErr && err == nil {
				t.Errorf("ValidatePath(%q) = nil error, want error", tt.relPath)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("ValidatePath(%q) = %v, want nil", tt.relPath, err)
			}
		})
	}
}

func TestValidatePath_Symlink(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	// ルート内シンボリックリンク: root/link-inside → root/subdir
	insideLink := filepath.Join(root, "link-inside")
	if err := os.Symlink(filepath.Join(root, "subdir"), insideLink); err != nil {
		t.Skip("symlinks not supported on this platform")
	}

	// ルート外シンボリックリンク: root/link-outside → /tmp
	outsideLink := filepath.Join(root, "link-outside")
	if err := os.Symlink("/tmp", outsideLink); err != nil {
		t.Fatal(err)
	}

	t.Run("ルート内シンボリックリンク: OK", func(t *testing.T) {
		_, err := fs.ValidatePath("link-inside")
		if err != nil {
			t.Errorf("ValidatePath(link-inside) = %v, want nil", err)
		}
	})

	t.Run("ルート外シンボリックリンク: エラー", func(t *testing.T) {
		_, err := fs.ValidatePath("link-outside")
		if err == nil {
			t.Error("ValidatePath(link-outside) = nil, want error")
		}
	})
}

func TestValidatePath_InvalidRoot(t *testing.T) {
	fs := &FileServer{RootDir: "/nonexistent/root/path"}

	_, err := fs.ValidatePath("file.txt")
	if err == nil {
		t.Error("ValidatePath with invalid root should return error")
	}
}

// --- List テスト ---

func TestList(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	t.Run("ルートディレクトリの一覧", func(t *testing.T) {
		listing, err := fs.List(".")
		if err != nil {
			t.Fatalf("List(\".\") = %v", err)
		}

		if listing.Path != "." {
			t.Errorf("Path = %q, want %q", listing.Path, ".")
		}

		// エントリ名を収集
		names := make([]string, len(listing.Entries))
		for i, e := range listing.Entries {
			names[i] = e.Name
		}

		// .gitディレクトリ自体は一覧に含まれる
		found := false
		for _, n := range names {
			if n == ".git" {
				found = true
				break
			}
		}
		if !found {
			t.Error(".git directory should be listed (but not its contents)")
		}

		// .hidden, .gitignore は含まれる
		for _, want := range []string{".hidden", ".gitignore"} {
			found := false
			for _, n := range names {
				if n == want {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("%q should be in listing", want)
			}
		}
	})

	t.Run("ソート: ディレクトリ優先、名前昇順", func(t *testing.T) {
		listing, err := fs.List(".")
		if err != nil {
			t.Fatalf("List(\".\") = %v", err)
		}

		// 先頭のエントリはディレクトリであること
		firstFileIdx := -1
		for i, e := range listing.Entries {
			if !e.IsDir {
				firstFileIdx = i
				break
			}
		}
		if firstFileIdx < 0 {
			t.Fatal("no files found in listing")
		}

		// ディレクトリ部分がソートされていること
		for i := 1; i < firstFileIdx; i++ {
			if listing.Entries[i].Name < listing.Entries[i-1].Name {
				t.Errorf("directories not sorted: %q < %q", listing.Entries[i].Name, listing.Entries[i-1].Name)
			}
		}

		// ファイル部分がソートされていること
		for i := firstFileIdx + 1; i < len(listing.Entries); i++ {
			if listing.Entries[i].IsDir {
				t.Errorf("file %q followed by dir %q at index %d", listing.Entries[i-1].Name, listing.Entries[i].Name, i)
			}
			if listing.Entries[i].Name < listing.Entries[i-1].Name {
				t.Errorf("files not sorted: %q < %q", listing.Entries[i].Name, listing.Entries[i-1].Name)
			}
		}
	})

	t.Run(".gitディレクトリの中身は除外", func(t *testing.T) {
		listing, err := fs.List(".git")
		if err != nil {
			t.Fatalf("List(\".git\") = %v", err)
		}

		if len(listing.Entries) != 0 {
			t.Errorf("expected empty listing for .git directory, got %d entries", len(listing.Entries))
		}
	})

	t.Run("サブディレクトリの一覧", func(t *testing.T) {
		listing, err := fs.List("subdir")
		if err != nil {
			t.Fatalf("List(\"subdir\") = %v", err)
		}

		if len(listing.Entries) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(listing.Entries))
		}

		if listing.Entries[0].Name != "nested.txt" {
			t.Errorf("entry name = %q, want %q", listing.Entries[0].Name, "nested.txt")
		}
	})

	t.Run("空ディレクトリ", func(t *testing.T) {
		listing, err := fs.List("emptydir")
		if err != nil {
			t.Fatalf("List(\"emptydir\") = %v", err)
		}

		if len(listing.Entries) != 0 {
			t.Errorf("expected 0 entries, got %d", len(listing.Entries))
		}
	})

	t.Run("存在しないディレクトリ", func(t *testing.T) {
		_, err := fs.List("nonexistent")
		if err == nil {
			t.Error("List(\"nonexistent\") should return error")
		}
	})

	t.Run("ファイルパスを渡した場合はエラー", func(t *testing.T) {
		_, err := fs.List("file.txt")
		if err == nil {
			t.Error("List(\"file.txt\") should return error (not a directory)")
		}
	})

	t.Run("DirEntryのフィールド検証", func(t *testing.T) {
		listing, err := fs.List(".")
		if err != nil {
			t.Fatalf("List(\".\") = %v", err)
		}

		// file.txt を探す
		for _, e := range listing.Entries {
			if e.Name == "file.txt" {
				if e.IsDir {
					t.Error("file.txt should not be a directory")
				}
				if e.Size != int64(len("hello world")) {
					t.Errorf("file.txt size = %d, want %d", e.Size, len("hello world"))
				}
				if e.Extension != ".txt" {
					t.Errorf("file.txt extension = %q, want %q", e.Extension, ".txt")
				}
				if e.ModTime.IsZero() {
					t.Error("file.txt mod_time should not be zero")
				}
				return
			}
		}
		t.Error("file.txt not found in listing")
	})
}

// --- Read テスト ---

func TestRead(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	t.Run("テキストファイルの読み取り", func(t *testing.T) {
		fc, err := fs.Read("file.txt")
		if err != nil {
			t.Fatalf("Read(\"file.txt\") = %v", err)
		}

		if fc.Path != "file.txt" {
			t.Errorf("Path = %q, want %q", fc.Path, "file.txt")
		}
		if fc.IsDir {
			t.Error("IsDir should be false")
		}
		if fc.Content != "hello world" {
			t.Errorf("Content = %q, want %q", fc.Content, "hello world")
		}
		if fc.ContentType != "text" {
			t.Errorf("ContentType = %q, want %q", fc.ContentType, "text")
		}
		if fc.Truncated {
			t.Error("Truncated should be false")
		}
		if fc.Extension != ".txt" {
			t.Errorf("Extension = %q, want %q", fc.Extension, ".txt")
		}
		if fc.Size != int64(len("hello world")) {
			t.Errorf("Size = %d, want %d", fc.Size, len("hello world"))
		}
	})

	t.Run("マークダウンファイルの読み取り", func(t *testing.T) {
		fc, err := fs.Read("README.md")
		if err != nil {
			t.Fatalf("Read(\"README.md\") = %v", err)
		}

		if fc.Content != "# Title" {
			t.Errorf("Content = %q, want %q", fc.Content, "# Title")
		}
		if fc.ContentType != "text" {
			t.Errorf("ContentType = %q, want %q", fc.ContentType, "text")
		}
		if fc.Extension != ".md" {
			t.Errorf("Extension = %q, want %q", fc.Extension, ".md")
		}
	})

	t.Run("大きいファイル: 1MB超過でtruncated", func(t *testing.T) {
		// 2MB のファイルを作成
		bigContent := strings.Repeat("A", 2*1024*1024)
		bigFile := filepath.Join(root, "big.txt")
		if err := os.WriteFile(bigFile, []byte(bigContent), 0644); err != nil {
			t.Fatal(err)
		}

		fc, err := fs.Read("big.txt")
		if err != nil {
			t.Fatalf("Read(\"big.txt\") = %v", err)
		}

		if !fc.Truncated {
			t.Error("Truncated should be true for 2MB file")
		}
		if len(fc.Content) != 1024*1024 {
			t.Errorf("Content length = %d, want %d (1MB)", len(fc.Content), 1024*1024)
		}
		if fc.Size != int64(2*1024*1024) {
			t.Errorf("Size = %d, want %d (original size)", fc.Size, 2*1024*1024)
		}
	})

	t.Run("バイナリファイル判定", func(t *testing.T) {
		// バイナリデータを作成（null バイト含む）
		binaryData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A} // PNG ヘッダ
		binaryFile := filepath.Join(root, "test.png")
		if err := os.WriteFile(binaryFile, binaryData, 0644); err != nil {
			t.Fatal(err)
		}

		fc, err := fs.Read("test.png")
		if err != nil {
			t.Fatalf("Read(\"test.png\") = %v", err)
		}

		if fc.ContentType != "image" {
			t.Errorf("ContentType = %q, want %q", fc.ContentType, "image")
		}
		// バイナリファイルの場合、Content は空
		if fc.Content != "" {
			t.Error("Content should be empty for binary files")
		}
	})

	t.Run("バイナリファイル: 画像以外はbinary", func(t *testing.T) {
		// ZIP ファイルのマジックバイト
		zipData := []byte{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00}
		zipFile := filepath.Join(root, "archive.zip")
		if err := os.WriteFile(zipFile, zipData, 0644); err != nil {
			t.Fatal(err)
		}

		fc, err := fs.Read("archive.zip")
		if err != nil {
			t.Fatalf("Read(\"archive.zip\") = %v", err)
		}

		if fc.ContentType != "binary" {
			t.Errorf("ContentType = %q, want %q", fc.ContentType, "binary")
		}
	})

	t.Run("存在しないファイル", func(t *testing.T) {
		_, err := fs.Read("nonexistent.txt")
		if err == nil {
			t.Error("Read(\"nonexistent.txt\") should return error")
		}
	})

	t.Run("ディレクトリの場合", func(t *testing.T) {
		fc, err := fs.Read("subdir")
		if err != nil {
			t.Fatalf("Read(\"subdir\") = %v", err)
		}

		if !fc.IsDir {
			t.Error("IsDir should be true for directory")
		}
	})
}

// --- RawFile テスト ---

func TestRawFile(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	t.Run("テキストファイルの生データ", func(t *testing.T) {
		rc, contentType, err := fs.RawFile("file.txt")
		if err != nil {
			t.Fatalf("RawFile(\"file.txt\") = %v", err)
		}
		defer rc.Close()

		data, err := io.ReadAll(rc)
		if err != nil {
			t.Fatal(err)
		}

		if string(data) != "hello world" {
			t.Errorf("data = %q, want %q", string(data), "hello world")
		}

		if contentType == "" {
			t.Error("contentType should not be empty")
		}
	})

	t.Run("バイナリファイルの生データ", func(t *testing.T) {
		binaryData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
		binaryFile := filepath.Join(root, "raw.png")
		if err := os.WriteFile(binaryFile, binaryData, 0644); err != nil {
			t.Fatal(err)
		}

		rc, contentType, err := fs.RawFile("raw.png")
		if err != nil {
			t.Fatalf("RawFile(\"raw.png\") = %v", err)
		}
		defer rc.Close()

		data, err := io.ReadAll(rc)
		if err != nil {
			t.Fatal(err)
		}

		if len(data) != len(binaryData) {
			t.Errorf("data length = %d, want %d", len(data), len(binaryData))
		}

		if !strings.Contains(contentType, "image") {
			t.Errorf("contentType = %q, should contain 'image'", contentType)
		}
	})

	t.Run("存在しないファイル", func(t *testing.T) {
		_, _, err := fs.RawFile("nonexistent.txt")
		if err == nil {
			t.Error("RawFile(\"nonexistent.txt\") should return error")
		}
	})

	t.Run("パストラバーサル: エラー", func(t *testing.T) {
		_, _, err := fs.RawFile("../../etc/passwd")
		if err == nil {
			t.Error("RawFile(\"../../etc/passwd\") should return error")
		}
	})
}

// --- パストラバーサル統合テスト ---

func TestPathTraversal(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	attacks := []string{
		"../../etc/passwd",
		"../../../etc/shadow",
		"..%2F..%2Fetc%2Fpasswd",
		"subdir/../../etc/passwd",
		"/etc/passwd",
		"....//....//etc/passwd",
	}

	for _, path := range attacks {
		t.Run("List: "+path, func(t *testing.T) {
			_, err := fs.List(path)
			if err == nil {
				t.Errorf("List(%q) should return error", path)
			}
		})

		t.Run("Read: "+path, func(t *testing.T) {
			_, err := fs.Read(path)
			if err == nil {
				t.Errorf("Read(%q) should return error", path)
			}
		})

		t.Run("RawFile: "+path, func(t *testing.T) {
			_, _, err := fs.RawFile(path)
			if err == nil {
				t.Errorf("RawFile(%q) should return error", path)
			}
		})
	}
}

// --- isTextContent テスト ---

func TestIsTextContent(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{
			name: "テキストデータ: ヌルバイトなし",
			data: []byte("package main\n\nfunc main() {}"),
			want: true,
		},
		{
			name: "バイナリデータ: ヌルバイトあり",
			data: []byte{0x89, 0x50, 0x4E, 0x47, 0x00, 0x0A},
			want: false,
		},
		{
			name: "空データ",
			data: []byte{},
			want: true,
		},
		{
			name: "ヌルバイトのみ",
			data: []byte{0x00},
			want: false,
		},
		{
			name: "UTF-8マルチバイト文字",
			data: []byte("こんにちは世界"),
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isTextContent(tt.data)
			if got != tt.want {
				t.Errorf("isTextContent() = %v, want %v", got, tt.want)
			}
		})
	}
}

// --- Write テスト ---

func TestWrite(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	tests := []struct {
		name        string
		relPath     string
		content     []byte
		wantErr     bool
		wantErrIs   error
		wantContent string // 書き込み後の期待内容
	}{
		{
			name:        "正常: テキストファイル書き込み",
			relPath:     "file.txt",
			content:     []byte("updated content"),
			wantErr:     false,
			wantContent: "updated content",
		},
		{
			name:        "正常: ネストファイル書き込み",
			relPath:     "subdir/nested.txt",
			content:     []byte("new nested content"),
			wantErr:     false,
			wantContent: "new nested content",
		},
		{
			name:        "正常: 空コンテンツ",
			relPath:     "file.txt",
			content:     []byte(""),
			wantErr:     false,
			wantContent: "",
		},
		{
			name:        "正常: UTF-8コンテンツ",
			relPath:     "file.txt",
			content:     []byte("こんにちは世界🌍"),
			wantErr:     false,
			wantContent: "こんにちは世界🌍",
		},
		{
			name:      "拒否: ディレクトリ",
			relPath:   "subdir",
			content:   []byte("data"),
			wantErr:   true,
			wantErrIs: ErrIsDirectory,
		},
		{
			name:      "拒否: 存在しないファイル",
			relPath:   "nonexistent.txt",
			content:   []byte("data"),
			wantErr:   true,
			wantErrIs: os.ErrNotExist,
		},
		{
			name:    "拒否: パストラバーサル",
			relPath: "../../etc/passwd",
			content: []byte("data"),
			wantErr: true,
		},
		{
			name:      "拒否: 絶対パス",
			relPath:   "/etc/passwd",
			content:   []byte("data"),
			wantErr:   true,
			wantErrIs: ErrAbsolutePath,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := fs.Write(tt.relPath, tt.content)
			if tt.wantErr {
				if err == nil {
					t.Errorf("Write(%q) = nil, want error", tt.relPath)
				}
				if tt.wantErrIs != nil && !errors.Is(err, tt.wantErrIs) {
					t.Errorf("Write(%q) error = %v, want %v", tt.relPath, err, tt.wantErrIs)
				}
				return
			}
			if err != nil {
				t.Fatalf("Write(%q) = %v, want nil", tt.relPath, err)
			}

			// 書き込み内容を検証
			absPath, _ := fs.ValidatePath(tt.relPath)
			data, err := os.ReadFile(absPath)
			if err != nil {
				t.Fatalf("ReadFile(%q) = %v", absPath, err)
			}
			if string(data) != tt.wantContent {
				t.Errorf("content = %q, want %q", string(data), tt.wantContent)
			}
		})
	}
}

func TestWrite_FileTooLarge(t *testing.T) {
	root := t.TempDir()
	fs := &FileServer{RootDir: root}

	// 書き込み先ファイルを作成
	if err := os.WriteFile(filepath.Join(root, "target.txt"), []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}

	// 1MB + 1 バイトのコンテンツ
	bigContent := make([]byte, 1024*1024+1)
	for i := range bigContent {
		bigContent[i] = 'A'
	}

	err := fs.Write("target.txt", bigContent)
	if err == nil {
		t.Fatal("Write should return error for content > 1MB")
	}
	if !errors.Is(err, ErrFileTooLarge) {
		t.Errorf("error = %v, want ErrFileTooLarge", err)
	}

	// 元のファイルが変更されていないことを確認
	data, err := os.ReadFile(filepath.Join(root, "target.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "original" {
		t.Errorf("original file was modified: %q", string(data))
	}
}

func TestWrite_PreservesPermissions(t *testing.T) {
	root := t.TempDir()
	fs := &FileServer{RootDir: root}

	// 0600 のパーミッションでファイルを作成
	filePath := filepath.Join(root, "restricted.txt")
	if err := os.WriteFile(filePath, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}

	err := fs.Write("restricted.txt", []byte("updated"))
	if err != nil {
		t.Fatalf("Write = %v", err)
	}

	// パーミッションが保持されていることを確認
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Errorf("permissions = %o, want %o", info.Mode().Perm(), 0600)
	}

	// 内容が更新されていることを確認
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "updated" {
		t.Errorf("content = %q, want %q", string(data), "updated")
	}
}

// --- ソースコードファイルのテキスト判定テスト ---

func TestRead_SourceCodeFiles(t *testing.T) {
	root := t.TempDir()
	fs := &FileServer{RootDir: root}

	tests := []struct {
		name    string
		file    string
		content string
	}{
		{
			name:    "Goソースコード",
			file:    "main.go",
			content: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"hello\")\n}\n",
		},
		{
			name:    "Pythonソースコード",
			file:    "script.py",
			content: "#!/usr/bin/env python3\nprint('hello')\n",
		},
		{
			name:    "JavaScriptソースコード",
			file:    "app.js",
			content: "const x = 42;\nconsole.log(x);\n",
		},
		{
			name:    "シェルスクリプト",
			file:    "run.sh",
			content: "#!/bin/bash\necho 'hello'\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(root, tt.file), []byte(tt.content), 0644); err != nil {
				t.Fatal(err)
			}

			fc, err := fs.Read(tt.file)
			if err != nil {
				t.Fatalf("Read(%q) = %v", tt.file, err)
			}

			if fc.ContentType != "text" {
				t.Errorf("ContentType = %q, want %q for source code file %s", fc.ContentType, "text", tt.file)
			}
			if fc.Content != tt.content {
				t.Errorf("Content = %q, want %q", fc.Content, tt.content)
			}
		})
	}
}

// --- センチネルエラーテスト ---

func TestSentinelErrors(t *testing.T) {
	root := setupTestDir(t)
	fs := &FileServer{RootDir: root}

	t.Run("絶対パス → ErrAbsolutePath", func(t *testing.T) {
		_, err := fs.ValidatePath("/etc/passwd")
		if err == nil {
			t.Fatal("expected error")
		}
		if !errors.Is(err, ErrAbsolutePath) {
			t.Errorf("error should wrap ErrAbsolutePath, got: %v", err)
		}
	})

	t.Run("ルート外パス → ErrPathOutsideRoot", func(t *testing.T) {
		_, err := fs.ValidatePath("../..")
		if err == nil {
			t.Fatal("expected error")
		}
		if !errors.Is(err, ErrPathOutsideRoot) {
			t.Errorf("error should wrap ErrPathOutsideRoot, got: %v", err)
		}
	})

	t.Run("ファイルにListを呼ぶ → ErrNotDirectory", func(t *testing.T) {
		_, err := fs.List("file.txt")
		if err == nil {
			t.Fatal("expected error")
		}
		if !errors.Is(err, ErrNotDirectory) {
			t.Errorf("error should wrap ErrNotDirectory, got: %v", err)
		}
	})
}
