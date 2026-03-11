// uiState.svelte.js - Global UI state store

let toolbarVisible = $state(null);  // null = use device default
let keyboardMode = $state('none');  // 'none' | 'direct' | 'ime'
let ctrlState = $state('off');      // 'off' | 'oneshot' | 'locked'
let altState = $state('off');       // 'off' | 'oneshot' | 'locked'
let connectionState = $state('disconnected'); // 'connected' | 'connecting' | 'disconnected'

export function getToolbarVisible() { return toolbarVisible; }
export function setToolbarVisible(v) { toolbarVisible = v; }

export function getKeyboardMode() { return keyboardMode; }
export function setKeyboardMode(m) { keyboardMode = m; }

export function getCtrlState() { return ctrlState; }
export function setCtrlState(s) { ctrlState = s; }

export function getAltState() { return altState; }
export function setAltState(s) { altState = s; }

export function getConnectionState() { return connectionState; }
export function setConnectionState(s) { connectionState = s; }

/**
 * Get the full globalUIState object (compatible with existing code).
 * @returns {object}
 */
export function getGlobalUIState() {
  return {
    toolbarVisible,
    keyboardMode,
    ctrlState,
    altState,
  };
}

/**
 * Restore state from an object (e.g., from toolbar save).
 * @param {object} state
 */
export function restoreState(state) {
  if (state.toolbarVisible !== undefined) toolbarVisible = state.toolbarVisible;
  if (state.keyboardMode !== undefined) keyboardMode = state.keyboardMode;
  if (state.ctrlState !== undefined) ctrlState = state.ctrlState;
  if (state.altState !== undefined) altState = state.altState;
}

/**
 * Check if the device is mobile.
 * @returns {boolean}
 */
export function isMobileDevice() {
  return 'ontouchstart' in window && window.innerWidth <= 1024;
}
