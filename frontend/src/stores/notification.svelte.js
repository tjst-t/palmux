/**
 * Notification state store.
 * Manages notification list and new notification detection.
 */
import { listNotifications, deleteNotification as apiDeleteNotification } from '../../js/api.js';

/** @typedef {{ session: string, window_index: number, type: string }} Notification */

let notifications = $state([]);
let prevKeys = $state(new Set());

export const notificationStore = {
  get notifications() { return notifications; },
  get count() { return notifications.length; },

  /** Fetch notifications and detect new ones. Returns newly added notifications. */
  async fetchNotifications() {
    const fetched = await listNotifications();
    const currentKeys = new Set();
    const newNotifications = [];

    for (const n of fetched) {
      const key = `${n.session}:${n.window_index}`;
      currentKeys.add(key);
      if (!prevKeys.has(key)) {
        newNotifications.push(n);
      }
    }

    prevKeys = currentKeys;
    notifications = fetched;
    return newNotifications;
  },

  /** Delete a notification */
  async deleteNotification(session, windowIndex) {
    await apiDeleteNotification(session, windowIndex);
    notifications = notifications.filter(
      n => !(n.session === session && n.window_index === windowIndex)
    );
  },

  /** Set notifications directly */
  setNotifications(newNotifications) {
    notifications = newNotifications;
  },

  /** Get notifications for a specific session */
  getSessionNotifications(session) {
    return notifications.filter(n => n.session === session);
  },

  /** Clear all notifications state */
  clear() {
    notifications = [];
    prevKeys = new Set();
  },
};
