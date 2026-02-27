// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TabBar } from '../tab-bar.js';

// _checkClaudeNotificationHaptic はモジュールスコープの関数で直接 import できないため、
// ロジックを再現してテストする。
// テスト対象: 通知データ (window_index フィールド) と tabBar 状態から
// Claude ウィンドウの新規通知を検出する仕組み

describe('Claude notification haptic logic', () => {
  /** @type {Set<string>} */
  let prevKeys;

  /** tabBar のモック状態 */
  let tabBarState;

  /**
   * _checkClaudeNotificationHaptic と同一のロジック。
   * app.js からの抽出。
   */
  function checkClaudeNotificationHaptic(notifications) {
    const currentKeys = new Set();
    const claudeNotifications = [];

    for (const n of notifications) {
      const key = `${n.session}:${n.window_index}`;
      currentKeys.add(key);
      if (!prevKeys.has(key)) {
        claudeNotifications.push(n);
      }
    }

    prevKeys = currentKeys;

    if (claudeNotifications.length === 0) return { triggered: false, newNotifs: [] };

    const hasNewClaudeNotif = tabBarState._isClaudeCodeMode &&
      claudeNotifications.some(n => {
        if (n.session !== tabBarState._sessionName) return false;
        return tabBarState._windows.some(w => w.index === n.window_index && w.name === 'claude');
      });

    return { triggered: hasNewClaudeNotif, newNotifs: claudeNotifications };
  }

  beforeEach(() => {
    prevKeys = new Set();
    tabBarState = {
      _isClaudeCodeMode: true,
      _sessionName: 'myproject',
      _windows: [
        { index: 0, name: 'zsh', active: false },
        { index: 1, name: 'claude', active: true },
      ],
    };
  });

  it('notification データは window_index フィールドを使う', () => {
    const notification = { session: 'myproject', window_index: 1, type: 'activity' };
    const key = `${notification.session}:${notification.window_index}`;
    expect(key).toBe('myproject:1');
  });

  it('window フィールド（旧形式）では undefined になる', () => {
    const notification = { session: 'myproject', window_index: 1, type: 'activity' };
    // window フィールドは存在しない
    expect(notification.window).toBeUndefined();
  });

  it('Claude ウィンドウの新規通知を検出する', () => {
    const result = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);

    expect(result.triggered).toBe(true);
    expect(result.newNotifs.length).toBe(1);
  });

  it('非 Claude ウィンドウの通知ではトリガーしない', () => {
    const result = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 0, type: 'activity' },
    ]);

    expect(result.triggered).toBe(false);
  });

  it('別セッションの通知ではトリガーしない', () => {
    const result = checkClaudeNotificationHaptic([
      { session: 'otherproject', window_index: 1, type: 'activity' },
    ]);

    expect(result.triggered).toBe(false);
  });

  it('同一通知の2回目はトリガーしない（prevKeys で重複除去）', () => {
    // 1回目
    const result1 = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);
    expect(result1.triggered).toBe(true);

    // 2回目（同じ通知）
    const result2 = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);
    expect(result2.triggered).toBe(false);
    expect(result2.newNotifs.length).toBe(0);
  });

  it('通知がクリアされた後に再度来ればトリガーする', () => {
    // 1回目
    checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);

    // クリア（空配列）
    checkClaudeNotificationHaptic([]);

    // 再度通知
    const result = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);
    expect(result.triggered).toBe(true);
  });

  it('Claude Code モードでない場合はトリガーしない', () => {
    tabBarState._isClaudeCodeMode = false;

    const result = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 1, type: 'activity' },
    ]);

    expect(result.triggered).toBe(false);
  });

  it('空の通知配列ではトリガーしない', () => {
    const result = checkClaudeNotificationHaptic([]);
    expect(result.triggered).toBe(false);
  });

  it('複数通知で Claude のものだけトリガーする', () => {
    const result = checkClaudeNotificationHaptic([
      { session: 'myproject', window_index: 0, type: 'activity' },  // zsh
      { session: 'myproject', window_index: 1, type: 'activity' },  // claude
    ]);

    expect(result.triggered).toBe(true);
    expect(result.newNotifs.length).toBe(2);
  });
});

describe('navigator.vibrate integration', () => {
  let originalVibrate;

  beforeEach(() => {
    originalVibrate = navigator.vibrate;
  });

  afterEach(() => {
    if (originalVibrate !== undefined) {
      navigator.vibrate = originalVibrate;
    }
  });

  it('navigator.vibrate が呼び出し可能であること', () => {
    const vibrateMock = vi.fn(() => true);
    navigator.vibrate = vibrateMock;

    navigator.vibrate([50, 100, 50]);

    expect(vibrateMock).toHaveBeenCalledWith([50, 100, 50]);
  });
});

describe('Notification API integration', () => {
  it('Notification コンストラクタでブラウザ通知を作成できること', () => {
    // happy-dom では Notification がサポートされていない可能性があるため
    // グローバルにモックする
    const NotificationMock = vi.fn();
    NotificationMock.permission = 'granted';
    NotificationMock.requestPermission = vi.fn(() => Promise.resolve('granted'));
    globalThis.Notification = NotificationMock;

    new Notification('Claude Code', {
      body: 'Waiting for approval',
      tag: 'palmux-claude-approval',
    });

    expect(NotificationMock).toHaveBeenCalledWith('Claude Code', {
      body: 'Waiting for approval',
      tag: 'palmux-claude-approval',
    });
  });
});

describe('Server-Client notification data format contract', () => {
  // Go サーバーの Notification 構造体:
  //   type Notification struct {
  //       Session     string `json:"session"`
  //       WindowIndex int    `json:"window_index"`
  //       Type        string `json:"type"`
  //   }
  //
  // WebSocket メッセージ:
  //   { "type": "notification_update", "notifications": [...] }

  /** サーバーからの実際の JSON レスポンスをシミュレート */
  function parseServerNotificationUpdate(jsonStr) {
    return JSON.parse(jsonStr);
  }

  it('サーバーの notification_update メッセージのフィールド名が正しいこと', () => {
    // Go の json.Marshal が生成するフォーマットをシミュレート
    const serverJson = JSON.stringify({
      type: 'notification_update',
      notifications: [
        { session: 'myproject', window_index: 1, type: 'stop' },
      ],
    });

    const msg = parseServerNotificationUpdate(serverJson);

    // terminal.js が使うフィールド
    expect(msg.type).toBe('notification_update');
    expect(msg.notifications).toBeDefined();
    expect(msg.notifications).toHaveLength(1);

    // tab-bar.js の setNotifications が使うフィールド
    const notif = msg.notifications[0];
    expect(notif.session).toBe('myproject');
    expect(notif.window_index).toBe(1);
    expect(notif.type).toBe('stop');

    // 旧フィールド名は存在しないことを確認
    expect(notif.window).toBeUndefined();
  });

  it('GET /api/notifications レスポンスのフォーマットが正しいこと', () => {
    // listNotifications() API の返り値をシミュレート
    const serverJson = JSON.stringify([
      { session: 'myproject', window_index: 1, type: 'stop' },
      { session: 'myproject', window_index: 0, type: 'activity' },
    ]);

    const notifications = JSON.parse(serverJson);

    expect(notifications).toHaveLength(2);
    // window_index フィールドが存在し数値であること
    for (const n of notifications) {
      expect(typeof n.window_index).toBe('number');
      expect(typeof n.session).toBe('string');
    }
  });

  it('window_index を使って DOM クエリが一致すること', () => {
    // tab-bar.js の setNotifications 内のクエリを再現
    const notif = { session: 'myproject', window_index: 1, type: 'stop' };

    // DOM にタブ要素を作成
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.type = 'terminal';
    tab.dataset.window = String(1);  // _createTerminalTab と同じ形式
    tab.dataset.windowName = 'claude';
    document.body.appendChild(tab);

    // setNotifications と同じセレクタで検索
    const found = document.querySelector(
      `.tab[data-type="terminal"][data-window="${notif.window_index}"]`
    );

    expect(found).toBe(tab);
    expect(found.dataset.windowName).toBe('claude');

    tab.remove();
  });
});

describe('TabBar notification badge end-to-end', () => {
  /** @type {HTMLElement} */
  let container;
  /** @type {TabBar} */
  let bar;
  const noopSelect = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    bar = new TabBar({ container, onTabSelect: noopSelect });
  });

  afterEach(() => {
    bar.dispose();
    container.remove();
  });

  it('サーバーフォーマットの通知でバッジが表示されること（E2E）', () => {
    // タブバーをレンダリング
    bar.setWindows('dev', [
      { index: 0, name: 'zsh', active: false },
      { index: 1, name: 'claude', active: true },
    ], true);

    // サーバーからの notification_update メッセージをシミュレート
    const serverMsg = JSON.parse(JSON.stringify({
      type: 'notification_update',
      notifications: [
        { session: 'dev', window_index: 1, type: 'stop' },
      ],
    }));

    // terminal.js → panel.js → app.js → tabBar.setNotifications の流れをシミュレート
    bar.setNotifications(serverMsg.notifications);

    // Claude タブにバッジが付いていること
    const claudeTab = container.querySelector('.tab[data-window="1"]');
    expect(claudeTab).not.toBeNull();
    const badge = claudeTab.querySelector('.tab-notification');
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('tab-notification--claude')).toBe(true);
  });

  it('サーバーフォーマットの通知で非 Claude タブにも通常バッジが表示されること', () => {
    bar.setWindows('dev', [
      { index: 0, name: 'zsh', active: false },
      { index: 1, name: 'claude', active: true },
    ], true);

    const notifications = [
      { session: 'dev', window_index: 0, type: 'activity' },
    ];

    bar.setNotifications(notifications);

    const zshTab = container.querySelector('.tab[data-window="0"]');
    const badge = zshTab.querySelector('.tab-notification');
    expect(badge).not.toBeNull();
    // 通常バッジ（claude スタイルではない）
    expect(badge.classList.contains('tab-notification--claude')).toBe(false);
  });

  it('通知がクリアされるとバッジが消えること', () => {
    bar.setWindows('dev', [
      { index: 0, name: 'zsh', active: false },
      { index: 1, name: 'claude', active: true },
    ], true);

    // 通知追加
    bar.setNotifications([{ session: 'dev', window_index: 1, type: 'stop' }]);
    expect(container.querySelector('.tab-notification')).not.toBeNull();

    // 通知クリア（空配列）
    bar.setNotifications([]);
    expect(container.querySelector('.tab-notification')).toBeNull();
  });

  it('setWindows 前に setNotifications を呼んでもクラッシュしないこと', () => {
    // タブバー未レンダリング状態で通知が来るケース（初期化タイミング問題）
    expect(() => {
      bar.setNotifications([{ session: 'dev', window_index: 1, type: 'stop' }]);
    }).not.toThrow();
  });
});
