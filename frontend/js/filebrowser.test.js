// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- モック ---

vi.mock('./api.js', () => ({
  getSessionCwd: vi.fn(),
  listFiles: vi.fn(),
  getFileContent: vi.fn(),
  getFileRawURL: vi.fn(),
}));

vi.mock('./file-preview.js', () => ({
  FilePreview: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

import { FileBrowser } from './filebrowser.js';
import { getSessionCwd, listFiles } from './api.js';

// --- ヘルパー ---

/** テスト用のコンテナ要素を作成する */
function createContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** listFiles の戻り値を作成するヘルパー */
function makeListResult(path, entries = []) {
  return { path, abs_path: '/home/user/project/' + path, entries };
}

/** ディレクトリエントリを作成するヘルパー */
function dirEntry(name) {
  return { name, is_dir: true, size: 0, mod_time: '', extension: '' };
}

/** ファイルエントリを作成するヘルパー */
function fileEntry(name, ext = '') {
  return { name, is_dir: false, size: 100, mod_time: '2025-01-01T00:00:00Z', extension: ext };
}

// --- テスト ---

describe('FileBrowser', () => {
  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    container = createContainer();

    // デフォルトのモック応答
    getSessionCwd.mockResolvedValue({ path: '/home/user/project' });
    listFiles.mockResolvedValue(makeListResult('.', [
      dirEntry('internal'),
      dirEntry('frontend'),
      fileEntry('README.md', '.md'),
    ]));
  });

  describe('open', () => {
    it('セッションの CWD を取得してルートディレクトリを表示する', async () => {
      const browser = new FileBrowser(container);
      await browser.open('main');

      expect(getSessionCwd).toHaveBeenCalledWith('main');
      expect(listFiles).toHaveBeenCalledWith('main', '.');
      expect(browser.getCurrentPath()).toBe('.');
    });

    it('initialPath を指定すると指定パスで開く', async () => {
      listFiles.mockResolvedValue(makeListResult('internal/server', [
        fileEntry('server.go', '.go'),
      ]));

      const browser = new FileBrowser(container);
      await browser.open('main', 'internal/server');

      expect(listFiles).toHaveBeenCalledWith('main', 'internal/server');
      expect(browser.getCurrentPath()).toBe('internal/server');
    });

    it('open 時は onNavigate を呼ばない（silent）', async () => {
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main');

      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('initialPath 指定時も onNavigate を呼ばない（silent）', async () => {
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
      ]));
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main', 'internal');

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentPath', () => {
    it('初期状態では "." を返す', () => {
      const browser = new FileBrowser(container);
      expect(browser.getCurrentPath()).toBe('.');
    });

    it('ディレクトリ読み込み後は読み込んだパスを返す', async () => {
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
      ]));
      const browser = new FileBrowser(container);
      await browser.open('main', 'internal');

      expect(browser.getCurrentPath()).toBe('internal');
    });
  });

  describe('navigateTo', () => {
    it('指定パスに移動する', async () => {
      const browser = new FileBrowser(container);
      await browser.open('main');

      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
        dirEntry('tmux'),
      ]));
      await browser.navigateTo('internal');

      expect(listFiles).toHaveBeenCalledWith('main', 'internal');
      expect(browser.getCurrentPath()).toBe('internal');
    });

    it('onNavigate を呼ばない（silent）', async () => {
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main');

      listFiles.mockResolvedValue(makeListResult('internal', []));
      await browser.navigateTo('internal');

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe('ユーザー起点のディレクトリ移動', () => {
    it('ディレクトリをタップすると onNavigate が呼ばれる', async () => {
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main');

      // "internal" ディレクトリの応答を設定
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
      ]));

      // ディレクトリエントリをクリック
      const dirEntries = container.querySelectorAll('.fb-entry--dir');
      expect(dirEntries.length).toBeGreaterThan(0);
      dirEntries[0].click();

      // 非同期で _loadDirectory が完了するのを待つ
      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('internal');
      });
    });

    it('パンくずリストをクリックすると onNavigate が呼ばれる', async () => {
      // まず internal/server まで移動
      listFiles
        .mockResolvedValueOnce(makeListResult('internal/server', [
          fileEntry('server.go', '.go'),
        ]));

      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main', 'internal/server');

      // パンくずのルート（プロジェクト名）をクリック
      listFiles.mockResolvedValue(makeListResult('.', [
        dirEntry('internal'),
      ]));

      const breadcrumbItems = container.querySelectorAll('.fb-breadcrumb-item');
      // 最初のパンくず（ルート = "project"）をクリック
      expect(breadcrumbItems.length).toBeGreaterThan(0);
      breadcrumbItems[0].click();

      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('.');
      });
    });

    it('戻る（←）ボタンで親ディレクトリに移動すると onNavigate が呼ばれる', async () => {
      listFiles.mockResolvedValueOnce(makeListResult('internal/server', [
        fileEntry('server.go', '.go'),
      ]));

      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main', 'internal/server');

      // 親ディレクトリの応答を設定
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
        dirEntry('tmux'),
      ]));

      const backBtn = container.querySelector('.fb-breadcrumb-back');
      expect(backBtn).not.toBeNull();
      backBtn.click();

      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('internal');
      });
    });

    it('パンくずの中間セグメントをクリックするとそのパスに移動する', async () => {
      // internal/server/handlers に深く入った状態を作る
      listFiles.mockResolvedValueOnce(makeListResult('a/b/c', []));

      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main', 'a/b/c');

      // パンくず: [project] / a / b / c
      // "a" (index=0) をクリック → path = "a"
      listFiles.mockResolvedValue(makeListResult('a', [
        dirEntry('b'),
      ]));

      const breadcrumbItems = container.querySelectorAll('.fb-breadcrumb-item');
      // [0]=project, [1]=a, [2]=b, [3]=c
      expect(breadcrumbItems.length).toBe(4);
      breadcrumbItems[1].click(); // "a" をクリック

      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('a');
      });
    });
  });

  describe('onNavigate コールバックなし', () => {
    it('onNavigate が未設定でもエラーにならない', async () => {
      const browser = new FileBrowser(container);
      await browser.open('main');

      listFiles.mockResolvedValue(makeListResult('internal', []));

      const dirEntries = container.querySelectorAll('.fb-entry--dir');
      expect(dirEntries.length).toBeGreaterThan(0);
      dirEntries[0].click();

      // エラーなく完了する
      await vi.waitFor(() => {
        expect(browser.getCurrentPath()).toBe('internal');
      });
    });
  });

  describe('連続ナビゲーション', () => {
    it('複数のディレクトリを順に移動すると各移動で onNavigate が呼ばれる', async () => {
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main');

      // 1回目: internal に移動
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
      ]));
      const dirEntries1 = container.querySelectorAll('.fb-entry--dir');
      dirEntries1[0].click();
      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('internal');
      });

      // 2回目: internal/server に移動
      listFiles.mockResolvedValue(makeListResult('internal/server', [
        fileEntry('server.go', '.go'),
      ]));
      const dirEntries2 = container.querySelectorAll('.fb-entry--dir');
      dirEntries2[0].click();
      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('internal/server');
      });

      expect(onNavigate).toHaveBeenCalledTimes(2);
      expect(browser.getCurrentPath()).toBe('internal/server');
    });

    it('navigateTo はカウントに含まれない', async () => {
      const onNavigate = vi.fn();
      const browser = new FileBrowser(container, { onNavigate });
      await browser.open('main');

      // navigateTo（silent）
      listFiles.mockResolvedValue(makeListResult('internal', [
        dirEntry('server'),
      ]));
      await browser.navigateTo('internal');

      // ユーザー操作でさらに移動
      listFiles.mockResolvedValue(makeListResult('internal/server', []));
      const dirEntries = container.querySelectorAll('.fb-entry--dir');
      dirEntries[0].click();
      await vi.waitFor(() => {
        expect(onNavigate).toHaveBeenCalledWith('internal/server');
      });

      // navigateTo は含まれないので 1 回のみ
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('dispose 後は getCurrentPath が "." に戻る', async () => {
      const browser = new FileBrowser(container);
      await browser.open('main', 'internal');

      browser.dispose();
      expect(browser.getCurrentPath()).toBe('.');
    });
  });
});
