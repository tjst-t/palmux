// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolbarAdapter } from '../ToolbarAdapter.js';

describe('ToolbarAdapter', () => {
  let adapter;
  let container;
  let onSendKey;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onSendKey = vi.fn();
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.dispose(); } catch { /* already disposed */ }
      adapter = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('mounts without error', () => {
    expect(() => {
      adapter = new ToolbarAdapter(container, { onSendKey });
    }).not.toThrow();
  });

  it('consumeModifiers() returns { ctrl: false, alt: false } initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    const mods = adapter.consumeModifiers();
    expect(mods).toEqual({ ctrl: false, alt: false });
  });

  it('hasCtrl() returns false initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.hasCtrl()).toBe(false);
  });

  it('hasAlt() returns false initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.hasAlt()).toBe(false);
  });

  it('visible getter works', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    // Toolbar is visible by default
    expect(typeof adapter.visible).toBe('boolean');
    expect(adapter.visible).toBe(true);
  });

  it('keyboardMode returns "none" initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.keyboardMode).toBe('none');
  });

  it('ctrlState returns "off" initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.ctrlState).toBe('off');
  });

  it('altState returns "off" initially', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.altState).toBe('off');
  });

  it('toggleVisibility() toggles visible state', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(adapter.visible).toBe(true);
    adapter.toggleVisibility();
    flushSync();
    expect(adapter.visible).toBe(false);
  });

  it('dispose() does not throw', () => {
    adapter = new ToolbarAdapter(container, { onSendKey });
    expect(() => {
      adapter.dispose();
    }).not.toThrow();
    adapter = null;
  });
});
