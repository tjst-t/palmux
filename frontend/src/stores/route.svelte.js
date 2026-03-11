// route.svelte.js - Reactive route store for hash-based navigation

/**
 * @typedef {object} RouteState
 * @property {'sessions'|'windows'|'terminal'|'files'|'git'} view
 * @property {string} [session]
 * @property {number} [window]
 * @property {string} [filePath]
 * @property {string|null} [previewFile]
 * @property {object|null} [gitState]
 * @property {boolean} [split]
 * @property {object|null} [rightPanel]
 */

let _current = $state({ view: 'sessions' });
let _suppressed = false;

export function getCurrent() {
  return _current;
}

/**
 * Parse a URL hash into a RouteState.
 * @param {string} hash - e.g. "#terminal/dev/0" or "#files/dev/0/path&split=terminal/dev/1"
 * @returns {{ state: RouteState, hasSplit: boolean, rightFragment: string|null }}
 */
export function parseHash(hash) {
  const hashBody = hash.slice(1);
  const splitIdx = hashBody.indexOf('&split');
  let hasSplit = false;
  let rightFragment = null;
  let cleanHash = hashBody;

  if (splitIdx !== -1) {
    hasSplit = true;
    cleanHash = hashBody.slice(0, splitIdx);
    const splitPart = hashBody.slice(splitIdx + 6);
    if (splitPart.startsWith('=') && splitPart.length > 1) {
      rightFragment = splitPart.slice(1);
    }
  }

  const parts = cleanHash.split('/');
  const view = parts[0] || 'sessions';

  const state = { view };

  switch (view) {
    case 'windows':
      state.session = decodeURIComponent(parts[1] || '');
      break;
    case 'terminal':
      state.session = decodeURIComponent(parts[1] || '');
      state.window = parseInt(parts[2], 10);
      break;
    case 'files':
      state.session = decodeURIComponent(parts[1] || '');
      state.window = parseInt(parts[2], 10);
      state.filePath = parts.slice(3).map(decodeURIComponent).join('/') || '.';
      break;
    case 'git':
      state.session = decodeURIComponent(parts[1] || '');
      state.window = parseInt(parts[2], 10);
      break;
  }

  state.split = hasSplit;
  return { state, hasSplit, rightFragment };
}

/**
 * Build a URL hash string from a RouteState.
 * @param {RouteState} state
 * @returns {string}
 */
export function buildHash(state) {
  let hash = '';

  switch (state.view) {
    case 'sessions':
      hash = '#sessions';
      break;
    case 'windows':
      hash = `#windows/${encodeURIComponent(state.session || '')}`;
      break;
    case 'terminal':
      hash = `#terminal/${encodeURIComponent(state.session || '')}/${state.window ?? 0}`;
      break;
    case 'files': {
      const s = encodeURIComponent(state.session || '');
      const w = state.window ?? 0;
      const path = state.filePath || '.';
      hash = `#files/${s}/${w}${path !== '.' ? '/' + path : ''}`;
      break;
    }
    case 'git':
      hash = `#git/${encodeURIComponent(state.session || '')}/${state.window ?? 0}`;
      break;
    default:
      hash = '#sessions';
  }

  if (state.split) {
    if (state.rightPanel) {
      const rp = state.rightPanel;
      const rs = encodeURIComponent(rp.session || '');
      let rightFrag = `terminal/${rs}/${rp.window ?? 0}`;
      if (rp.view === 'files') {
        rightFrag = `files/${rs}/${rp.window ?? 0}${rp.path && rp.path !== '.' ? '/' + rp.path : ''}`;
      } else if (rp.view === 'git') {
        rightFrag = `git/${rs}/${rp.window ?? 0}`;
      }
      hash += `&split=${rightFrag}`;
    } else {
      hash += '&split';
    }
  }

  return hash;
}

/**
 * Push a new route state to browser history.
 * @param {RouteState} state
 */
export function push(state) {
  if (_suppressed) return;
  _current = { ...state };
  const hash = buildHash(state);
  history.pushState(state, '', hash);
}

/**
 * Replace the current route state in browser history.
 * @param {RouteState} state
 */
export function replace(state) {
  if (_suppressed) return;
  _current = { ...state };
  const hash = buildHash(state);
  history.replaceState(state, '', hash);
}

/**
 * Navigate from a URL hash (initial page load).
 * @param {string} hash
 */
export function navigateFromHash(hash) {
  const { state, hasSplit, rightFragment } = parseHash(hash);
  if (hasSplit) {
    state.split = true;
    if (rightFragment) {
      state._rightFragment = rightFragment;
    }
  }
  _current = { ...state };
  replace(state);
}

/**
 * Suppress push/replace during callback execution.
 * @param {function(): void|Promise<void>} fn
 */
export async function suppressDuring(fn) {
  _suppressed = true;
  try {
    await fn();
  } finally {
    _suppressed = false;
  }
}

/**
 * Set the current state directly (e.g., from popstate).
 * @param {RouteState} state
 */
export function setCurrent(state) {
  _current = { ...state };
}

/**
 * Check if push/replace is currently suppressed.
 * @returns {boolean}
 */
export function isSuppressed() {
  return _suppressed;
}
