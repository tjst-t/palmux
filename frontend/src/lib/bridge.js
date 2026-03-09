/**
 * Bridge module for accessing Svelte stores from Vanilla JS.
 *
 * Usage from existing JS code:
 *   import { stores } from '../src/lib/bridge.js';
 *   const sessions = stores.session.sessions;
 *   stores.ui.toolbarVisible = true;
 */
export { sessionStore as session } from '../stores/session.svelte.js';
export { windowStore as window } from '../stores/window.svelte.js';
export { panelStore as panel } from '../stores/panel.svelte.js';
export { uiStore as ui } from '../stores/ui.svelte.js';
export { notificationStore as notification } from '../stores/notification.svelte.js';
export { connectionStore as connection } from '../stores/connection.svelte.js';

import { sessionStore } from '../stores/session.svelte.js';
import { windowStore } from '../stores/window.svelte.js';
import { panelStore } from '../stores/panel.svelte.js';
import { uiStore } from '../stores/ui.svelte.js';
import { notificationStore } from '../stores/notification.svelte.js';
import { connectionStore } from '../stores/connection.svelte.js';

/** All stores as a single object for convenience */
export const stores = {
  session: sessionStore,
  window: windowStore,
  panel: panelStore,
  ui: uiStore,
  notification: notificationStore,
  connection: connectionStore,
};
