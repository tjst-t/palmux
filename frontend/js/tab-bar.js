// tab-bar.js - Horizontal tab bar for window/panel switching
//
// Displays terminal windows, Files, and Git tabs in a horizontally
// scrollable bar that sits inside the header.

/**
 * TabBar manages a horizontal row of tabs for switching between
 * terminal windows and virtual panels (Files, Git).
 *
 * DOM structure:
 *   <div class="tab-bar">          (container, provided)
 *     <div class="tab-bar-scroll">
 *       <button class="tab" data-type="terminal" data-window="0" data-window-name="zsh">
 *         <span class="tab-label">0:zsh</span>
 *       </button>
 *       ...
 *       <button class="tab" data-type="files">
 *         <span class="tab-icon">...</span><span class="tab-label">Files</span>
 *       </button>
 *       <button class="tab" data-type="git">
 *         <span class="tab-icon">...</span><span class="tab-label">Git</span>
 *       </button>
 *       <button class="tab tab-add" data-type="add">+</button>
 *     </div>
 *   </div>
 *
 * Tab ordering (Claude Code mode):
 *   Claude windows -> Files -> Git -> non-Claude terminals -> + button
 *
 * Tab ordering (non-Claude Code mode):
 *   Files -> Git -> terminals -> + button
 */
export class TabBar {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Root element for the tab bar
   * @param {function({type: string, windowIndex?: number}): void} options.onTabSelect - Callback when a tab is clicked
   * @param {function(): void} [options.onCreateWindow] - Callback when + button is clicked
   * @param {function(Object): void} [options.onContextAction] - Callback for context menu actions
   */
  constructor({ container, onTabSelect, onCreateWindow, onContextAction }) {
    this._container = container;
    this._onTabSelect = onTabSelect;
    this._onCreateWindow = onCreateWindow;
    this._onContextAction = onContextAction;

    /** @type {HTMLElement|null} */
    this._scrollEl = null;

    /** @type {string|null} current session name for notification matching */
    this._sessionName = null;

    /** @type {boolean} whether the session is in Claude Code mode */
    this._isClaudeCodeMode = false;

    /** @type {Array<{index: number, name: string, active: boolean}>} current windows */
    this._windows = [];

    /** @type {function} bound click handler for cleanup */
    this._handleClick = this._onClick.bind(this);
  }

  /**
   * Render tabs for the given windows array.
   *
   * Tab ordering:
   * - Claude Code mode: Claude windows -> Files -> Git -> non-Claude terminals -> + button
   * - Non-Claude mode: Files -> Git -> terminals -> + button
   *
   * @param {string} sessionName - Current session name
   * @param {Array<{index: number, name: string, active: boolean}>} windows
   * @param {boolean} isClaudeCodeMode - Whether the session is in Claude Code mode
   */
  setWindows(sessionName, windows, isClaudeCodeMode) {
    this._sessionName = sessionName;
    this._isClaudeCodeMode = isClaudeCodeMode;
    this._windows = windows;

    // Clear previous content and remove old listener
    if (this._scrollEl) {
      this._scrollEl.removeEventListener('click', this._handleClick);
    }
    this._container.innerHTML = '';

    // Create scroll container
    const scrollEl = document.createElement('div');
    scrollEl.className = 'tab-bar-scroll';
    this._scrollEl = scrollEl;

    // Separate claude and non-claude windows
    const claudeWindows = [];
    const nonClaudeWindows = [];
    for (const win of windows) {
      if (isClaudeCodeMode && win.name === 'claude') {
        claudeWindows.push(win);
      } else {
        nonClaudeWindows.push(win);
      }
    }

    // 1. Claude windows (only in Claude Code mode)
    for (const win of claudeWindows) {
      scrollEl.appendChild(this._createTerminalTab(win, isClaudeCodeMode));
    }

    // 2. Files tab
    scrollEl.appendChild(this._createFilesTab());

    // 3. Git tab
    scrollEl.appendChild(this._createGitTab());

    // 4. Non-claude terminal windows
    for (const win of nonClaudeWindows) {
      scrollEl.appendChild(this._createTerminalTab(win, isClaudeCodeMode));
    }

    // 5. + button
    scrollEl.appendChild(this._createAddButton());

    // Attach click handler via event delegation
    scrollEl.addEventListener('click', this._handleClick);

    this._container.appendChild(scrollEl);
  }

  /**
   * Mark a tab as active.
   * @param {{type: string, windowIndex?: number}} tab
   */
  setActiveTab({ type, windowIndex }) {
    if (!this._scrollEl) return;

    // Remove all active classes
    const tabs = this._scrollEl.querySelectorAll('.tab');
    for (const t of tabs) {
      t.classList.remove('tab--active');
    }

    // Find and activate the matching tab
    let target = null;
    if (type === 'terminal' && windowIndex !== undefined) {
      target = this._scrollEl.querySelector(`.tab[data-type="terminal"][data-window="${windowIndex}"]`);
    } else if (type === 'files') {
      target = this._scrollEl.querySelector('.tab[data-type="files"]');
    } else if (type === 'git') {
      target = this._scrollEl.querySelector('.tab[data-type="git"]');
    }

    if (target) {
      target.classList.add('tab--active');
    }
  }

  /**
   * Show or hide the tab bar.
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (visible) {
      this._container.classList.remove('hidden');
    } else {
      this._container.classList.add('hidden');
    }
  }

  /**
   * Show notification badges on tabs that have background activity.
   * @param {Array<{session: string, window: number}>} notifications
   */
  setNotifications(notifications) {
    if (!this._scrollEl) return;

    // Clear existing notification badges
    const existing = this._scrollEl.querySelectorAll('.tab-notification');
    for (const badge of existing) {
      badge.remove();
    }

    // Filter to current session only
    const current = notifications.filter(n => n.session === this._sessionName);

    // Add badge to matching terminal tabs
    for (const notif of current) {
      const tab = this._scrollEl.querySelector(
        `.tab[data-type="terminal"][data-window="${notif.window}"]`
      );
      if (tab) {
        const badge = document.createElement('span');
        badge.className = 'tab-notification';
        tab.appendChild(badge);
      }
    }
  }

  /**
   * Scroll the active tab into view.
   */
  scrollToActive() {
    if (!this._scrollEl) return;
    const active = this._scrollEl.querySelector('.tab--active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  /**
   * Remove all DOM content and event listeners.
   */
  dispose() {
    if (this._scrollEl) {
      this._scrollEl.removeEventListener('click', this._handleClick);
      this._scrollEl = null;
    }
    this._container.innerHTML = '';
    this._sessionName = null;
  }

  // --- private ---

  /**
   * Create a terminal tab button element.
   * @param {{index: number, name: string, active: boolean}} win
   * @param {boolean} isClaudeCodeMode
   * @returns {HTMLButtonElement}
   * @private
   */
  _createTerminalTab(win, isClaudeCodeMode) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.type = 'terminal';
    btn.dataset.window = String(win.index);
    btn.dataset.windowName = win.name;

    // Claude Code mode: add sparkle icon for claude windows
    if (isClaudeCodeMode && win.name === 'claude') {
      const icon = document.createElement('span');
      icon.className = 'tab-icon';
      icon.textContent = '\u2726'; // ✦
      btn.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = `${win.index}:${win.name}`;
    btn.appendChild(label);

    return btn;
  }

  /**
   * Create the Files tab button element.
   * @returns {HTMLButtonElement}
   * @private
   */
  _createFilesTab() {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.type = 'files';
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.textContent = '\uD83D\uDCC1'; // folder emoji
    btn.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = 'Files';
    btn.appendChild(label);
    return btn;
  }

  /**
   * Create the Git tab button element.
   * @returns {HTMLButtonElement}
   * @private
   */
  _createGitTab() {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.type = 'git';
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.textContent = '\u2442'; // ⑂ branch symbol
    btn.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = 'Git';
    btn.appendChild(label);
    return btn;
  }

  /**
   * Create the + (add window) button element.
   * @returns {HTMLButtonElement}
   * @private
   */
  _createAddButton() {
    const btn = document.createElement('button');
    btn.className = 'tab tab-add';
    btn.dataset.type = 'add';
    btn.textContent = '+';
    return btn;
  }

  /**
   * Extract tab info from a tab element.
   * @param {HTMLElement} tab
   * @returns {{type: string, windowIndex?: number, windowName?: string}}
   */
  _getTabInfo(tab) {
    const type = tab.dataset.type;
    if (type === 'terminal') {
      return {
        type: 'terminal',
        windowIndex: parseInt(tab.dataset.window, 10),
        windowName: tab.dataset.windowName || '',
      };
    }
    return { type, windowIndex: undefined, windowName: undefined };
  }

  /**
   * Click event handler using delegation on the scroll container.
   * @param {MouseEvent} e
   * @private
   */
  _onClick(e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;

    if (tab.dataset.type === 'add') {
      if (this._onCreateWindow) this._onCreateWindow();
      return;
    }

    const type = tab.dataset.type;
    if (type === 'terminal') {
      const windowIndex = parseInt(tab.dataset.window, 10);
      this._onTabSelect({ type: 'terminal', windowIndex });
    } else if (type === 'files') {
      this._onTabSelect({ type: 'files' });
    } else if (type === 'git') {
      this._onTabSelect({ type: 'git' });
    }
  }
}
