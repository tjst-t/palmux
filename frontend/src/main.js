// Vite entry point
// Import CSS files - Vite will bundle these
import '@xterm/xterm/css/xterm.css';
import 'highlight.js/styles/github-dark.css';
import '../css/style.css';
import '../css/context-menu.css';
import '../css/filebrowser.css';
import '../css/gitbrowser.css';
import '../css/split.css';
import '../css/tab.css';

// Initialize Svelte stores (available via bridge for Vanilla JS)
import { stores } from './lib/bridge.js';

// Expose stores globally for Vanilla JS access during migration
window.__palmuxStores = stores;

// Import existing Vanilla JS app (runs on import)
import '../js/app.js';

// Mount sample Svelte component to verify pipeline
import App from './App.svelte';
import { mountComponent } from './lib/mount.js';

// Mount a hidden Svelte component to prove the pipeline works
const svelteRoot = document.createElement('div');
svelteRoot.id = 'svelte-root';
document.body.appendChild(svelteRoot);
mountComponent(App, svelteRoot);

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

// Version display
const versionMeta = document.querySelector('meta[name="app-version"]');
const versionEl = document.getElementById('drawer-footer-version');
if (versionMeta && versionEl) {
  const v = versionMeta.getAttribute('content');
  if (v) versionEl.textContent = v;
}
