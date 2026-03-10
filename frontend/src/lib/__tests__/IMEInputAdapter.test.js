// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IMEInputAdapter } from '../IMEInputAdapter.js';

describe('IMEInputAdapter', () => {
  let adapter;
  let container;
  let onSend;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onSend = vi.fn();
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.dispose(); } catch { /* already disposed */ }
      adapter = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('mounts without error and is initially hidden', () => {
    expect(() => {
      adapter = new IMEInputAdapter(container, { onSend });
    }).not.toThrow();
    expect(adapter.isVisible).toBe(false);
  });

  it('show() makes it visible', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    adapter.show();
    flushSync();
    expect(adapter.isVisible).toBe(true);
  });

  it('hide() makes it hidden', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    adapter.show();
    flushSync();
    adapter.hide();
    flushSync();
    expect(adapter.isVisible).toBe(false);
  });

  it('toggle() switches visibility', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    expect(adapter.isVisible).toBe(false);

    adapter.toggle();
    flushSync();
    expect(adapter.isVisible).toBe(true);

    adapter.toggle();
    flushSync();
    expect(adapter.isVisible).toBe(false);
  });

  it('insertText() appends to input', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    adapter.show();
    flushSync();

    adapter.insertText('hello');
    flushSync();

    const input = container.querySelector('.ime-input-field');
    expect(input).not.toBeNull();
    expect(input.value).toBe('hello');
  });

  it('getBarElement() returns .ime-input-bar element', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    const bar = adapter.getBarElement();
    expect(bar).not.toBeNull();
    expect(bar.classList.contains('ime-input-bar')).toBe(true);
  });

  it('dispose() does not throw', () => {
    adapter = new IMEInputAdapter(container, { onSend });
    expect(() => {
      adapter.dispose();
    }).not.toThrow();
    adapter = null;
  });
});
