<script>
/**
 * Toolbar.svelte - Svelte 5 port of the Vanilla JS Toolbar class.
 * Modifier-key toolbar component with oneshot/locked modes (Termux style).
 */

// ---------------------------------------------------------------------------
// Button definitions
// ---------------------------------------------------------------------------

const IME_BUTTON_DEFS = [
  { label: '\u3042', type: 'keyboard-mode' },
];

const LEFT_BUTTON_DEFS = [
  { label: 'Esc',  type: 'instant',  key: '\x1b' },
  { label: 'Tab',  type: 'instant',  key: '\t' },
  { label: 'Ctrl', type: 'modifier', modifier: 'ctrl' },
  { label: 'Alt',  type: 'modifier', modifier: 'alt' },
  { label: '/',    type: 'instant',  key: '/',  popup: { label: '|', key: '|' } },
  { label: '-',    type: 'instant',  key: '-',  popup: { label: '_', key: '_' } },
];

const RIGHT_BUTTON_DEFS = [
  { label: '\u2191', type: 'instant', key: '\x1b[A', repeat: true },
  { label: '\u2193', type: 'instant', key: '\x1b[B', repeat: true },
  { label: '\u2190', type: 'instant', key: '\x1b[D', repeat: true },
  { label: '\u2192', type: 'instant', key: '\x1b[C', repeat: true },
  { label: '\u232B', type: 'instant', key: '\x7f',   repeat: true },
  { label: '\u21B5', type: 'instant', key: '\r' },
];

const SHORTCUT_DEFS = [
  { label: '^C', key: '\x03' },
  { label: '^Z', key: '\x1a' },
  { label: '^D', key: '\x04' },
  { label: '^O', key: '\x0f' },
  { label: '^L', key: '\x0c' },
  { label: '^R', key: '\x12' },
  { label: '^A', key: '\x01' },
  { label: '^E', key: '\x05' },
  { label: '^W', key: '\x17' },
  { label: '^U', key: '\x15' },
  { label: '^K', key: '\x0b' },
  { label: '^Y', key: '\x19' },
];

const CLAUDE_ACTIONS = [
  { label: 'y',    keys: ['y', '\r'] },
  { label: 'n',    keys: ['n', '\r'] },
  { label: '\u2191', keys: ['\x1b[A'] },
  { label: '\u23CE', keys: ['\r'] },
  { label: '^C',   keys: ['\x03'] },
  { label: 'Esc',  keys: ['\x1b'] },
];

const SLASH_COMMANDS = ['/compact', '/clear', '/help', '/cost', '/status'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** @type {{ onSendKey: (key: string) => void, onKeyboardMode?: (mode: string) => void, onFetchCommands?: (session: string) => Promise<{commands: Array}> }} */
let {
  onSendKey,
  onKeyboardMode = null,
  onFetchCommands = null,
} = $props();

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

/** @type {'off' | 'oneshot' | 'locked'} */
let ctrlStateVal = $state('off');
/** @type {'off' | 'oneshot' | 'locked'} */
let altStateVal = $state('off');
/** @type {'none' | 'direct' | 'ime'} */
let keyboardModeVal = $state('none');
/** @type {boolean} */
let visibleVal = $state(true);
/** @type {'normal' | 'shortcut' | 'commands' | 'claude'} */
let mode = $state('normal');
/** @type {boolean} */
let isClaudeWindow = $state(false);
/** @type {string|null} */
let currentSession = $state(null);

// Commands mode
/** @type {Array<{label: string, command: string, source: string}>} */
let commandsList = $state([]);
/** @type {'idle' | 'loading' | 'loaded' | 'error' | 'empty-session'} */
let commandsStatus = $state('idle');

/** Cache for commands */
let commandsCache = $state(null);
const COMMANDS_CACHE_TTL = 30000;

// ---------------------------------------------------------------------------
// Keyboard mode derived label
// ---------------------------------------------------------------------------

let keyboardModeLabel = $derived(
  keyboardModeVal === 'direct' ? 'A' : '\u3042'
);
let keyboardModeActive = $derived(
  keyboardModeVal !== 'none'
);

// ---------------------------------------------------------------------------
// Swipe gesture state (not reactive - used in actions only)
// ---------------------------------------------------------------------------

let swipeDetected = false;
let swipeDirection = null;
let cancelRepeatTouch = null;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

let containerEl;
let mainRowEl;
let shortcutRowEl;
let commandsRowEl;
let claudeRowEl;

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

let longPressTimer = null;
const LONG_PRESS_THRESHOLD = 400;
let longPressTriggered = false;

let repeatTimer = null;
let repeatInterval = null;
const REPEAT_INITIAL_DELAY = 400;
const REPEAT_INTERVAL_MS = 80;

function clearRepeat() {
  if (repeatTimer !== null) {
    clearTimeout(repeatTimer);
    repeatTimer = null;
  }
  if (repeatInterval !== null) {
    clearInterval(repeatInterval);
    repeatInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

function handleInstantKey(key) {
  const mods = consumeModifiers();
  let data = key;
  if (mods.alt && key.length === 1) {
    data = '\x1b' + key;
  }
  onSendKey(data);
}

function handleModifierTap(modifier) {
  if (modifier === 'ctrl') {
    ctrlStateVal = ctrlStateVal === 'off' ? 'oneshot' : 'off';
  } else {
    altStateVal = altStateVal === 'off' ? 'oneshot' : 'off';
  }
}

function handleKeyboardModeToggle() {
  switch (keyboardModeVal) {
    case 'none': keyboardModeVal = 'direct'; break;
    case 'direct': keyboardModeVal = 'ime'; break;
    case 'ime': keyboardModeVal = 'none'; break;
    default: keyboardModeVal = 'none'; break;
  }
  if (onKeyboardMode) {
    onKeyboardMode(keyboardModeVal);
  }
}

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

function setMode(newMode) {
  mode = newMode;
  if (newMode === 'commands') {
    loadCommands();
  }
}

function handleSwitchFwd(e) {
  e.preventDefault();
  if (mode === 'normal') setMode('shortcut');
  else if (mode === 'commands' || mode === 'claude') setMode('normal');
}

function handleSwitchBack(e) {
  e.preventDefault();
  if (mode === 'normal') setMode(isClaudeWindow ? 'claude' : 'commands');
  else setMode('normal');
}

// ---------------------------------------------------------------------------
// Commands loading
// ---------------------------------------------------------------------------

function loadCommands() {
  if (!onFetchCommands || !currentSession) {
    commandsStatus = 'empty-session';
    return;
  }

  if (commandsCache &&
      commandsCache.session === currentSession &&
      Date.now() - commandsCache.timestamp < COMMANDS_CACHE_TTL) {
    commandsList = commandsCache.commands;
    commandsStatus = commandsCache.commands.length > 0 ? 'loaded' : 'error';
    return;
  }

  commandsStatus = 'loading';
  onFetchCommands(currentSession)
    .then((result) => {
      const commands = result.commands || [];
      commandsCache = { session: currentSession, commands, timestamp: Date.now() };
      if (mode === 'commands') {
        commandsList = commands;
        commandsStatus = commands.length > 0 ? 'loaded' : 'error';
      }
    })
    .catch(() => {
      if (mode === 'commands') {
        commandsStatus = 'error';
      }
    });
}

// ---------------------------------------------------------------------------
// Svelte actions
// ---------------------------------------------------------------------------

/**
 * Action: basic button handler with touch/click duality.
 * Touchend prevents subsequent click from double-firing.
 */
function buttonHandler(node, handlerFn) {
  let touchHandled = false;
  const onTouchEnd = (e) => {
    touchHandled = true;
    if (swipeDetected) return;
    handlerFn(e);
  };
  const onClick = (e) => {
    if (touchHandled) { touchHandled = false; return; }
    handlerFn(e);
  };
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('click', onClick);
  return {
    update(newHandler) { handlerFn = newHandler; },
    destroy() {
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('click', onClick);
    },
  };
}

/**
 * Action: modifier button (Ctrl/Alt) with long-press lock.
 */
function modifierAction(node, modifier) {
  let touchHandled = false;

  const startPress = () => {
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      if (modifier === 'ctrl') ctrlStateVal = 'locked';
      else altStateVal = 'locked';
    }, LONG_PRESS_THRESHOLD);
  };

  const endPress = (e) => {
    e.preventDefault();
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (swipeDetected) { longPressTriggered = false; return; }
    if (!longPressTriggered) {
      handleModifierTap(modifier);
    }
    longPressTriggered = false;
  };

  const onTouchStart = (e) => { e.preventDefault(); touchHandled = true; startPress(); };
  const onTouchEnd = (e) => { endPress(e); };
  const onTouchCancel = () => {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressTriggered = false;
  };
  const onMouseDown = (e) => {
    if (touchHandled) { touchHandled = false; return; }
    e.preventDefault(); startPress();
  };
  const onMouseUp = (e) => { if (touchHandled) return; endPress(e); };
  const onMouseLeave = () => {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  };

  node.addEventListener('touchstart', onTouchStart, { passive: false });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('touchcancel', onTouchCancel);
  node.addEventListener('mousedown', onMouseDown);
  node.addEventListener('mouseup', onMouseUp);
  node.addEventListener('mouseleave', onMouseLeave);

  return {
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('mouseup', onMouseUp);
      node.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}

/**
 * Action: repeatable button (arrows, backspace).
 */
function repeatAction(node, key) {
  let touchHandled = false;
  let initialFireTimer = null;
  let hasFired = false;

  const fireAndScheduleRepeat = () => {
    hasFired = true;
    handleInstantKey(key);
    repeatTimer = setTimeout(() => {
      repeatInterval = setInterval(() => {
        handleInstantKey(key);
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_INITIAL_DELAY);
  };

  const startRepeatTouch = () => {
    clearRepeat();
    hasFired = false;
    node.classList.add('toolbar-btn--pressed');
    initialFireTimer = setTimeout(() => {
      initialFireTimer = null;
      fireAndScheduleRepeat();
    }, 50);
  };

  const startRepeatMouse = () => {
    clearRepeat();
    hasFired = false;
    node.classList.add('toolbar-btn--pressed');
    fireAndScheduleRepeat();
  };

  const stopRepeat = (wasSwiping = false) => {
    if (initialFireTimer !== null) {
      clearTimeout(initialFireTimer);
      initialFireTimer = null;
      if (!wasSwiping && !hasFired) {
        handleInstantKey(key);
      }
    }
    clearRepeat();
    node.classList.remove('toolbar-btn--pressed');
    hasFired = false;
  };

  const onTouchStart = (e) => {
    e.preventDefault();
    touchHandled = true;
    startRepeatTouch();
    cancelRepeatTouch = () => stopRepeat(true);
  };
  const onTouchEnd = (e) => {
    e.preventDefault();
    cancelRepeatTouch = null;
    stopRepeat(swipeDetected);
  };
  const onTouchCancel = () => {
    cancelRepeatTouch = null;
    stopRepeat(true);
  };
  const onMouseDown = (e) => {
    if (touchHandled) { touchHandled = false; return; }
    e.preventDefault(); startRepeatMouse();
  };
  const onMouseUp = () => { if (touchHandled) return; stopRepeat(false); };
  const onMouseLeave = () => { if (touchHandled) return; stopRepeat(false); };

  node.addEventListener('touchstart', onTouchStart, { passive: false });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('touchcancel', onTouchCancel);
  node.addEventListener('mousedown', onMouseDown);
  node.addEventListener('mouseup', onMouseUp);
  node.addEventListener('mouseleave', onMouseLeave);

  return {
    destroy() {
      stopRepeat(true);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('mouseup', onMouseUp);
      node.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}

/**
 * Action: popup button (/ and -).
 */
function popupAction(node, params) {
  let { key, popup } = params;
  let touchHandled = false;
  let popupVisible = false;

  // Create popup element
  const popupEl = document.createElement('span');
  popupEl.className = 'toolbar-btn-popup';
  popupEl.textContent = popup.label;
  node.appendChild(popupEl);

  const onTouchStart = (e) => {
    e.preventDefault();
    touchHandled = true;
    popupVisible = false;
  };
  const onTouchMove = (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const btnRect = node.getBoundingClientRect();
    if (touch.clientY < btnRect.top) {
      if (!popupVisible) {
        popupEl.classList.add('toolbar-btn-popup--visible');
        popupVisible = true;
      }
    } else {
      if (popupVisible) {
        popupEl.classList.remove('toolbar-btn-popup--visible');
        popupVisible = false;
      }
    }
  };
  const onTouchEnd = (e) => {
    e.preventDefault();
    if (swipeDetected) {
      popupEl.classList.remove('toolbar-btn-popup--visible');
      popupVisible = false;
      return;
    }
    if (popupVisible) {
      popupEl.classList.remove('toolbar-btn-popup--visible');
      popupVisible = false;
      handleInstantKey(popup.key);
    } else {
      handleInstantKey(key);
    }
  };
  const onTouchCancel = () => {
    popupEl.classList.remove('toolbar-btn-popup--visible');
    popupVisible = false;
  };
  const onClick = (e) => {
    if (touchHandled) { touchHandled = false; return; }
    e.preventDefault();
    handleInstantKey(key);
  };

  node.addEventListener('touchstart', onTouchStart, { passive: false });
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('touchcancel', onTouchCancel);
  node.addEventListener('click', onClick);

  return {
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
      node.removeEventListener('click', onClick);
      if (popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    },
  };
}

/**
 * Action: tap-only button (distinguishes tap from swipe for scrollable rows).
 */
function tapAction(node, handlerFn) {
  const TAP_THRESHOLD = 8;
  let startX = 0;
  let startY = 0;
  let touchHandled = false;

  const onTouchStart = (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    touchHandled = false;
  };
  const onTouchEnd = (e) => {
    const dx = Math.abs(e.changedTouches[0].clientX - startX);
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    touchHandled = true;
    if (dx > TAP_THRESHOLD || dy > TAP_THRESHOLD) return;
    handlerFn(e);
  };
  const onClick = (e) => {
    if (touchHandled) { touchHandled = false; return; }
    handlerFn(e);
  };

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('click', onClick);

  return {
    update(newHandler) { handlerFn = newHandler; },
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('click', onClick);
    },
  };
}

/**
 * Action: swipe gesture on the toolbar container.
 */
function swipeGesture(node) {
  let startX = 0;
  let startY = 0;
  let isHorizontal = null;

  const SWIPE_THRESHOLD = 50;
  const DIRECTION_RATIO = 1.5;
  const SOFT_LIMIT = 40;
  const MAX_DRAG = 80;

  const getActiveRow = () => {
    if (mode === 'normal') return mainRowEl;
    if (mode === 'shortcut') return shortcutRowEl;
    if (mode === 'claude') return claudeRowEl;
    return commandsRowEl;
  };

  const canSwipeLeft = () => mode === 'normal' || mode === 'commands' || mode === 'claude';
  const canSwipeRight = () => mode === 'normal' || mode === 'shortcut';

  const applyDrag = (el, dx) => {
    if (!el) return;
    let limited = dx;
    if (dx < 0 && !canSwipeLeft()) limited = 0;
    if (dx > 0 && !canSwipeRight()) limited = 0;
    if (Math.abs(limited) > SOFT_LIMIT) {
      const excess = Math.abs(limited) - SOFT_LIMIT;
      limited = Math.sign(limited) * (SOFT_LIMIT + excess * 0.3);
    }
    limited = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, limited));
    const opacity = Math.max(0.5, 1 - Math.abs(limited) / (MAX_DRAG * 1.5));
    el.style.transition = 'none';
    el.style.transform = `translateX(${limited}px)`;
    el.style.opacity = String(opacity);
  };

  const snapBack = (el) => {
    if (!el) return;
    el.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease';
    el.style.transform = '';
    el.style.opacity = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  };

  const slideOut = (el, direction, callback) => {
    if (!el) { callback(); return; }
    const toX = direction === 'left' ? -(SOFT_LIMIT * 2) : (SOFT_LIMIT * 2);
    el.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
    el.style.transform = `translateX(${toX}px)`;
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      callback();
    }, 160);
  };

  const slideIn = (el, fromSide) => {
    if (!el) return;
    const fromX = fromSide === 'right' ? 40 : -40;
    el.style.transition = 'none';
    el.style.transform = `translateX(${fromX}px)`;
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.2s ease-out';
    el.style.transform = '';
    el.style.opacity = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
  };

  const onTouchStart = (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swipeDetected = false;
    swipeDirection = null;
    isHorizontal = null;
  };

  const onTouchMove = (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (isHorizontal === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        isHorizontal = Math.abs(dx) >= Math.abs(dy);
        if (isHorizontal && cancelRepeatTouch) {
          cancelRepeatTouch();
          cancelRepeatTouch = null;
        }
      }
      return;
    }
    if (!isHorizontal) return;

    applyDrag(getActiveRow(), dx);

    if (!swipeDetected && Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) >= Math.abs(dy) * DIRECTION_RATIO) {
      swipeDetected = true;
      swipeDirection = dx < 0 ? 'left' : 'right';
      if (cancelRepeatTouch) {
        cancelRepeatTouch();
        cancelRepeatTouch = null;
      }
    }
  };

  const onTouchEnd = () => {
    const activeRow = getActiveRow();

    if (!swipeDetected) {
      snapBack(activeRow);
      swipeDirection = null;
      return;
    }

    const dir = swipeDirection;
    swipeDetected = false;
    swipeDirection = null;

    let targetMode = null;
    if (dir === 'left') {
      if (mode === 'normal') targetMode = 'shortcut';
      else if (mode === 'commands' || mode === 'claude') targetMode = 'normal';
    } else {
      if (mode === 'normal') targetMode = isClaudeWindow ? 'claude' : 'commands';
      else if (mode === 'shortcut') targetMode = 'normal';
    }

    if (!targetMode) {
      snapBack(activeRow);
      return;
    }

    slideOut(activeRow, dir, () => {
      setMode(targetMode);
      // After setMode, tick is needed so Svelte updates the DOM
      // Use requestAnimationFrame to wait for DOM update
      requestAnimationFrame(() => {
        slideIn(getActiveRow(), dir === 'left' ? 'right' : 'left');
      });
    });
  };

  const onTouchCancel = () => {
    snapBack(getActiveRow());
    swipeDetected = false;
    swipeDirection = null;
    isHorizontal = null;
  };

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: true });
  node.addEventListener('touchend', onTouchEnd, { passive: true });
  node.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return {
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    },
  };
}

// ---------------------------------------------------------------------------
// Exported methods
// ---------------------------------------------------------------------------

export function consumeModifiers() {
  const mods = {
    ctrl: ctrlStateVal !== 'off',
    alt: altStateVal !== 'off',
  };
  if (ctrlStateVal === 'oneshot') ctrlStateVal = 'off';
  if (altStateVal === 'oneshot') altStateVal = 'off';
  return mods;
}

export function toggleVisibility() {
  visibleVal = !visibleVal;
}

export function setCurrentSession(session) {
  if (currentSession !== session) {
    currentSession = session;
    commandsCache = null;
  }
}

export function setClaudeWindow(isClaude) {
  isClaudeWindow = isClaude;
  if (!isClaude && mode === 'claude') {
    setMode('normal');
  }
}

export function restoreState(state) {
  if (state.keyboardMode && state.keyboardMode !== 'none') {
    keyboardModeVal = state.keyboardMode;
  }
  if (state.ctrlState) {
    ctrlStateVal = state.ctrlState;
  }
  if (state.altState) {
    altStateVal = state.altState;
  }
  if (state.toolbarVisible === false) {
    visibleVal = false;
  }
}

export function hasCtrl() {
  return ctrlStateVal !== 'off';
}

export function hasAlt() {
  return altStateVal !== 'off';
}

export function getVisible() {
  return visibleVal;
}

export function getCtrlState() {
  return ctrlStateVal;
}

export function getAltState() {
  return altStateVal;
}

export function getKeyboardMode() {
  return keyboardModeVal;
}

export function dispose() {
  commandsCache = null;
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (cancelRepeatTouch) {
    cancelRepeatTouch();
    cancelRepeatTouch = null;
  }
  clearRepeat();
}

// ---------------------------------------------------------------------------
// Helper: modifier class for Ctrl/Alt buttons
// ---------------------------------------------------------------------------

function modifierClass(mod) {
  const st = mod === 'ctrl' ? ctrlStateVal : altStateVal;
  if (st === 'oneshot') return 'toolbar-btn toolbar-btn--oneshot';
  if (st === 'locked') return 'toolbar-btn toolbar-btn--locked';
  return 'toolbar-btn';
}
</script>

<div
  class="toolbar"
  class:toolbar--hidden={!visibleVal}
  bind:this={containerEl}
  use:swipeGesture
>
  <!-- Main row (normal mode) -->
  <div
    class="toolbar-row"
    bind:this={mainRowEl}
    style:display={mode === 'normal' ? '' : 'none'}
  >
    <!-- IME group -->
    <div class="toolbar-group toolbar-group--ime">
      {#each IME_BUTTON_DEFS as def}
        <button
          class="toolbar-btn"
          class:toolbar-btn--oneshot={keyboardModeActive}
          data-type={def.type}
          use:buttonHandler={(e) => { e.preventDefault(); handleKeyboardModeToggle(); }}
        >{keyboardModeLabel}</button>
      {/each}
    </div>

    <!-- Left group -->
    <div class="toolbar-group toolbar-group--left">
      {#each LEFT_BUTTON_DEFS as def}
        {#if def.type === 'modifier'}
          <button
            class={modifierClass(def.modifier)}
            data-type={def.type}
            data-modifier={def.modifier}
            use:modifierAction={def.modifier}
          >{def.label}</button>
        {:else if def.popup}
          <button
            class="toolbar-btn"
            data-type={def.type}
            use:popupAction={{ key: def.key, popup: def.popup }}
          >{def.label}</button>
        {:else}
          <button
            class="toolbar-btn"
            data-type={def.type}
            use:buttonHandler={(e) => { e.preventDefault(); handleInstantKey(def.key); }}
          >{def.label}</button>
        {/if}
      {/each}
    </div>

    <!-- Right group -->
    <div class="toolbar-group toolbar-group--right">
      {#each RIGHT_BUTTON_DEFS as def}
        {#if def.repeat}
          <button
            class="toolbar-btn"
            data-type={def.type}
            use:repeatAction={def.key}
          >{def.label}</button>
        {:else}
          <button
            class="toolbar-btn"
            data-type={def.type}
            use:buttonHandler={(e) => { e.preventDefault(); handleInstantKey(def.key); }}
          >{def.label}</button>
        {/if}
      {/each}
    </div>
  </div>

  <!-- Switch forward button (>) -->
  <button
    class="toolbar-switch-btn toolbar-switch-btn--fwd"
    style:display={mode === 'normal' || mode === 'commands' || mode === 'claude' ? '' : 'none'}
    use:buttonHandler={handleSwitchFwd}
  >&gt;</button>

  <!-- Switch back button (<) -->
  <button
    class="toolbar-switch-btn toolbar-switch-btn--back"
    style:display={mode === 'normal' || mode === 'shortcut' ? 'flex' : 'none'}
    use:buttonHandler={handleSwitchBack}
  >&lt;</button>

  <!-- Shortcut row -->
  <div
    class="toolbar-shortcut-row"
    bind:this={shortcutRowEl}
    style:display={mode === 'shortcut' ? 'flex' : 'none'}
  >
    {#each SHORTCUT_DEFS as def}
      <button
        class="toolbar-shortcut-btn"
        use:buttonHandler={(e) => { e.preventDefault(); onSendKey(def.key); }}
      >{def.label}</button>
    {/each}
  </div>

  <!-- Commands row -->
  <div
    class="toolbar-commands-row"
    bind:this={commandsRowEl}
    style:display={mode === 'commands' ? 'flex' : 'none'}
  >
    {#if commandsStatus === 'loading'}
      <span class="toolbar-commands-loading">Loading...</span>
    {:else if commandsStatus === 'empty-session'}
      <span class="toolbar-commands-empty">No session</span>
    {:else if commandsStatus === 'error' || (commandsStatus === 'loaded' && commandsList.length === 0)}
      <span class="toolbar-commands-empty">
        {commandsStatus === 'error' ? 'Error loading commands' : 'No commands found'}
      </span>
    {:else if commandsStatus === 'loaded'}
      {#each commandsList as cmd}
        <button
          class="toolbar-command-btn"
          title={cmd.command.replace('\r', '')}
          use:tapAction={(e) => { e.preventDefault(); onSendKey(cmd.command); }}
        >{cmd.label}</button>
      {/each}
    {/if}
  </div>

  <!-- Claude row -->
  <div
    class="toolbar-claude-row"
    bind:this={claudeRowEl}
    style:display={mode === 'claude' ? 'flex' : 'none'}
  >
    <div class="toolbar-claude-actions">
      {#each CLAUDE_ACTIONS as action}
        <button
          class="toolbar-claude-btn"
          use:buttonHandler={(e) => {
            e.preventDefault();
            for (const k of action.keys) onSendKey(k);
          }}
        >{action.label}</button>
      {/each}
    </div>
    <div class="toolbar-claude-commands">
      {#each SLASH_COMMANDS as cmd}
        <button
          class="toolbar-claude-slash-btn"
          use:tapAction={(e) => { e.preventDefault(); onSendKey(cmd); onSendKey('\r'); }}
        >{cmd}</button>
      {/each}
    </div>
  </div>
</div>
