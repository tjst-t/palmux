// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  getToolbarVisible, setToolbarVisible,
  getKeyboardMode, setKeyboardMode,
  getCtrlState, setCtrlState,
  getAltState, setAltState,
  getConnectionState, setConnectionState,
  getGlobalUIState, restoreState,
} from '../uiState.svelte.js';

describe('uiState store', () => {
  it('should have default values', () => {
    expect(getToolbarVisible()).toBe(null);
    expect(getKeyboardMode()).toBe('none');
    expect(getCtrlState()).toBe('off');
    expect(getAltState()).toBe('off');
    expect(getConnectionState()).toBe('disconnected');
  });

  it('should set toolbar visible', () => {
    setToolbarVisible(true);
    expect(getToolbarVisible()).toBe(true);
    setToolbarVisible(null);
  });

  it('should set keyboard mode', () => {
    setKeyboardMode('ime');
    expect(getKeyboardMode()).toBe('ime');
    setKeyboardMode('none');
  });

  it('should set ctrl state', () => {
    setCtrlState('locked');
    expect(getCtrlState()).toBe('locked');
    setCtrlState('off');
  });

  it('should set alt state', () => {
    setAltState('oneshot');
    expect(getAltState()).toBe('oneshot');
    setAltState('off');
  });

  it('should set connection state', () => {
    setConnectionState('connected');
    expect(getConnectionState()).toBe('connected');
    setConnectionState('disconnected');
  });

  it('should return globalUIState object', () => {
    const state = getGlobalUIState();
    expect(state).toHaveProperty('toolbarVisible');
    expect(state).toHaveProperty('keyboardMode');
    expect(state).toHaveProperty('ctrlState');
    expect(state).toHaveProperty('altState');
  });

  it('should restore state from object', () => {
    restoreState({
      toolbarVisible: false,
      keyboardMode: 'direct',
      ctrlState: 'oneshot',
      altState: 'locked',
    });
    expect(getToolbarVisible()).toBe(false);
    expect(getKeyboardMode()).toBe('direct');
    expect(getCtrlState()).toBe('oneshot');
    expect(getAltState()).toBe('locked');
    // Reset
    restoreState({ toolbarVisible: null, keyboardMode: 'none', ctrlState: 'off', altState: 'off' });
  });
});
