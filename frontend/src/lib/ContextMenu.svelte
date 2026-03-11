<script>
/**
 * ContextMenu.svelte - Svelte 5 port of the ContextMenu class (context-menu.js).
 *
 * A generic, reusable context menu component.
 * Positions itself near the trigger point, adjusting to stay within the viewport.
 * Closes on click outside, scroll, or resize.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

import { onDestroy } from 'svelte';

/** @type {{ }} */
let {} = $props();

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let visible = $state(false);

/** @type {{x: number, y: number}} */
let position = $state({ x: 0, y: 0 });

/** @type {Array<{label: string, action: () => void, danger?: boolean}>} */
let items = $state([]);

/** @type {HTMLDivElement|undefined} */
let menuEl;

/** @type {number|null} rAF ID for deferred listener setup */
let _rafId = null;

// Adjusted position after viewport clamping
let adjustedX = $state(0);
let adjustedY = $state(0);
let positioned = $state(false);

// ---------------------------------------------------------------------------
// Global event handlers for closing
// ---------------------------------------------------------------------------

function onDocumentClick(e) {
  if (menuEl && !menuEl.contains(e.target)) {
    hide();
  }
}

function onScrollOrResize() {
  hide();
}

function addGlobalListeners() {
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('touchstart', onDocumentClick, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
}

function removeGlobalListeners() {
  document.removeEventListener('click', onDocumentClick, true);
  document.removeEventListener('touchstart', onDocumentClick, true);
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
}

// ---------------------------------------------------------------------------
// Exported methods
// ---------------------------------------------------------------------------

/**
 * Show the context menu at the given position with the given items.
 * @param {number} x - X coordinate (clientX)
 * @param {number} y - Y coordinate (clientY)
 * @param {Array<{label: string, action: () => void, danger?: boolean}>} menuItems
 */
export function show(x, y, menuItems) {
  // Close any existing menu first
  hide();

  position = { x, y };
  items = menuItems;
  positioned = false;
  visible = true;

  // Defer adding global listeners so the current click/touch event
  // that triggered the menu does not immediately close it.
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    addGlobalListeners();

    // Adjust position to stay within viewport
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = x;
      let top = y;
      if (left + rect.width > vw) left = vw - rect.width - 8;
      if (top + rect.height > vh) top = vh - rect.height - 8;
      if (left < 0) left = 8;
      if (top < 0) top = 8;

      adjustedX = left;
      adjustedY = top;
      positioned = true;
    }
  });
}

/**
 * Hide the context menu.
 */
export function hide() {
  if (!visible) return;
  visible = false;
  positioned = false;
  items = [];
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  removeGlobalListeners();
}

/**
 * Release all resources.
 */
export function dispose() {
  hide();
}

onDestroy(() => {
  removeGlobalListeners();
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
});

// ---------------------------------------------------------------------------
// Item click handler
// ---------------------------------------------------------------------------

function handleItemClick(e, item) {
  e.stopPropagation();
  hide();
  item.action();
}

/**
 * Prevent touchstart on the menu from propagating (avoids closing via overlay).
 */
function handleMenuTouch(e) {
  e.stopPropagation();
}
</script>

{#if visible}
  <div
    class="context-menu"
    bind:this={menuEl}
    style="position:fixed; left:{positioned ? adjustedX : position.x}px; top:{positioned ? adjustedY : position.y}px; {positioned ? '' : 'visibility:hidden;'}"
    ontouchstart={handleMenuTouch}
  >
    {#each items as item}
      <button
        class="context-menu-item{item.danger ? ' context-menu-item--danger' : ''}"
        onclick={(e) => handleItemClick(e, item)}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  /* context-menu.css - 共通コンテキストメニュースタイル */

  /* Overlay: 全画面、タップ受けて閉じる */
  :global(.context-menu-overlay) {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  :global(.context-menu-overlay--visible) {
    opacity: 1;
  }

  /* Menu container */
  .context-menu {
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: 12px;
    min-width: 200px;
    max-width: 280px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 200;
  }

  /* Title */
  :global(.context-menu__title) {
    padding: 14px 16px;
    font-size: 13px;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--menu-border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Menu item (button) */
  .context-menu-item {
    display: block;
    width: 100%;
    padding: 14px 16px;
    min-height: 44px;
    background: none;
    border: none;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
    color: var(--text-primary);
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .context-menu-item:last-child {
    border-bottom: none;
  }

  .context-menu-item:hover {
    background: var(--menu-hover);
  }

  .context-menu-item:active {
    background: var(--bg-active);
  }

  /* Danger variant */
  .context-menu-item--danger {
    color: var(--color-error-text);
  }

  .context-menu-item--danger:hover {
    background: rgba(229, 115, 115, 0.1);
  }

  /* Disabled state */
  .context-menu-item:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
  }

  .context-menu-item:disabled:hover {
    background: none;
  }

  /* ---- Light-mode overrides for remaining hardcoded dark-mode rgba values ---- */
  :global([data-theme="light"]) .context-menu {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  }

  :global([data-theme="light"]) .context-menu-item {
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="light"]) .context-menu-item--danger:hover {
    background: rgba(196, 30, 30, 0.08);
  }
</style>
