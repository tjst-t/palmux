// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getNotifications, setNotifications,
  checkClaudeNotificationHaptic, resetTracking,
} from '../notifications.svelte.js';

beforeEach(() => {
  resetTracking();
  vi.stubGlobal('navigator', { vibrate: vi.fn() });
  vi.stubGlobal('document', { hidden: false });
});

describe('notifications store', () => {
  it('should start with empty notifications', () => {
    expect(getNotifications()).toEqual([]);
  });

  it('should set notifications', () => {
    setNotifications([{ session: 's1', window_index: 0, type: 'bell' }]);
    expect(getNotifications()).toHaveLength(1);
    setNotifications([]);
  });

  it('should handle null notifications', () => {
    setNotifications(null);
    expect(getNotifications()).toEqual([]);
  });
});

describe('checkClaudeNotificationHaptic', () => {
  it('should return false when no new notifications', () => {
    const result = checkClaudeNotificationHaptic([], {
      isClaudeCodeMode: true,
      sessionName: 'dev',
      windows: [{ index: 0, name: 'claude' }],
    });
    expect(result).toBe(false);
  });

  it('should return false when not in Claude mode', () => {
    const result = checkClaudeNotificationHaptic(
      [{ session: 'dev', window_index: 0, type: 'bell' }],
      { isClaudeCodeMode: false, sessionName: 'dev', windows: [{ index: 0, name: 'claude' }] }
    );
    expect(result).toBe(false);
  });

  it('should detect new Claude notifications and vibrate', () => {
    const result = checkClaudeNotificationHaptic(
      [{ session: 'dev', window_index: 0, type: 'bell' }],
      { isClaudeCodeMode: true, sessionName: 'dev', windows: [{ index: 0, name: 'claude' }] }
    );
    expect(result).toBe(true);
    expect(navigator.vibrate).toHaveBeenCalledWith([50, 100, 50]);
  });

  it('should not detect same notification twice', () => {
    checkClaudeNotificationHaptic(
      [{ session: 'dev', window_index: 0, type: 'bell' }],
      { isClaudeCodeMode: true, sessionName: 'dev', windows: [{ index: 0, name: 'claude' }] }
    );
    const result = checkClaudeNotificationHaptic(
      [{ session: 'dev', window_index: 0, type: 'bell' }],
      { isClaudeCodeMode: true, sessionName: 'dev', windows: [{ index: 0, name: 'claude' }] }
    );
    expect(result).toBe(false);
  });

  it('should return false for non-claude window', () => {
    const result = checkClaudeNotificationHaptic(
      [{ session: 'dev', window_index: 0, type: 'bell' }],
      { isClaudeCodeMode: true, sessionName: 'dev', windows: [{ index: 0, name: 'bash' }] }
    );
    expect(result).toBe(false);
  });
});
