// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../js/api.js', () => ({
  listSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  listGhqRepos: vi.fn(),
  cloneGhqRepo: vi.fn(),
  deleteGhqRepo: vi.fn(),
  listProjectWorktrees: vi.fn(),
  createProjectWorktree: vi.fn(),
  deleteProjectWorktree: vi.fn(),
  listProjectBranches: vi.fn(),
  isProjectBranchMerged: vi.fn(),
  deleteProjectBranch: vi.fn(),
}));

import { DrawerAdapter } from '../DrawerAdapter.js';

describe('DrawerAdapter', () => {
  let adapter;
  let drawerEl;

  beforeEach(() => {
    drawerEl = document.createElement('div');
    drawerEl.id = 'drawer';
    document.body.appendChild(drawerEl);
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.dispose(); } catch { /* already disposed */ }
      adapter = null;
    }
    drawerEl.remove();
    vi.restoreAllMocks();
  });

  it('mounts without error into #drawer', () => {
    expect(() => {
      adapter = new DrawerAdapter({
        onSelectSession: vi.fn(),
      });
    }).not.toThrow();
  });

  it('isOpen is false initially', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(adapter.isOpen).toBe(false);
  });

  it('isPinned is false initially', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(adapter.isPinned).toBe(false);
  });

  it('close() does not throw', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(() => {
      adapter.close();
      flushSync();
    }).not.toThrow();
  });

  it('setCurrent(session, windowIndex) does not throw', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(() => {
      adapter.setCurrent('test-session', 0);
    }).not.toThrow();
  });

  it('setNotifications([]) does not throw', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(() => {
      adapter.setNotifications([]);
    }).not.toThrow();
  });

  it('dispose() cleans up', () => {
    adapter = new DrawerAdapter({
      onSelectSession: vi.fn(),
    });
    expect(() => {
      adapter.dispose();
    }).not.toThrow();
    adapter = null;
  });
});
