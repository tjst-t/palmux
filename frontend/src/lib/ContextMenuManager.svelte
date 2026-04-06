<script>
/**
 * ContextMenuManager.svelte - 全コンテキストメニューの統合 Svelte コンポーネント
 *
 * App.svelte の document.createElement ベースのメニューを置換。
 * 4 種類のメニュー/ダイアログをサポート:
 *   - contextMenu: 汎用コンテキストメニュー（サブメニュー対応）
 *   - modelSelect: Claude モデル選択ダイアログ
 *   - rename: ウィンドウリネームダイアログ
 *   - portmanUrl: Portman URL 選択メニュー
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * @typedef {
 *   | { type: 'closed' }
 *   | { type: 'contextMenu', x: number, y: number, items: Array, isMobile: boolean }
 *   | { type: 'modelSelect', sessionName: string, baseCommand: string }
 *   | { type: 'rename', sessionName: string, windowIndex: number, currentName: string }
 *   | { type: 'portmanUrl', leases: Array }
 * } MenuState
 */

/** @type {MenuState} */
let menuState = $state({ type: 'closed' });

/** @type {Set<string>} open submenu labels */
let openSubmenus = $state(new Set());

/** @type {HTMLInputElement|null} */
let renameInputEl = $state(null);

// ---------------------------------------------------------------------------
// Props (callbacks)
// ---------------------------------------------------------------------------

let {
  models = [],
  onRestartClaude = null,
  onRenameWindow = null,
  onRefreshTabBar = null,
} = $props();

// ---------------------------------------------------------------------------
// Exported methods
// ---------------------------------------------------------------------------

export function showContextMenu(x, y, items, isMobile = false) {
  openSubmenus = new Set();
  menuState = { type: 'contextMenu', x, y, items, isMobile };
}

export function showModelSelect(sessionName, baseCommand) {
  menuState = { type: 'modelSelect', sessionName, baseCommand };
}

export function showRename(sessionName, windowIndex, currentName) {
  menuState = { type: 'rename', sessionName, windowIndex, currentName };
}

export function showPortmanUrls(leases) {
  menuState = { type: 'portmanUrl', leases };
}

export function close() {
  menuState = { type: 'closed' };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) {
    menuState = { type: 'closed' };
  }
}

function handleItemClick(item) {
  menuState = { type: 'closed' };
  item.action();
}

function toggleSubmenu(label) {
  const next = new Set(openSubmenus);
  if (next.has(label)) next.delete(label);
  else next.add(label);
  openSubmenus = next;
}

async function handleModelSelect(model) {
  if (menuState.type !== 'modelSelect') return;
  const { sessionName, baseCommand } = menuState;
  menuState = { type: 'closed' };
  if (onRestartClaude) {
    await onRestartClaude(sessionName, `${baseCommand} --model ${model.flag}`);
  }
}

async function handleRenameSubmit() {
  if (menuState.type !== 'rename' || !renameInputEl) return;
  const newName = renameInputEl.value.trim();
  const { sessionName, windowIndex, currentName } = menuState;
  if (!newName || newName === currentName) {
    menuState = { type: 'closed' };
    return;
  }
  menuState = { type: 'closed' };
  if (onRenameWindow) {
    await onRenameWindow(sessionName, windowIndex, newName);
  }
}

function handleRenameKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); handleRenameSubmit(); }
  else if (e.key === 'Escape') { e.preventDefault(); menuState = { type: 'closed' }; }
}

function handlePortmanClick(lease) {
  menuState = { type: 'closed' };
  window.open(lease.url, '_blank');
}

// Focus rename input when dialog appears
$effect(() => {
  if (menuState.type === 'rename' && renameInputEl) {
    renameInputEl.focus();
    renameInputEl.select();
  }
});

// Desktop menu positioning
let menuEl = $state(null);
let adjustedStyle = $state('');

$effect(() => {
  if (menuState.type === 'contextMenu' && !menuState.isMobile && menuEl) {
    // Need to wait a tick for the menu to render
    requestAnimationFrame(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = menuState.x;
      let top = menuState.y;
      if (left + rect.width > vw) left = Math.max(0, vw - rect.width - 8);
      if (top + rect.height > vh) top = Math.max(0, vh - rect.height - 8);
      adjustedStyle = `position:absolute;left:${left}px;top:${top}px`;
    });
  } else {
    adjustedStyle = '';
  }
});
</script>

{#if menuState.type !== 'closed'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-menu-overlay"
    class:context-menu-overlay--visible={true}
    class:context-menu-overlay--desktop={menuState.type === 'contextMenu' && !menuState.isMobile}
    onclick={handleOverlayClick}
  >
    {#if menuState.type === 'contextMenu'}
      <!-- 汎用コンテキストメニュー -->
      <div class="context-menu" bind:this={menuEl} style={!menuState.isMobile ? adjustedStyle : ''}>
        {#each menuState.items as item}
          {#if item.separator}
            <div class="context-menu__separator"></div>
          {:else if item.submenu}
            <div class="context-menu__submenu-wrapper" class:context-menu__submenu-wrapper--open={openSubmenus.has(item.label)}>
              <button class="context-menu__submenu-trigger" onclick={(e) => { e.stopPropagation(); toggleSubmenu(item.label); }}>
                {item.label}
              </button>
              <div class="context-menu__submenu">
                {#each item.submenu as subItem}
                  <button class="context-menu__item" onclick={() => handleItemClick(subItem)}>
                    {subItem.label}
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <button class="context-menu__item" onclick={() => handleItemClick(item)}>
              {item.label}
            </button>
          {/if}
        {/each}
      </div>

    {:else if menuState.type === 'modelSelect'}
      <!-- モデル選択ダイアログ -->
      <div class="context-menu">
        <div class="context-menu__title">Select Model</div>
        {#each models as model}
          <button class="context-menu__item" onclick={() => handleModelSelect(model)}>
            {model.label}
          </button>
        {/each}
      </div>

    {:else if menuState.type === 'rename'}
      <!-- リネームダイアログ -->
      <div class="context-menu">
        <div class="context-menu__title">Rename Window</div>
        <div style="padding: 12px 16px">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:this={renameInputEl}
            type="text"
            value={menuState.currentName}
            class="drawer-window-rename-input"
            style="width:100%;box-sizing:border-box"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            onkeydown={handleRenameKeydown}
          />
        </div>
      </div>

    {:else if menuState.type === 'portmanUrl'}
      <!-- Portman URL メニュー -->
      <div class="context-menu">
        <div class="context-menu__title">Open URL</div>
        {#each menuState.leases as lease}
          <button class="context-menu__item" onclick={() => handlePortmanClick(lease)}>
            {lease.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .context-menu-overlay--desktop {
    align-items: flex-start;
    justify-content: flex-start;
  }
</style>
