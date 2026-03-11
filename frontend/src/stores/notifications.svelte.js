// notifications.svelte.js - Notification state and Claude haptic detection

let notifications = $state([]);
let _prevNotificationKeys = new Set();

export function getNotifications() {
  return notifications;
}

/**
 * Update notifications list.
 * @param {Array<{session: string, window_index: number, type: string}>} newNotifications
 */
export function setNotifications(newNotifications) {
  notifications = newNotifications || [];
}

/**
 * Check for new Claude notifications and trigger haptic feedback.
 * @param {Array} newNotifications
 * @param {object} opts
 * @param {boolean} opts.isClaudeCodeMode
 * @param {string} opts.sessionName
 * @param {Array<{index: number, name: string}>} opts.windows
 * @returns {boolean} true if new Claude notification detected
 */
export function checkClaudeNotificationHaptic(newNotifications, { isClaudeCodeMode, sessionName, windows }) {
  const currentKeys = new Set();
  const claudeNotifications = [];

  for (const n of newNotifications) {
    const key = `${n.session}:${n.window_index}`;
    currentKeys.add(key);
    if (!_prevNotificationKeys.has(key)) {
      claudeNotifications.push(n);
    }
  }

  _prevNotificationKeys = currentKeys;

  if (claudeNotifications.length === 0) return false;

  const hasNewClaudeNotif = isClaudeCodeMode &&
    claudeNotifications.some(n => {
      if (n.session !== sessionName) return false;
      return windows.some(w => w.index === n.window_index && w.name === 'claude');
    });

  if (!hasNewClaudeNotif) return false;

  // Vibration
  if (navigator.vibrate) {
    navigator.vibrate([50, 100, 50]);
  }

  // Browser notification when page is hidden
  if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Claude Code', {
      body: 'Waiting for approval',
      tag: 'palmux-claude-approval',
    });
  }

  return true;
}

/**
 * Reset notification tracking state.
 */
export function resetTracking() {
  _prevNotificationKeys = new Set();
}
