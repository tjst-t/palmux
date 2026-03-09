<script>
/**
 * TabBar.svelte - Svelte 5 port of the Vanilla JS TabBar class (tab-bar.js).
 *
 * Displays terminal windows, Files, and Git tabs in a horizontally
 * scrollable bar that sits inside the header.
 *
 * Tab ordering (Claude Code mode):
 *   Claude windows -> Files -> Git -> non-Claude terminals -> + button
 *
 * Tab ordering (non-Claude Code mode):
 *   Files -> Git -> terminals -> + button
 */

// ---------------------------------------------------------------------------
// SVG icon markup constants
// ---------------------------------------------------------------------------

const CLAUDE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(45 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(90 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(135 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(180 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(225 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(270 12 12)"/><ellipse cx="12" cy="5.5" rx="1.5" ry="4.5" transform="rotate(315 12 12)"/></svg>';

const TERMINAL_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="2,4 6,7 2,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="10" x2="12" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

const FILES_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1.5 3.5h4l1.5 1.5h5.5v6.5h-11z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

const GIT_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="4" cy="4" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="4" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="11" r="1.5" stroke="currentColor" stroke-width="1.3"/><line x1="4" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.3"/><line x1="10" y1="5.5" x2="7" y2="9.5" stroke="currentColor" stroke-width="1.3"/></svg>';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** @type {{ onSelect: (type: string, windowIndex?: number) => void, onContextMenu: (event: {x: number, y: number, isMobile: boolean}, type: string, windowIndex?: number) => void }} */
let {
  onSelect,
  onContextMenu = null,
} = $props();

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

/** @type {string|null} */
let sessionName = $state(null);

/** @type {boolean} */
let isClaudeCodeMode = $state(false);

/** @type {Array<{index: number, name: string, active: boolean}>} */
let windows = $state([]);

/** @type {{type: string, windowIndex?: number}|null} */
let activeTab = $state(null);

/** @type {Array<{session: string, window_index: number, type: string}>} */
let notifications = $state([]);

// ---------------------------------------------------------------------------
// Derived: ordered tabs
// ---------------------------------------------------------------------------

/**
 * @typedef {{kind: 'terminal', win: {index: number, name: string}, isClaude: boolean}} TerminalTabDef
 * @typedef {{kind: 'files'}} FilesTabDef
 * @typedef {{kind: 'git'}} GitTabDef
 * @typedef {{kind: 'add'}} AddTabDef
 * @typedef {TerminalTabDef | FilesTabDef | GitTabDef | AddTabDef} TabDef
 */

/** @type {TabDef[]} */
let orderedTabs = $derived.by(() => {
  /** @type {TabDef[]} */
  const tabs = [];

  const claudeWindows = [];
  const nonClaudeWindows = [];
  for (const win of windows) {
    if (isClaudeCodeMode && win.name === 'claude') {
      claudeWindows.push(win);
    } else {
      nonClaudeWindows.push(win);
    }
  }

  // 1. Claude windows
  for (const win of claudeWindows) {
    tabs.push({ kind: 'terminal', win, isClaude: true });
  }

  // 2. Files tab
  tabs.push({ kind: 'files' });

  // 3. Git tab
  tabs.push({ kind: 'git' });

  // 4. Non-claude terminals
  for (const win of nonClaudeWindows) {
    tabs.push({ kind: 'terminal', win, isClaude: false });
  }

  // 5. Add button
  tabs.push({ kind: 'add' });

  return tabs;
});

/** Notification set for fast lookups */
let notificationSet = $derived.by(() => {
  const set = new Set();
  if (sessionName) {
    for (const n of notifications) {
      if (n.session === sessionName) {
        set.add(n.window_index);
      }
    }
  }
  return set;
});

// ---------------------------------------------------------------------------
// Tab active check
// ---------------------------------------------------------------------------

function isActive(tab) {
  if (!activeTab) return false;
  if (tab.kind === 'terminal') {
    return activeTab.type === 'terminal' && activeTab.windowIndex === tab.win.index;
  }
  if (tab.kind === 'files') return activeTab.type === 'files';
  if (tab.kind === 'git') return activeTab.type === 'git';
  return false;
}

function hasNotification(tab) {
  if (tab.kind !== 'terminal') return false;
  return notificationSet.has(tab.win.index);
}

function isClaudeNotification(tab) {
  return hasNotification(tab) && isClaudeCodeMode && tab.isClaude;
}

// ---------------------------------------------------------------------------
// Drag scrolling (touch + mouse)
// ---------------------------------------------------------------------------

let scrollEl;
let isDragging = false;
let dragStartX = 0;
let dragScrollLeft = 0;
let hasDragged = false;

function onPointerDown(e) {
  // Only handle primary button for mouse
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  isDragging = true;
  hasDragged = false;
  dragStartX = e.clientX;
  dragScrollLeft = scrollEl.scrollLeft;
  scrollEl.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  if (Math.abs(dx) > 5) hasDragged = true;
  scrollEl.scrollLeft = dragScrollLeft - dx;
}

function onPointerUp(e) {
  isDragging = false;
  scrollEl.releasePointerCapture(e.pointerId);
}

// ---------------------------------------------------------------------------
// Long press for context menu (touch devices)
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 500;
let longPressTimer = null;
let longPressTriggered = false;
let longPressStartX = 0;
let longPressStartY = 0;

function startLongPress(e, type, windowIndex) {
  // Only for touch
  if (e.pointerType !== 'touch') return;
  longPressTriggered = false;
  longPressStartX = e.clientX;
  longPressStartY = e.clientY;

  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    if (onContextMenu) {
      onContextMenu(
        { x: e.clientX, y: e.clientY, isMobile: true },
        type,
        windowIndex,
      );
    }
  }, LONG_PRESS_MS);
}

function moveLongPress(e) {
  if (longPressTimer === null) return;
  const dx = Math.abs(e.clientX - longPressStartX);
  const dy = Math.abs(e.clientY - longPressStartY);
  if (dx > 10 || dy > 10) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function cancelLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Click / context menu handlers
// ---------------------------------------------------------------------------

function handleTabClick(e, tab) {
  // Suppress click after drag
  if (hasDragged) return;
  // Suppress click after long press
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }

  if (tab.kind === 'add') {
    if (onSelect) onSelect('add');
    return;
  }
  if (tab.kind === 'terminal') {
    if (onSelect) onSelect('terminal', tab.win.index);
  } else if (tab.kind === 'files') {
    if (onSelect) onSelect('files');
  } else if (tab.kind === 'git') {
    if (onSelect) onSelect('git');
  }
}

function handleRightClick(e, tab) {
  if (tab.kind !== 'terminal') return;
  e.preventDefault();
  if (onContextMenu) {
    onContextMenu(
      { x: e.clientX, y: e.clientY, isMobile: false },
      'terminal',
      tab.win.index,
    );
  }
}

// ---------------------------------------------------------------------------
// Exported methods
// ---------------------------------------------------------------------------

/**
 * Set the windows to render as tabs.
 * @param {string} session - Current session name
 * @param {Array<{index: number, name: string, active: boolean}>} wins
 * @param {boolean} claudeMode - Whether the session is in Claude Code mode
 */
export function setWindows(session, wins, claudeMode) {
  sessionName = session;
  windows = wins;
  isClaudeCodeMode = claudeMode;
}

/**
 * Mark a tab as active.
 * @param {{type: string, windowIndex?: number}} tab
 */
export function setActiveTab(tab) {
  activeTab = tab;
}

/**
 * Show notification badges on tabs.
 * @param {Array<{session: string, window_index: number, type: string}>} notifs
 */
export function setNotifications(notifs) {
  notifications = notifs;
}

/**
 * Release resources.
 */
export function dispose() {
  cancelLongPress();
  sessionName = null;
  windows = [];
  activeTab = null;
  notifications = [];
}
</script>

<div class="tab-bar">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tab-bar-scroll"
    bind:this={scrollEl}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    {#each orderedTabs as tab}
      {#if tab.kind === 'terminal'}
        <button
          class="tab"
          class:tab--active={isActive(tab)}
          data-type="terminal"
          data-window={tab.win.index}
          data-window-name={tab.win.name}
          onclick={(e) => handleTabClick(e, tab)}
          oncontextmenu={(e) => handleRightClick(e, tab)}
          onpointerdown={(e) => startLongPress(e, 'terminal', tab.win.index)}
          onpointermove={moveLongPress}
          onpointerup={cancelLongPress}
          onpointercancel={cancelLongPress}
        >
          <span class="tab-icon">{@html tab.isClaude ? CLAUDE_ICON : TERMINAL_ICON}</span>
          <span class="tab-label">{tab.win.name}</span>
          {#if hasNotification(tab)}
            <span
              class="tab-notification"
              class:tab-notification--claude={isClaudeNotification(tab)}
            ></span>
          {/if}
        </button>
      {:else if tab.kind === 'files'}
        <button
          class="tab"
          class:tab--active={isActive(tab)}
          data-type="files"
          onclick={(e) => handleTabClick(e, tab)}
        >
          <span class="tab-icon">{@html FILES_ICON}</span>
          <span class="tab-label">Files</span>
        </button>
      {:else if tab.kind === 'git'}
        <button
          class="tab"
          class:tab--active={isActive(tab)}
          data-type="git"
          onclick={(e) => handleTabClick(e, tab)}
        >
          <span class="tab-icon">{@html GIT_ICON}</span>
          <span class="tab-label">Git</span>
        </button>
      {:else if tab.kind === 'add'}
        <button
          class="tab tab-add"
          data-type="add"
          onclick={(e) => handleTabClick(e, tab)}
        >+</button>
      {/if}
    {/each}
  </div>
</div>
