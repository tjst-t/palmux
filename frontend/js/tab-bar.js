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
 *       <button class="tab" data-type="terminal" data-window="0">
 *         <span class="tab-label">0:zsh</span>
 *       </button>
 *       ...
 *       <button class="tab" data-type="files">
 *         <span class="tab-icon">...</span><span class="tab-label">Files</span>
 *       </button>
 *       <button class="tab" data-type="git">
 *         <span class="tab-icon">...</span><span class="tab-label">Git</span>
 *       </button>
 *     </div>
 *   </div>
 */
export class TabBar {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Root element for the tab bar
   * @param {function({type: string, windowIndex?: number}): void} options.onTabSelect - Callback when a tab is clicked
   */
  constructor({ container, onTabSelect }) {
    this._container = container;
    this._onTabSelect = onTabSelect;

    /** @type {HTMLElement|null} */
    this._scrollEl = null;

    /** @type {string|null} current session name for notification matching */
    this._sessionName = null;

    /** @type {function} bound click handler for cleanup */
    this._handleClick = this._onClick.bind(this);
  }

  /**
   * Render tabs for the given windows array.
   * @param {string} sessionName - Current session name
   * @param {Array<{index: number, name: string, active: boolean}>} windows
   * @param {boolean} isClaudeCodeMode - Whether the session is in Claude Code mode
   */
  setWindows(sessionName, windows, isClaudeCodeMode) {
    this._sessionName = sessionName;

    // Clear previous content and remove old listener
    if (this._scrollEl) {
      this._scrollEl.removeEventListener('click', this._handleClick);
    }
    this._container.innerHTML = '';

    // Create scroll container
    const scrollEl = document.createElement('div');
    scrollEl.className = 'tab-bar-scroll';
    this._scrollEl = scrollEl;

    // Terminal tabs
    for (const win of windows) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.type = 'terminal';
      btn.dataset.window = String(win.index);

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

      scrollEl.appendChild(btn);
    }

    // Files tab
    const filesBtn = document.createElement('button');
    filesBtn.className = 'tab';
    filesBtn.dataset.type = 'files';
    const filesIcon = document.createElement('span');
    filesIcon.className = 'tab-icon';
    filesIcon.textContent = '\uD83D\uDCC1'; // folder emoji
    filesBtn.appendChild(filesIcon);
    const filesLabel = document.createElement('span');
    filesLabel.className = 'tab-label';
    filesLabel.textContent = 'Files';
    filesBtn.appendChild(filesLabel);
    scrollEl.appendChild(filesBtn);

    // Git tab
    const gitBtn = document.createElement('button');
    gitBtn.className = 'tab';
    gitBtn.dataset.type = 'git';
    const gitIcon = document.createElement('span');
    gitIcon.className = 'tab-icon';
    gitIcon.textContent = '\u2442'; // ⑂ branch symbol
    gitBtn.appendChild(gitIcon);
    const gitLabel = document.createElement('span');
    gitLabel.className = 'tab-label';
    gitLabel.textContent = 'Git';
    gitBtn.appendChild(gitLabel);
    scrollEl.appendChild(gitBtn);

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
   * Click event handler using delegation on the scroll container.
   * @param {MouseEvent} e
   * @private
   */
  _onClick(e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;

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
