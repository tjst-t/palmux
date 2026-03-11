<script>
/**
 * FileBrowser.svelte - Svelte 5 wrapper around the Vanilla JS FileBrowser class
 * (filebrowser.js).
 *
 * Accepts callback props and delegates all logic to the existing FileBrowser
 * implementation via a Svelte action.
 */
import { onDestroy } from 'svelte';
import { FileBrowser } from '../../js/filebrowser.js';

let {
  onFileSelect = undefined,
  onNavigate = undefined,
  onPreviewClose = undefined,
} = $props();

/** @type {FileBrowser|null} */
let browser = $state(null);

/**
 * Svelte action: mounts the FileBrowser class on the container element.
 * @param {HTMLElement} container
 */
function initBrowser(container) {
  browser = new FileBrowser(container, {
    onFileSelect,
    onNavigate,
    onPreviewClose,
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
// Exported methods – delegates to the underlying FileBrowser instance
// ---------------------------------------------------------------------------

export async function open(session, initialPath) {
  await browser?.open(session, initialPath);
}

export function getCurrentPath() {
  return browser?.getCurrentPath() ?? null;
}

export function getPreviewFile() {
  return browser?.getPreviewFile() ?? null;
}

export async function navigateTo(path) {
  await browser?.navigateTo(path);
}

export function showPreview(session, path, entry, opts) {
  browser?.showPreview(session, path, entry, opts);
}

export function setFontSize(size) {
  browser?.setFontSize(size);
}

export function increaseFontSize() {
  browser?.increaseFontSize();
}

export function decreaseFontSize() {
  browser?.decreaseFontSize();
}

export function getFontSize() {
  return browser?.getFontSize() ?? null;
}

export function dispose() {
  if (browser) {
    browser.dispose();
    browser = null;
  }
}
</script>

<div class="filebrowser-container" style="height: 100%" use:initBrowser></div>
