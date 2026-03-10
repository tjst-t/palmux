// @vitest-environment happy-dom
import { flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInputAdapter } from '../VoiceInputAdapter.js';

describe('VoiceInputAdapter', () => {
  let adapter;
  let container;
  let onResult;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    onResult = vi.fn();
  });

  afterEach(() => {
    if (adapter) {
      try { adapter.dispose(); } catch { /* already disposed */ }
      adapter = null;
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('isSupported() returns a boolean', () => {
    const result = VoiceInputAdapter.isSupported();
    expect(typeof result).toBe('boolean');
  });

  it('mounts a button into the container', () => {
    adapter = new VoiceInputAdapter(container, { onResult });
    flushSync();

    const btn = container.querySelector('.voice-mic-btn');
    expect(btn).not.toBeNull();
  });

  it('mounts button before .ime-send-btn if present', () => {
    // Add a send button to test insertion order
    const sendBtn = document.createElement('button');
    sendBtn.className = 'ime-send-btn';
    container.appendChild(sendBtn);

    adapter = new VoiceInputAdapter(container, { onResult });
    flushSync();

    // The anchor should be inserted before the send button
    const children = Array.from(container.children);
    const anchorIdx = children.findIndex(el => el.tagName === 'SPAN');
    const sendIdx = children.indexOf(sendBtn);
    expect(anchorIdx).toBeLessThan(sendIdx);
  });

  it('initial state is idle', () => {
    adapter = new VoiceInputAdapter(container, { onResult });
    expect(adapter.state).toBe('idle');
  });

  it('dispose() removes the anchor element from DOM', () => {
    adapter = new VoiceInputAdapter(container, { onResult });
    flushSync();

    // Verify anchor exists
    const anchorBefore = container.querySelector('span');
    expect(anchorBefore).not.toBeNull();

    adapter.dispose();
    adapter = null;

    // Anchor should be removed
    const anchorAfter = container.querySelector('span');
    expect(anchorAfter).toBeNull();
  });
});
