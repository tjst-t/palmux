/**
 * Connection state store.
 * Tracks WebSocket connection status per panel.
 */

/** @typedef {'connected' | 'connecting' | 'disconnected'} ConnectionState */

let leftState = $state('disconnected');
let rightState = $state('disconnected');
let leftRetryCount = $state(0);
let rightRetryCount = $state(0);

export const connectionStore = {
  get leftState() { return leftState; },
  set leftState(value) { leftState = value; },

  get rightState() { return rightState; },
  set rightState(value) { rightState = value; },

  get leftRetryCount() { return leftRetryCount; },
  set leftRetryCount(value) { leftRetryCount = value; },

  get rightRetryCount() { return rightRetryCount; },
  set rightRetryCount(value) { rightRetryCount = value; },

  /** Get state for a specific side */
  getState(side) {
    return side === 'left' ? leftState : rightState;
  },

  /** Set state for a specific side */
  setState(side, state) {
    if (side === 'left') {
      leftState = state;
    } else {
      rightState = state;
    }
  },

  /** Set retry count for a specific side */
  setRetryCount(side, count) {
    if (side === 'left') {
      leftRetryCount = count;
    } else {
      rightRetryCount = count;
    }
  },

  /** Reset all connection state */
  reset() {
    leftState = 'disconnected';
    rightState = 'disconnected';
    leftRetryCount = 0;
    rightRetryCount = 0;
  },
};
