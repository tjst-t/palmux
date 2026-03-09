/**
 * UI state store.
 * Manages toolbar visibility, keyboard mode, modifier key states.
 */

let toolbarVisible = $state(null);  // null = uninitialized (use device default)
let keyboardMode = $state('none');  // 'none' | 'ime'
let ctrlState = $state('off');      // 'off' | 'on'
let altState = $state('off');       // 'off' | 'on'
let drawerOpen = $state(false);
let drawerPinned = $state(
  localStorage.getItem('palmux-drawer-pinned') === 'true'
);

export const uiStore = {
  get toolbarVisible() { return toolbarVisible; },
  set toolbarVisible(value) { toolbarVisible = value; },

  get keyboardMode() { return keyboardMode; },
  set keyboardMode(value) { keyboardMode = value; },

  get ctrlState() { return ctrlState; },
  set ctrlState(value) { ctrlState = value; },

  get altState() { return altState; },
  set altState(value) { altState = value; },

  get drawerOpen() { return drawerOpen; },
  set drawerOpen(value) { drawerOpen = value; },

  get drawerPinned() { return drawerPinned; },
  set drawerPinned(value) {
    drawerPinned = value;
    localStorage.setItem('palmux-drawer-pinned', String(value));
  },

  /** Get snapshot of toolbar-related state (for saving/restoring across tabs) */
  getToolbarState() {
    return {
      toolbarVisible,
      keyboardMode,
      ctrlState,
      altState,
    };
  },

  /** Restore toolbar state from a snapshot */
  setToolbarState(state) {
    if (state.toolbarVisible !== undefined) toolbarVisible = state.toolbarVisible;
    if (state.keyboardMode !== undefined) keyboardMode = state.keyboardMode;
    if (state.ctrlState !== undefined) ctrlState = state.ctrlState;
    if (state.altState !== undefined) altState = state.altState;
  },

  /** Reset modifier keys */
  resetModifiers() {
    ctrlState = 'off';
    altState = 'off';
  },
};
