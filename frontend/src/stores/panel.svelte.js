/**
 * Panel layout state store.
 * Manages split mode, focused panel, and divider position.
 */

const DIVIDER_STORAGE_KEY = 'palmux-divider-position';
const DEFAULT_DIVIDER = 50;

let splitMode = $state(false);
let focusedSide = $state('left');
let dividerPosition = $state(
  parseFloat(localStorage.getItem(DIVIDER_STORAGE_KEY)) || DEFAULT_DIVIDER
);

/** @typedef {'terminal' | 'filebrowser' | 'gitbrowser'} ViewMode */

/** Per-panel state */
let leftPanel = $state({
  session: null,
  windowIndex: null,
  viewMode: 'terminal',
});

let rightPanel = $state({
  session: null,
  windowIndex: null,
  viewMode: 'terminal',
});

export const panelStore = {
  get splitMode() { return splitMode; },
  set splitMode(value) { splitMode = value; },

  get focusedSide() { return focusedSide; },
  set focusedSide(value) { focusedSide = value; },

  get dividerPosition() { return dividerPosition; },
  set dividerPosition(value) {
    dividerPosition = Math.max(20, Math.min(80, value));
    localStorage.setItem(DIVIDER_STORAGE_KEY, String(dividerPosition));
  },

  get leftPanel() { return leftPanel; },
  get rightPanel() { return rightPanel; },

  /** Get the currently focused panel state */
  get focusedPanel() {
    return focusedSide === 'left' ? leftPanel : rightPanel;
  },

  /** Update left panel state */
  setLeftPanel(update) {
    leftPanel = { ...leftPanel, ...update };
  },

  /** Update right panel state */
  setRightPanel(update) {
    rightPanel = { ...rightPanel, ...update };
  },

  /** Toggle split mode */
  toggleSplit() {
    splitMode = !splitMode;
    if (!splitMode) {
      focusedSide = 'left';
    }
  },

  /** Switch focus to the other panel */
  switchFocus() {
    if (splitMode) {
      focusedSide = focusedSide === 'left' ? 'right' : 'left';
    }
  },
};
