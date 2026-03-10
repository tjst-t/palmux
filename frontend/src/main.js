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

// Import existing Vanilla JS app (runs on import)
import '../js/app.js';

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
