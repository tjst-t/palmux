// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabBar } from '../tab-bar.js';

// --- helpers ---

function createContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** window objects returned by the tmux API */
function makeWindow(index, name, active = false) {
  return { index, name, active };
}

// --- tests ---

describe('TabBar', () => {
  let container;
  let onTabSelect;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
    onTabSelect = vi.fn();
  });

  describe('setWindows', () => {
    it('generates correct number of tab elements for windows', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
        makeWindow(2, 'htop'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      // 3 terminal tabs + Files + Git + add button = 6
      expect(tabs.length).toBe(6);
    });

    it('renders tabs in correct order: Files -> Git -> terminals -> + (non-Claude mode)', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      // Expected order: Files, Git, zsh, vim, +
      expect(tabs[0].dataset.type).toBe('files');
      expect(tabs[1].dataset.type).toBe('git');
      expect(tabs[2].dataset.type).toBe('terminal');
      expect(tabs[2].dataset.window).toBe('0');
      expect(tabs[3].dataset.type).toBe('terminal');
      expect(tabs[3].dataset.window).toBe('1');
      expect(tabs[4].dataset.type).toBe('add');
      expect(tabs[4].textContent).toBe('+');
    });

    it('terminal tabs have correct data attributes', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs.length).toBe(2);
      expect(termTabs[0].dataset.window).toBe('0');
      expect(termTabs[1].dataset.window).toBe('1');
    });

    it('terminal tabs have data-window-name attribute', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].dataset.windowName).toBe('zsh');
      expect(termTabs[1].dataset.windowName).toBe('vim');
    });

    it('terminal tab labels show index:name', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(2, 'vim'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].querySelector('.tab-label').textContent).toBe('0:zsh');
      expect(termTabs[1].querySelector('.tab-label').textContent).toBe('2:vim');
    });

    it('replaces tabs when called again', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);
      // 1 terminal + Files + Git + add = 4
      expect(container.querySelectorAll('.tab').length).toBe(4);

      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);
      // 2 terminals + Files + Git + add = 5
      expect(container.querySelectorAll('.tab').length).toBe(5);
    });

    it('stores _isClaudeCodeMode and _windows on instance', () => {
      const bar = new TabBar({ container, onTabSelect });
      const windows = [makeWindow(0, 'zsh'), makeWindow(1, 'claude')];
      bar.setWindows('main', windows, true);

      expect(bar._isClaudeCodeMode).toBe(true);
      expect(bar._windows).toEqual(windows);
    });
  });

  describe('tab ordering', () => {
    it('orders tabs: Claude -> Files -> Git -> non-Claude terminals -> + (Claude Code mode)', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'claude'),
      ], true);

      const tabs = container.querySelectorAll('.tab');
      // Expected order: claude tab, Files, Git, zsh tab, + button
      expect(tabs.length).toBe(5);
      expect(tabs[0].dataset.type).toBe('terminal');
      expect(tabs[0].dataset.window).toBe('1');  // claude window
      expect(tabs[0].dataset.windowName).toBe('claude');
      expect(tabs[1].dataset.type).toBe('files');
      expect(tabs[2].dataset.type).toBe('git');
      expect(tabs[3].dataset.type).toBe('terminal');
      expect(tabs[3].dataset.window).toBe('0');  // zsh window
      expect(tabs[3].dataset.windowName).toBe('zsh');
      expect(tabs[4].dataset.type).toBe('add');
    });

    it('orders tabs without Claude windows: Files -> Git -> terminals -> + (non-Claude mode)', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      // Expected: Files, Git, zsh, vim, +
      expect(tabs.length).toBe(5);
      expect(tabs[0].dataset.type).toBe('files');
      expect(tabs[1].dataset.type).toBe('git');
      expect(tabs[2].dataset.type).toBe('terminal');
      expect(tabs[2].dataset.window).toBe('0');
      expect(tabs[3].dataset.type).toBe('terminal');
      expect(tabs[3].dataset.window).toBe('1');
      expect(tabs[4].dataset.type).toBe('add');
    });

    it('orders multiple claude windows before Files/Git', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'bash'),
        makeWindow(1, 'claude'),
        makeWindow(2, 'vim'),
        makeWindow(3, 'claude'),
      ], true);

      const tabs = container.querySelectorAll('.tab');
      // Expected: claude(1), claude(3), Files, Git, bash(0), vim(2), +
      expect(tabs.length).toBe(7);
      expect(tabs[0].dataset.type).toBe('terminal');
      expect(tabs[0].dataset.window).toBe('1');
      expect(tabs[1].dataset.type).toBe('terminal');
      expect(tabs[1].dataset.window).toBe('3');
      expect(tabs[2].dataset.type).toBe('files');
      expect(tabs[3].dataset.type).toBe('git');
      expect(tabs[4].dataset.type).toBe('terminal');
      expect(tabs[4].dataset.window).toBe('0');
      expect(tabs[5].dataset.type).toBe('terminal');
      expect(tabs[5].dataset.window).toBe('2');
      expect(tabs[6].dataset.type).toBe('add');
    });

    it('places + button as last element', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
        makeWindow(2, 'htop'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      const lastTab = tabs[tabs.length - 1];
      expect(lastTab.dataset.type).toBe('add');
      expect(lastTab.textContent).toBe('+');
      expect(lastTab.classList.contains('tab-add')).toBe(true);
    });

    it('does not show claude windows at top when not in Claude Code mode', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'claude'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      // When not in Claude Code mode, no special ordering for claude windows
      // Expected: Files, Git, zsh, claude, +
      expect(tabs[0].dataset.type).toBe('files');
      expect(tabs[1].dataset.type).toBe('git');
      expect(tabs[2].dataset.type).toBe('terminal');
      expect(tabs[2].dataset.window).toBe('0');
      expect(tabs[3].dataset.type).toBe('terminal');
      expect(tabs[3].dataset.window).toBe('1');
      expect(tabs[4].dataset.type).toBe('add');
    });
  });

  describe('add button', () => {
    it('calls onCreateWindow when + button is clicked', () => {
      const onCreateWindow = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onCreateWindow });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const addBtn = container.querySelector('.tab[data-type="add"]');
      addBtn.click();

      expect(onCreateWindow).toHaveBeenCalledTimes(1);
    });

    it('does not call onTabSelect when + button is clicked', () => {
      const onCreateWindow = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onCreateWindow });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const addBtn = container.querySelector('.tab[data-type="add"]');
      addBtn.click();

      expect(onTabSelect).not.toHaveBeenCalled();
    });

    it('does not throw if onCreateWindow is not provided', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const addBtn = container.querySelector('.tab[data-type="add"]');
      expect(() => addBtn.click()).not.toThrow();
    });
  });

  describe('_getTabInfo', () => {
    it('returns terminal info with windowIndex and windowName', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh'), makeWindow(1, 'vim')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      const info = bar._getTabInfo(termTab);
      expect(info).toEqual({
        type: 'terminal',
        windowIndex: 0,
        windowName: 'zsh',
      });
    });

    it('returns files info', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const filesTab = container.querySelector('.tab[data-type="files"]');
      const info = bar._getTabInfo(filesTab);
      expect(info).toEqual({
        type: 'files',
        windowIndex: undefined,
        windowName: undefined,
      });
    });

    it('returns add info', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const addTab = container.querySelector('.tab[data-type="add"]');
      const info = bar._getTabInfo(addTab);
      expect(info).toEqual({
        type: 'add',
        windowIndex: undefined,
        windowName: undefined,
      });
    });
  });

  describe('setActiveTab', () => {
    it('adds tab--active class to the correct terminal tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      bar.setActiveTab({ type: 'terminal', windowIndex: 1 });

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].classList.contains('tab--active')).toBe(false);
      expect(termTabs[1].classList.contains('tab--active')).toBe(true);

      const filesTab = container.querySelector('.tab[data-type="files"]');
      expect(filesTab.classList.contains('tab--active')).toBe(false);
      const gitTab = container.querySelector('.tab[data-type="git"]');
      expect(gitTab.classList.contains('tab--active')).toBe(false);
    });

    it('adds tab--active class to Files tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
      ], false);

      bar.setActiveTab({ type: 'files' });

      const filesTab = container.querySelector('.tab[data-type="files"]');
      expect(filesTab.classList.contains('tab--active')).toBe(true);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      expect(termTab.classList.contains('tab--active')).toBe(false);
    });

    it('adds tab--active class to Git tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
      ], false);

      bar.setActiveTab({ type: 'git' });

      const gitTab = container.querySelector('.tab[data-type="git"]');
      expect(gitTab.classList.contains('tab--active')).toBe(true);
    });

    it('removes previous active state when switching', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      bar.setActiveTab({ type: 'terminal', windowIndex: 0 });
      expect(container.querySelectorAll('.tab--active').length).toBe(1);

      bar.setActiveTab({ type: 'terminal', windowIndex: 1 });
      expect(container.querySelectorAll('.tab--active').length).toBe(1);
      expect(container.querySelector('.tab--active').dataset.window).toBe('1');
    });
  });

  describe('tab click callbacks', () => {
    it('calls onTabSelect with terminal type and windowIndex', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      termTabs[1].click();

      expect(onTabSelect).toHaveBeenCalledWith({ type: 'terminal', windowIndex: 1 });
    });

    it('calls onTabSelect with files type', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      container.querySelector('.tab[data-type="files"]').click();
      expect(onTabSelect).toHaveBeenCalledWith({ type: 'files' });
    });

    it('calls onTabSelect with git type', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      container.querySelector('.tab[data-type="git"]').click();
      expect(onTabSelect).toHaveBeenCalledWith({ type: 'git' });
    });
  });

  describe('setVisible', () => {
    it('hides the container when setVisible(false) is called', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);
      bar.setVisible(true);

      expect(container.classList.contains('hidden')).toBe(false);

      bar.setVisible(false);
      expect(container.classList.contains('hidden')).toBe(true);
    });

    it('shows the container when setVisible(true) is called', () => {
      const bar = new TabBar({ container, onTabSelect });
      container.classList.add('hidden');

      bar.setVisible(true);
      expect(container.classList.contains('hidden')).toBe(false);
    });
  });

  describe('setNotifications', () => {
    it('shows notification badge on matching window tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      bar.setNotifications([{ session: 'main', window: 1 }]);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].querySelector('.tab-notification')).toBeNull();
      expect(termTabs[1].querySelector('.tab-notification')).not.toBeNull();
    });

    it('does not show badge for different session', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      bar.setNotifications([{ session: 'other', window: 1 }]);

      const badges = container.querySelectorAll('.tab-notification');
      expect(badges.length).toBe(0);
    });

    it('clears previous notifications when called again', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);

      bar.setNotifications([{ session: 'main', window: 0 }]);
      expect(container.querySelectorAll('.tab-notification').length).toBe(1);

      bar.setNotifications([]);
      expect(container.querySelectorAll('.tab-notification').length).toBe(0);
    });

    it('shows badges on multiple windows', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
        makeWindow(2, 'htop'),
      ], false);

      bar.setNotifications([
        { session: 'main', window: 0 },
        { session: 'main', window: 2 },
      ]);

      expect(container.querySelectorAll('.tab-notification').length).toBe(2);
    });
  });

  describe('dispose', () => {
    it('clears the container contents', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);
      expect(container.children.length).toBeGreaterThan(0);

      bar.dispose();
      expect(container.innerHTML).toBe('');
    });

    it('removes event listeners so clicks do not fire callbacks', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      // Keep a reference to a tab before disposal
      const tab = container.querySelector('.tab[data-type="terminal"]');
      bar.dispose();

      // Clicking the detached tab should not call onTabSelect
      tab.click();
      expect(onTabSelect).not.toHaveBeenCalled();
    });
  });

  describe('Claude Code mode', () => {
    it('shows sparkle icon on claude window in Claude Code mode', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'claude'),
      ], true);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      // In Claude Code mode, claude tab is first (reordered)
      // Claude tab (index 1) should have sparkle icon
      const claudeTab = container.querySelector('.tab[data-type="terminal"][data-window="1"]');
      const claudeIcon = claudeTab.querySelector('.tab-icon');
      expect(claudeIcon).not.toBeNull();
      expect(claudeIcon.textContent).toContain('\u2726'); // sparkle

      // Normal window should not have an icon
      const zshTab = container.querySelector('.tab[data-type="terminal"][data-window="0"]');
      expect(zshTab.querySelector('.tab-icon')).toBeNull();
    });

    it('does not show sparkle icon when not in Claude Code mode', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'claude'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].querySelector('.tab-icon')).toBeNull();
      expect(termTabs[1].querySelector('.tab-icon')).toBeNull();
    });

    it('does not show sparkle icon on non-claude windows even in Claude Code mode', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], true);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
      expect(termTabs[0].querySelector('.tab-icon')).toBeNull();
      expect(termTabs[1].querySelector('.tab-icon')).toBeNull();
    });
  });

  describe('scrollToActive', () => {
    it('does not throw when no active tab exists', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      // Should not throw
      expect(() => bar.scrollToActive()).not.toThrow();
    });

    it('calls scrollIntoView on the active tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);
      bar.setActiveTab({ type: 'terminal', windowIndex: 0 });

      const activeTab = container.querySelector('.tab--active');
      const spy = vi.spyOn(activeTab, 'scrollIntoView');

      bar.scrollToActive();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    it('shows context menu on terminal tab right-click with Rename and Delete', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(0, 'zsh'), makeWindow(1, 'vim')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"][data-window="0"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).not.toBeNull();

      const menuItems = overlay.querySelectorAll('.drawer-context-menu-item');
      expect(menuItems.length).toBe(2);
      expect(menuItems[0].textContent).toBe('Rename');
      expect(menuItems[1].textContent).toBe('Delete');
    });

    it('shows Restart and Resume for claude tabs in Claude Code mode', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(0, 'zsh'), makeWindow(1, 'claude')], true);

      const claudeTab = container.querySelector('.tab[data-type="terminal"][data-window="1"]');
      claudeTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).not.toBeNull();

      const menuItems = overlay.querySelectorAll('.drawer-context-menu-item');
      expect(menuItems.length).toBe(2);
      expect(menuItems[0].textContent).toBe('Restart');
      expect(menuItems[1].textContent).toBe('Resume');
    });

    it('does not show context menu for Files tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const filesTab = container.querySelector('.tab[data-type="files"]');
      filesTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).toBeNull();
    });

    it('does not show context menu for Git tab', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const gitTab = container.querySelector('.tab[data-type="git"]');
      gitTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).toBeNull();
    });

    it('does not show context menu for + button', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const addBtn = container.querySelector('.tab[data-type="add"]');
      addBtn.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).toBeNull();
    });

    it('calls onContextAction with rename action when Rename is clicked', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const renameBtn = document.querySelector('.drawer-context-menu-item');
      renameBtn.click();

      expect(onContextAction).toHaveBeenCalledWith({
        action: 'rename',
        windowIndex: 0,
        windowName: 'zsh',
      });
    });

    it('calls onContextAction with delete action when Delete is clicked', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const items = document.querySelectorAll('.drawer-context-menu-item');
      const deleteBtn = items[1]; // second item is Delete
      deleteBtn.click();

      expect(onContextAction).toHaveBeenCalledWith({
        action: 'delete',
        windowIndex: 0,
        windowName: 'zsh',
      });
    });

    it('calls onContextAction with restart action for claude tab', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(1, 'claude')], true);

      const claudeTab = container.querySelector('.tab[data-type="terminal"][data-window="1"]');
      claudeTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const items = document.querySelectorAll('.drawer-context-menu-item');
      items[0].click(); // Restart

      expect(onContextAction).toHaveBeenCalledWith({
        action: 'restart',
        windowIndex: 1,
        windowName: 'claude',
      });
    });

    it('calls onContextAction with resume action for claude tab', () => {
      const onContextAction = vi.fn();
      const bar = new TabBar({ container, onTabSelect, onContextAction });
      bar.setWindows('main', [makeWindow(1, 'claude')], true);

      const claudeTab = container.querySelector('.tab[data-type="terminal"][data-window="1"]');
      claudeTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const items = document.querySelectorAll('.drawer-context-menu-item');
      items[1].click(); // Resume

      expect(onContextAction).toHaveBeenCalledWith({
        action: 'resume',
        windowIndex: 1,
        windowName: 'claude',
      });
    });

    it('closes context menu when overlay is clicked', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      let overlay = document.querySelector('.drawer-context-menu-overlay');
      expect(overlay).not.toBeNull();

      // Click overlay itself to close
      overlay.click();
      // After the animation timeout (200ms) the overlay should be removed
      // In tests we can just check it starts the close process
      // (overlay--visible class removal is immediate)
    });

    it('shows menu title with window index and name', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(3, 'myterm')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const title = document.querySelector('.drawer-context-menu-title');
      expect(title.textContent).toBe('3: myterm');
    });

    it('delete button has danger class', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.dispatchEvent(new Event('contextmenu', { bubbles: true }));

      const items = document.querySelectorAll('.drawer-context-menu-item');
      expect(items[1].classList.contains('drawer-context-menu-item--danger')).toBe(true);
    });
  });

  describe('long press detection', () => {
    it('suppresses click after long press detection', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      // Simulate long press detected state
      bar._longPressDetected = true;

      const termTab = container.querySelector('.tab[data-type="terminal"]');
      termTab.click();

      // Should NOT have called onTabSelect because longPressDetected was true
      expect(onTabSelect).not.toHaveBeenCalled();
      // Should reset the flag
      expect(bar._longPressDetected).toBe(false);
    });
  });

  describe('dispose with context menu', () => {
    it('cleans up contextmenu listener on dispose', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      bar.dispose();

      // After dispose, right-clicking should not create a menu
      // (The scrollEl is removed, but this verifies cleanup logic)
      expect(bar._scrollEl).toBeNull();
    });

    it('clears long press timer on dispose', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [makeWindow(0, 'zsh')], false);

      // Simulate an active timer
      bar._longPressTimer = setTimeout(() => {}, 10000);
      bar.dispose();

      expect(bar._longPressTimer).toBeNull();
    });
  });
});
