// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextMenuAdapter } from '../ContextMenuAdapter.js';

describe('ContextMenuAdapter', () => {
  let adapter;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
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
      adapter = new ContextMenuAdapter(container);
    }).not.toThrow();
  });

  it('show() with MouseEvent renders menu items', () => {
    adapter = new ContextMenuAdapter(container);
    const items = [
      { label: 'Copy', action: vi.fn() },
      { label: 'Paste', action: vi.fn() },
    ];
    const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 200 });
    adapter.show(event, items);
    flushSync();

    const menuEl = container.querySelector('.context-menu');
    expect(menuEl).not.toBeNull();
    const buttons = menuEl.querySelectorAll('.context-menu-item');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent.trim()).toBe('Copy');
    expect(buttons[1].textContent.trim()).toBe('Paste');
  });

  it('show() with TouchEvent works', () => {
    adapter = new ContextMenuAdapter(container);
    const items = [{ label: 'Touch Item', action: vi.fn() }];
    // Create a touch-like event with touches array
    const event = {
      touches: [{ clientX: 50, clientY: 60 }],
      preventDefault: vi.fn(),
    };
    adapter.show(event, items);
    flushSync();

    const menuEl = container.querySelector('.context-menu');
    expect(menuEl).not.toBeNull();
    const buttons = menuEl.querySelectorAll('.context-menu-item');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent.trim()).toBe('Touch Item');
  });

  it('hide() removes the menu', () => {
    adapter = new ContextMenuAdapter(container);
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 20 });
    adapter.show(event, [{ label: 'Test', action: vi.fn() }]);
    flushSync();
    expect(container.querySelector('.context-menu')).not.toBeNull();

    adapter.hide();
    flushSync();
    expect(container.querySelector('.context-menu')).toBeNull();
  });

  it('dispose() does not throw', () => {
    adapter = new ContextMenuAdapter(container);
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 20 });
    adapter.show(event, [{ label: 'Test', action: vi.fn() }]);
    flushSync();

    expect(() => {
      adapter.dispose();
    }).not.toThrow();
    adapter = null; // prevent double dispose in afterEach
  });
});
