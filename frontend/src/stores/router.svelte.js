/**
 * Router state store.
 * Wraps the existing hash-based Router with Svelte 5 reactivity.
 * Maintains the same URL schema and history API behavior.
 *
 * @typedef {'sessions'|'windows'|'terminal'|'files'|'git'} ViewType
 * @typedef {object} RouteState
 * @property {ViewType} view
 * @property {string} [session]
 * @property {number} [window]
 * @property {string} [filePath]
 * @property {string|null} [previewFile]
 * @property {object|null} [gitState]
 * @property {boolean} [split]
 * @property {object|null} [rightPanel]
 */

let currentRoute = $state({ view: 'sessions' });
let suppressed = $state(false);

/** @type {Record<string, (state: RouteState) => void|Promise<void>>} */
let handlers = {};

/** Popstate event handler */
function handlePopState(event) {
  const state = event.state;
  if (!state) {
    routerStore.suppressDuring(async () => {
      await dispatch({ view: 'sessions' });
    });
    return;
  }
  routerStore.suppressDuring(async () => {
    await dispatch(state);
  });
}

/** Dispatch to the appropriate handler based on view */
async function dispatch(state) {
  currentRoute = { ...state };
  const handler = handlers[`on${capitalize(state.view)}`] || handlers.onSessions;
  if (handler) await handler(state);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build URL hash from RouteState.
 * @param {RouteState} state
 * @returns {string}
 */
function buildHash(state) {
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

  // Split suffix
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
 * Parse URL hash into RouteState.
 * @param {string} hash
 * @returns {{ state: RouteState, hasSplit: boolean, rightFragment: string|null }}
 */
function parseHash(hash) {
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

export const routerStore = {
  /** Current route state (reactive) */
  get current() { return currentRoute; },
  get view() { return currentRoute.view; },
  get session() { return currentRoute.session; },
  get window() { return currentRoute.window; },
  get split() { return currentRoute.split; },
  get rightPanel() { return currentRoute.rightPanel; },

  /**
   * Initialize the router with view handlers.
   * @param {object} viewHandlers
   */
  init(viewHandlers) {
    handlers = viewHandlers;
    window.addEventListener('popstate', handlePopState);
  },

  /** Clean up event listeners */
  dispose() {
    window.removeEventListener('popstate', handlePopState);
  },

  /**
   * Push a new history entry.
   * @param {RouteState} state
   */
  push(state) {
    if (suppressed) return;
    currentRoute = { ...state };
    const hash = buildHash(state);
    history.pushState(state, '', hash);
  },

  /**
   * Replace the current history entry.
   * @param {RouteState} state
   */
  replace(state) {
    if (suppressed) return;
    currentRoute = { ...state };
    const hash = buildHash(state);
    history.replaceState(state, '', hash);
  },

  /**
   * Navigate from URL hash (initial load).
   * @param {string} hash
   */
  async navigateFromHash(hash) {
    const { state, hasSplit, rightFragment } = parseHash(hash);

    if (hasSplit) {
      state.split = true;
      if (rightFragment) {
        state._rightFragment = rightFragment;
      }
    }

    this.replace(state);
    await dispatch(state);
  },

  /**
   * Suppress push/replace during a callback (e.g. popstate restoration).
   * @param {function(): void|Promise<void>} fn
   */
  async suppressDuring(fn) {
    suppressed = true;
    try {
      await fn();
    } finally {
      suppressed = false;
    }
  },

  /** Expose buildHash for external use */
  buildHash,

  /** Expose parseHash for external use */
  parseHash,
};
