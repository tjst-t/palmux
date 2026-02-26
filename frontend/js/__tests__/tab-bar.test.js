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
      // 3 terminal tabs + Files + Git = 5
      expect(tabs.length).toBe(5);
    });

    it('always adds Files and Git tabs at the end', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
      ], false);

      const tabs = container.querySelectorAll('.tab');
      const lastTwo = [tabs[tabs.length - 2], tabs[tabs.length - 1]];

      expect(lastTwo[0].dataset.type).toBe('files');
      expect(lastTwo[0].querySelector('.tab-label').textContent).toBe('Files');
      expect(lastTwo[1].dataset.type).toBe('git');
      expect(lastTwo[1].querySelector('.tab-label').textContent).toBe('Git');
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
      expect(container.querySelectorAll('.tab').length).toBe(3); // 1 + Files + Git

      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'vim'),
      ], false);
      expect(container.querySelectorAll('.tab').length).toBe(4); // 2 + Files + Git
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

      const tabs = container.querySelectorAll('.tab');
      expect(tabs[0].classList.contains('tab--active')).toBe(false);
      expect(tabs[1].classList.contains('tab--active')).toBe(true);
      expect(tabs[2].classList.contains('tab--active')).toBe(false); // Files
      expect(tabs[3].classList.contains('tab--active')).toBe(false); // Git
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
      // Normal window should not have an icon
      expect(termTabs[0].querySelector('.tab-icon')).toBeNull();

      // Claude window should have a sparkle icon
      const claudeIcon = termTabs[1].querySelector('.tab-icon');
      expect(claudeIcon).not.toBeNull();
      expect(claudeIcon.textContent).toContain('\u2726'); // ✦
    });

    it('does not show sparkle icon when not in Claude Code mode', () => {
      const bar = new TabBar({ container, onTabSelect });
      bar.setWindows('main', [
        makeWindow(0, 'zsh'),
        makeWindow(1, 'claude'),
      ], false);

      const termTabs = container.querySelectorAll('.tab[data-type="terminal"]');
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
});
