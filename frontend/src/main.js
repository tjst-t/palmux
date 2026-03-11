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

// Mount root Svelte component
import { mount } from 'svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app') });

// Service worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
