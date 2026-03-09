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
  requestAnimationFrame(() => {
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
  removeGlobalListeners();
}

/**
 * Release all resources.
 */
export function dispose() {
  hide();
}

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
