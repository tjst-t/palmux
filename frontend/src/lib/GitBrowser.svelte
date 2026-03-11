<script>
/**
 * GitBrowser.svelte - Svelte 5 wrapper around the Vanilla JS GitBrowser class
 * (gitbrowser.js).
 *
 * Accepts callback props and delegates all logic to the existing GitBrowser
 * implementation via a Svelte action.
 */
import { onDestroy } from 'svelte';
import { GitBrowser } from '../../js/gitbrowser.js';

let {
  onNavigate = undefined,
} = $props();

/** @type {GitBrowser|null} */
let browser = $state(null);

/**
 * Svelte action: mounts the GitBrowser class on the container element.
 * @param {HTMLElement} container
 */
function initGitBrowser(container) {
  browser = new GitBrowser(container, {
    onNavigate,
  });

  return {
    destroy() {
      if (browser) {
        browser.dispose();
        browser = null;
      }
    },
  };
}

onDestroy(() => {
  if (browser) {
    browser.dispose();
    browser = null;
  }
});

// ---------------------------------------------------------------------------
// Exported methods – delegates to the underlying GitBrowser instance
// ---------------------------------------------------------------------------

export async function open(session) {
  await browser?.open(session);
}

export function increaseFontSize() {
  browser?.increaseFontSize();
}

export function decreaseFontSize() {
  browser?.decreaseFontSize();
}

export function dispose() {
  if (browser) {
    browser.dispose();
    browser = null;
  }
}
</script>

<div class="gitbrowser-container" style="height: 100%; position: relative" use:initGitBrowser></div>
