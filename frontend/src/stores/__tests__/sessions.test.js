// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  getSessions, setSessions,
  getCurrentSession, setCurrentSession,
  getCurrentWindows, setCurrentWindows,
  getIsClaudeCodeMode, setIsClaudeCodeMode,
  isClaudeWindow, getLatestSession,
  getLoading, setLoading,
  getError, setError,
} from '../sessions.svelte.js';

describe('sessions store', () => {
  it('should start with empty sessions', () => {
    expect(getSessions()).toEqual([]);
    expect(getCurrentSession()).toBe(null);
    expect(getCurrentWindows()).toEqual([]);
  });

  it('should set sessions', () => {
    setSessions([{ name: 'dev', windows: 3 }]);
    expect(getSessions()).toHaveLength(1);
    setSessions([]);
  });

  it('should handle null sessions', () => {
    setSessions(null);
    expect(getSessions()).toEqual([]);
  });

  it('should set current session', () => {
    setCurrentSession('dev');
    expect(getCurrentSession()).toBe('dev');
    setCurrentSession(null);
  });

  it('should set windows', () => {
    setCurrentWindows([{ index: 0, name: 'bash' }, { index: 1, name: 'claude' }]);
    expect(getCurrentWindows()).toHaveLength(2);
    setCurrentWindows([]);
  });

  it('should set loading state', () => {
    setLoading(true);
    expect(getLoading()).toBe(true);
    setLoading(false);
  });

  it('should set error state', () => {
    setError('Network error');
    expect(getError()).toBe('Network error');
    setError(null);
  });
});

describe('isClaudeWindow', () => {
  it('should return false when not in claude mode', () => {
    setIsClaudeCodeMode(false);
    setCurrentWindows([{ index: 0, name: 'claude' }]);
    expect(isClaudeWindow(0)).toBe(false);
    setCurrentWindows([]);
  });

  it('should return true for claude window in claude mode', () => {
    setIsClaudeCodeMode(true);
    setCurrentWindows([{ index: 0, name: 'bash' }, { index: 1, name: 'claude' }]);
    expect(isClaudeWindow(1)).toBe(true);
    expect(isClaudeWindow(0)).toBe(false);
    setIsClaudeCodeMode(false);
    setCurrentWindows([]);
  });
});

describe('getLatestSession', () => {
  it('should return null for empty sessions', () => {
    setSessions([]);
    expect(getLatestSession()).toBe(null);
  });

  it('should return the most recent session by activity', () => {
    setSessions([
      { name: 'old', activity: '2024-01-01T00:00:00Z' },
      { name: 'new', activity: '2024-06-01T00:00:00Z' },
      { name: 'mid', activity: '2024-03-01T00:00:00Z' },
    ]);
    expect(getLatestSession().name).toBe('new');
    setSessions([]);
  });
});
