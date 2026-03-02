// navigation-stack.js - コードナビゲーション履歴管理

/**
 * NavigationStack manages browser-like back/forward navigation
 * for code navigation (definition jumps).
 */
export class NavigationStack {
  constructor() {
    this._stack = [];  // Array of { file, line, col, session }
    this._index = -1;  // Current position in stack
  }

  /**
   * Push a new location onto the stack.
   * Clears any forward history.
   */
  push(location) {
    // Remove forward history
    this._stack = this._stack.slice(0, this._index + 1);
    this._stack.push(location);
    this._index = this._stack.length - 1;
  }

  /**
   * Go back to the previous location.
   * @returns {Object|null} Previous location or null
   */
  back() {
    if (!this.canGoBack()) return null;
    this._index--;
    return this._stack[this._index];
  }

  /**
   * Go forward to the next location.
   * @returns {Object|null} Next location or null
   */
  forward() {
    if (!this.canGoForward()) return null;
    this._index++;
    return this._stack[this._index];
  }

  canGoBack() { return this._index > 0; }
  canGoForward() { return this._index < this._stack.length - 1; }

  /**
   * Get the current location.
   * @returns {Object|null}
   */
  current() {
    if (this._index < 0 || this._index >= this._stack.length) return null;
    return this._stack[this._index];
  }

  /**
   * Clear the navigation stack.
   */
  clear() {
    this._stack = [];
    this._index = -1;
  }
}
