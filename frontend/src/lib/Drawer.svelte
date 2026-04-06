<script>
/**
 * Drawer.svelte - Svelte 5 port of the Vanilla JS Drawer class (drawer.js).
 *
 * Slide-in panel for project/branch switching:
 * - Project list with collapsible folders (ghq repos)
 * - Branch (worktree) management per project
 * - Session list with activity/alphabetical sort toggle
 * - Notification badges per session
 * - Pin/unpin drawer (localStorage persistence)
 * - Context menu on sessions (delete)
 * - "Open Project" / "Clone repo" / "Custom name" session creation
 * - "Open Branch" / "New branch" worktree creation
 */

// ---------------------------------------------------------------------------
// SVG icon markup constants
// ---------------------------------------------------------------------------

const GIT_BRANCH_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="4" cy="3" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="11" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="5" r="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="4" y1="4.5" x2="4" y2="9.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 6 Q4 5 10 5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';

const TERMINAL_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><polyline points="2,4 6,7 2,10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="7" y1="10" x2="12" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

// ---------------------------------------------------------------------------
// Props (callback functions from the adapter)
// ---------------------------------------------------------------------------

let {
  onSelectSession = null,
  onCreateSession = null,
  onDeleteSession = null,
  onClose = null,
  onPinChange = null,
  claudePath = 'claude',
  // Store-synced props (replaces setCurrent)
  activeSession = null,
  activeWindowIndex = null,
  notifications: notificationsProp = [],
  // API functions injected by adapter
  listSessions: listSessionsFn = null,
  createSession: createSessionFn = null,
  deleteSession: deleteSessionFn = null,
  listGhqRepos: listGhqReposFn = null,
  cloneGhqRepo: cloneGhqRepoFn = null,
  deleteGhqRepo: deleteGhqRepoFn = null,
  listProjectWorktrees: listProjectWorktreesFn = null,
  createProjectWorktree: createProjectWorktreesFn = null,
  deleteProjectWorktree: deleteProjectWorktreesFn = null,
  listProjectBranches: listProjectBranchesFn = null,
  isProjectBranchMerged: isProjectBranchMergedFn = null,
  deleteProjectBranch: deleteProjectBranchFn = null,
} = $props();

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

/** @type {boolean} */
let visible = $state(false);

/** @type {string|null} */
let currentSession = $state(null);

/** @type {number|null} */
let currentWindowIndex = $state(null);

/** @type {Array} */
let sessions = $state([]);

/** @type {Map<string, {sessions: Array, defaultSession: Object|null}>} */
let projects = $state(new Map());

/** @type {Array} */
let otherSessions = $state([]);

/** @type {Set<string>} */
let expandedProjects = $state(new Set());

/** @type {'activity'|'name'} */
let sortOrder = $state(localStorage.getItem('palmux-sort-order') === 'activity' ? 'activity' : 'name');

/** @type {Array<{session: string, window_index: number, type: string}>} */
let notifications = $state([]);

// Props → internal state sync
$effect(() => {
  if (activeSession !== null) {
    const sessionChanged = currentSession !== activeSession;
    currentSession = activeSession;
    currentWindowIndex = activeWindowIndex;
    if (sessionChanged && visible) {
      // セッション切替時にプロジェクト情報をリロード
      const { repo } = parseSessionName(activeSession);
      const fetches = [listSessionsFn(), listGhqReposFn()];
      if (listProjectWorktreesFn && !projectWorktrees.has(repo)) {
        fetches.push(listProjectWorktreesFn(repo).catch(() => null));
      }
      Promise.all(fetches).then(([newSessions, repos, worktrees]) => {
        sessions = newSessions || [];
        if (worktrees && worktrees.length > 0) {
          projectWorktrees = new Map([...projectWorktrees, [repo, worktrees]]);
        }
        groupSessionsByProject(sessions, repos || []);
        expandedProjects = new Set([repo]);
      }).catch(() => {});
    }
  }
});

$effect(() => {
  if (notificationsProp) {
    notifications = notificationsProp;
    updateDrawerBtnBadge();
  }
});

/** @type {boolean} */
let pinned = $state(false);

/** @type {boolean} */
let creating = $state(false);

/** @type {boolean} */
let loading = $state(false);

/** @type {string|null} */
let loadError = $state(null);

/** @type {number} */
let drawerWidth = $state(loadDrawerWidth() || 280);

/** @type {Map<string, Array>} */
let projectWorktrees = $state(new Map());

/** @type {Array} cached repos from last load */
let lastRepos = $state([]);

/** @type {number|null} */
let refreshTimer = $state(null);

/** App version from meta tag */
let appVersion = $state('');
{
  const meta = document.querySelector('meta[name="app-version"]');
  if (meta) appVersion = meta.getAttribute('content') || '';
}

// -- Modal state --
/** @type {{type: string, message: string, path?: string, session?: Object, projectName?: string, branchSession?: Object}|null} */
let modal = $state(null);

/** @type {boolean} */
let modalVisible = $state(false);

/** @type {boolean} */
let modalDeleting = $state(false);

/** @type {string} */
let modalDeleteText = $state('Delete');

// -- Toast state --
/** @type {string|null} */
let toastMessage = $state(null);

/** @type {boolean} */
let toastVisible = $state(false);

let toastTimer = null;

// -- Project picker state --
/** @type {'none'|'project-list'|'clone'|'custom-name'} */
let pickerMode = $state('none');

/** @type {Array} */
let pickerAvailableRepos = $state([]);

/** @type {string} */
let pickerFilter = $state('');

/** @type {string} */
let pickerCloneUrl = $state('');

/** @type {boolean} */
let pickerCloning = $state(false);

/** @type {string} */
let pickerCloneStatus = $state('');

/** @type {string} */
let pickerCustomName = $state('');

/** @type {string} */
let pickerCustomError = $state('');

// -- Branch picker state (per project) --
/** @type {string|null} */
let branchPickerProject = $state(null);

/** @type {'none'|'branch-list'|'create-branch'} */
let branchPickerMode = $state('none');

/** @type {Array} */
let branchPickerBranches = $state([]);

/** @type {Array} */
let branchPickerWorktrees = $state([]);

/** @type {string} */
let branchPickerFilter = $state('');

/** @type {string} */
let branchPickerNewName = $state('');

// -- Long press state --
let longPressTimer = null;
let longPressTriggered = false;
let longPressTarget = null;

// -- Resize handle state --
let resizeStartX = 0;
let resizeStartWidth = 0;
let isResizing = $state(false);

// -- Swipe state --
let touchStartX = 0;
let touchStartY = 0;

// -- DOM refs --
let drawerEl;
let filterInputEl;
let branchFilterInputEl;
let customNameInputEl;
let cloneInputEl;
let branchNewNameInputEl;

// ---------------------------------------------------------------------------
// Helper: parse session name into repo + branch
// ---------------------------------------------------------------------------

function parseSessionName(sessionName) {
  const idx = sessionName.indexOf('@');
  if (idx < 0) return { repo: sessionName, branch: '' };
  return { repo: sessionName.substring(0, idx), branch: sessionName.substring(idx + 1) };
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadDrawerWidth() {
  try {
    const saved = localStorage.getItem('palmux-drawer-width');
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= 200 && w <= 600) return w;
    }
    return null;
  } catch { return null; }
}

function saveDrawerWidth() {
  try { localStorage.setItem('palmux-drawer-width', String(drawerWidth)); }
  catch { /* ignore */ }
}

function savePinState() {
  try { localStorage.setItem('palmux-drawer-pinned', pinned ? '1' : '0'); }
  catch { /* ignore */ }
}

function checkSavedPinState() {
  try {
    const saved = localStorage.getItem('palmux-drawer-pinned');
    // If user explicitly unpinned, respect that
    if (saved === '0') return false;
    // If user explicitly pinned, or no preference yet (default pinned on desktop)
    return window.innerWidth > 600;
  }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

function hasSessionNotification(sessionName) {
  return notifications.some(n => n.session === sessionName);
}

// ---------------------------------------------------------------------------
// Default branch name from worktree cache
// ---------------------------------------------------------------------------

function getDefaultBranchName(projectName) {
  const wts = projectWorktrees.get(projectName);
  if (!wts) return '';
  const defaultWt = wts.find(w => w.is_default);
  return defaultWt ? defaultWt.branch : '';
}

// ---------------------------------------------------------------------------
// Grouping sessions by project
// ---------------------------------------------------------------------------

function groupSessionsByProject(sessionList, repos) {
  lastRepos = repos;
  const repoNames = new Set(repos.map(r => r.name));
  const newProjects = new Map();
  const newOther = [];

  for (const session of sessionList) {
    const { repo, branch } = parseSessionName(session.name);
    if (repoNames.has(repo)) {
      if (!newProjects.has(repo)) {
        newProjects.set(repo, { sessions: [], defaultSession: null });
      }
      const project = newProjects.get(repo);
      const defaultBranchName = !branch ? getDefaultBranchName(repo) : '';
      project.sessions.push({ ...session, branch: branch || defaultBranchName || repo, isDefault: !branch });
      if (!branch) {
        project.defaultSession = session;
      }
    } else {
      newOther.push(session);
    }
  }

  projects = newProjects;
  otherSessions = newOther;
}

// ---------------------------------------------------------------------------
// Sorted projects
// ---------------------------------------------------------------------------

let sortedProjects = $derived.by(() => {
  const entries = [...projects.entries()];
  if (sortOrder === 'name') {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => {
      const aMax = Math.max(...a[1].sessions.map(s => new Date(s.activity)));
      const bMax = Math.max(...b[1].sessions.map(s => new Date(s.activity)));
      return bMax - aMax;
    });
  }
  return entries;
});

// ---------------------------------------------------------------------------
// Filtered picker items
// ---------------------------------------------------------------------------

let filteredRepos = $derived.by(() => {
  if (!pickerFilter) return pickerAvailableRepos;
  const f = pickerFilter.toLowerCase();
  return pickerAvailableRepos.filter(r =>
    r.name.toLowerCase().includes(f) || r.path.toLowerCase().includes(f)
  );
});

let filteredBranches = $derived.by(() => {
  if (!branchPickerFilter) return branchPickerBranches;
  const f = branchPickerFilter.toLowerCase();
  return branchPickerBranches.filter(b => b.name.toLowerCase().includes(f));
});

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

function startRefreshPolling() {
  stopRefreshPolling();
  refreshTimer = window.setInterval(async () => {
    if (!visible || !listSessionsFn || !listGhqReposFn) return;
    try {
      const fetches = [listSessionsFn(), listGhqReposFn()];
      const expandedProject = [...expandedProjects][0] || null;
      if (expandedProject && listProjectWorktreesFn) {
        fetches.push(listProjectWorktreesFn(expandedProject).catch(() => null));
      }
      const [newSessions, repos, worktrees] = await Promise.all(fetches);
      if (expandedProject && worktrees && worktrees.length > 0) {
        projectWorktrees = new Map([...projectWorktrees, [expandedProject, worktrees]]);
      }
      const oldNames = new Set(sessions.map(s => s.name));
      const newNames = new Set((newSessions || []).map(s => s.name));
      if (oldNames.size !== newNames.size || [...oldNames].some(n => !newNames.has(n))) {
        sessions = newSessions || [];
        groupSessionsByProject(sessions, repos || []);
      }
    } catch { /* ignore */ }
  }, 5000);
}

function stopRefreshPolling() {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------

function showToast(message) {
  toastMessage = message;
  toastVisible = false;
  if (toastTimer) clearTimeout(toastTimer);
  requestAnimationFrame(() => { toastVisible = true; });
  toastTimer = setTimeout(() => {
    toastVisible = false;
    setTimeout(() => { toastMessage = null; }, 300);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

async function doOpen() {
  visible = true;
  if (currentSession) {
    const { repo } = parseSessionName(currentSession);
    expandedProjects = new Set([repo]);
  } else {
    expandedProjects = new Set();
  }

  loading = true;
  loadError = null;

  try {
    if (!listSessionsFn || !listGhqReposFn) {
      throw new Error('API functions not provided');
    }
    const fetches = [listSessionsFn(), listGhqReposFn()];
    const expandedProject = [...expandedProjects][0] || null;
    if (expandedProject && listProjectWorktreesFn && !projectWorktrees.has(expandedProject)) {
      fetches.push(listProjectWorktreesFn(expandedProject).catch(() => null));
    }
    const [newSessions, repos, worktrees] = await Promise.all(fetches);
    sessions = newSessions || [];
    if (expandedProject && worktrees && worktrees.length > 0) {
      projectWorktrees = new Map([...projectWorktrees, [expandedProject, worktrees]]);
    }
    groupSessionsByProject(sessions, repos || []);
    loading = false;
    startRefreshPolling();
  } catch (err) {
    console.error('Failed to load drawer data:', err);
    loading = false;
    loadError = 'Failed to load sessions';
  }
}

function doClose() {
  if (pinned) return;
  visible = false;
  stopRefreshPolling();
  pickerMode = 'none';
  branchPickerMode = 'none';
  branchPickerProject = null;
  if (onClose) onClose();
}

// ---------------------------------------------------------------------------
// Pin / Unpin
// ---------------------------------------------------------------------------

function setDrawerWidthCSS(width) {
  drawerWidth = width;
  document.documentElement.style.setProperty('--drawer-pinned-width', width + 'px');
}

async function doPin() {
  pinned = true;
  setDrawerWidthCSS(drawerWidth);
  document.body.classList.add('drawer-pinned');
  const drawerBtn = document.getElementById('drawer-btn');
  if (drawerBtn) drawerBtn.classList.add('hidden');
  if (!visible) await doOpen();
  savePinState();
}

function doUnpin() {
  pinned = false;
  document.body.classList.remove('drawer-pinned');
  document.documentElement.style.removeProperty('--drawer-pinned-width');
  const drawerBtn = document.getElementById('drawer-btn');
  if (drawerBtn) drawerBtn.classList.remove('hidden');
  doClose();
  savePinState();
}

function doTogglePin() {
  if (pinned) doUnpin();
  else doPin();
}

// Resize handler for auto-unpin on small screens
function handleWindowResize() {
  if (pinned && window.innerWidth <= 600) {
    doUnpin();
  }
}

// ---------------------------------------------------------------------------
// Resize handle (dragging to resize pinned drawer width)
// ---------------------------------------------------------------------------

function onResizeHandlePointerDown(e) {
  if (!pinned) return;
  e.preventDefault();
  isResizing = true;
  resizeStartX = e.clientX;
  resizeStartWidth = drawerEl ? drawerEl.offsetWidth : drawerWidth;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';
  document.addEventListener('pointermove', onResizeMove);
  document.addEventListener('pointerup', onResizeEnd);
  document.addEventListener('pointercancel', onResizeEnd);
}

function onResizeMove(e) {
  const newWidth = resizeStartWidth + (e.clientX - resizeStartX);
  const clamped = Math.max(200, Math.min(600, newWidth));
  setDrawerWidthCSS(clamped);
}

function onResizeEnd() {
  isResizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.body.style.webkitUserSelect = '';
  document.removeEventListener('pointermove', onResizeMove);
  document.removeEventListener('pointerup', onResizeEnd);
  document.removeEventListener('pointercancel', onResizeEnd);
  saveDrawerWidth();
}

// ---------------------------------------------------------------------------
// Swipe to close
// ---------------------------------------------------------------------------

function onTouchStart(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function onTouchEnd(e) {
  if (e.changedTouches.length === 0) return;
  const deltaX = e.changedTouches[0].clientX - touchStartX;
  const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY);
  if (deltaX < -80 && deltaY < Math.abs(deltaX)) {
    doClose();
  }
}

// ---------------------------------------------------------------------------
// Long press helpers
// ---------------------------------------------------------------------------

function startLongPress(target, callback) {
  cancelLongPress();
  longPressTriggered = false;
  longPressTarget = target;
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    callback();
  }, 500);
}

function cancelLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function wasLongPress() {
  return longPressTriggered;
}

// ---------------------------------------------------------------------------
// Project header click
// ---------------------------------------------------------------------------

async function handleProjectHeaderClick(projectName, project) {
  if (wasLongPress()) { longPressTriggered = false; return; }

  if (expandedProjects.has(projectName)) {
    expandedProjects = new Set();
    // Reset branch picker if it was for this project
    if (branchPickerProject === projectName) {
      branchPickerMode = 'none';
      branchPickerProject = null;
    }
  } else {
    // Load worktree cache before expanding so branch names are
    // available at first render (avoids flicker from repo→branch name).
    if (!projectWorktrees.has(projectName) && listProjectWorktreesFn) {
      try {
        const wts = await listProjectWorktreesFn(projectName);
        if (wts && wts.length > 0) {
          projectWorktrees = new Map([...projectWorktrees, [projectName, wts]]);
          groupSessionsByProject(sessions, lastRepos || []);
        }
      } catch { /* ignore */ }
    }

    expandedProjects = new Set([projectName]);

    // Auto-connect to default session
    const { repo: currentRepo } = currentSession ? parseSessionName(currentSession) : { repo: '' };
    if (currentRepo !== projectName && project.defaultSession && onSelectSession) {
      onSelectSession(project.defaultSession.name, 0);
      currentSession = project.defaultSession.name;
      currentWindowIndex = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Branch click
// ---------------------------------------------------------------------------

function handleBranchClick(branchSession) {
  if (wasLongPress()) { longPressTriggered = false; return; }
  if (onSelectSession) onSelectSession(branchSession.name, 0);
  currentSession = branchSession.name;
  currentWindowIndex = 0;
  if (!pinned) doClose();
}

// ---------------------------------------------------------------------------
// Other session click
// ---------------------------------------------------------------------------

function handleOtherSessionClick(session) {
  if (wasLongPress()) { longPressTriggered = false; return; }
  if (onSelectSession) onSelectSession(session.name, 0);
  currentSession = session.name;
  currentWindowIndex = 0;
  if (!pinned) doClose();
}

// ---------------------------------------------------------------------------
// "Other Sessions" toggle
// ---------------------------------------------------------------------------

function toggleOtherSessions() {
  const next = new Set(expandedProjects);
  if (next.has('__other__')) {
    next.delete('__other__');
  } else {
    next.add('__other__');
  }
  expandedProjects = next;
}

// ---------------------------------------------------------------------------
// Delete confirmation modals
// ---------------------------------------------------------------------------

function showDeleteConfirmation(session) {
  modal = { type: 'delete-session', message: `Delete session "${session.name}"?`, session };
  modalDeleting = false;
  modalDeleteText = 'Delete';
  requestAnimationFrame(() => { modalVisible = true; });
}

function showBranchDeleteConfirmation(projectName, branchSession) {
  modal = {
    type: branchSession.isDefault ? 'delete-session' : 'delete-branch',
    message: branchSession.isDefault
      ? `Delete session "${branchSession.name}"?`
      : `Delete branch session "${branchSession.branch}"?`,
    session: branchSession,
    projectName,
    branchSession,
  };
  modalDeleting = false;
  modalDeleteText = 'Delete';
  requestAnimationFrame(() => { modalVisible = true; });
}

function showRepoDeleteConfirmation(repo) {
  modal = { type: 'delete-repo', message: `Delete repository "${repo.name}"?`, path: repo.full_path, repo };
  modalDeleting = false;
  modalDeleteText = 'Delete';
  requestAnimationFrame(() => { modalVisible = true; });
}

function closeModal() {
  modalVisible = false;
  setTimeout(() => { modal = null; }, 200);
}

async function handleModalDelete() {
  if (!modal) return;
  modalDeleting = true;
  modalDeleteText = 'Deleting...';

  // Save references before closeModal() sets modal to null (after 200ms timeout)
  const { type, session: modalSession, repo: modalRepo } = modal;

  try {
    if (type === 'delete-session') {
      if (deleteSessionFn) await deleteSessionFn(modalSession.name);
      closeModal();
      await reloadSessions();
      if (modalSession.name === currentSession) {
        await transitionToRecentSession();
      } else if (onDeleteSession) {
        onDeleteSession();
      }
    } else if (type === 'delete-repo') {
      if (deleteGhqRepoFn) await deleteGhqRepoFn(modalRepo.full_path);
      closeModal();
      // Refresh project picker
      await refreshProjectPicker();
    }
  } catch (err) {
    closeModal();
    showToast(`Failed: ${err.message}`);
  }
}

async function handleBranchRemove() {
  if (!modal || !modal.branchSession) return;
  modalDeleting = true;
  const { projectName, branchSession } = modal;
  try {
    if (deleteProjectWorktreesFn) {
      await deleteProjectWorktreesFn(projectName, branchSession.branch, true);
    }
    closeModal();
    await reloadSessions();
    if (branchSession.name === currentSession) {
      await transitionToRecentSession();
    }
  } catch (err) {
    closeModal();
    showToast(`Failed to remove: ${err.message}`);
  }
}

async function handleBranchDeleteWithCheck() {
  if (!modal || !modal.branchSession) return;
  modalDeleting = true;
  modalDeleteText = 'Checking...';
  const { projectName, branchSession } = modal;
  try {
    let force = false;
    if (isProjectBranchMergedFn) {
      const { merged } = await isProjectBranchMergedFn(projectName, branchSession.branch);
      if (!merged) {
        const confirmed = window.confirm(
          `Branch "${branchSession.branch}" has unmerged commits. Delete anyway?`
        );
        if (!confirmed) {
          modalDeleting = false;
          modalDeleteText = 'Delete';
          return;
        }
        force = true;
      }
    }

    modalDeleteText = 'Deleting...';
    if (deleteProjectWorktreesFn) {
      await deleteProjectWorktreesFn(projectName, branchSession.branch, true);
    }
    if (deleteProjectBranchFn) {
      await deleteProjectBranchFn(projectName, branchSession.branch, force);
    }
    closeModal();
    await reloadSessions();
    if (branchSession.name === currentSession) {
      await transitionToRecentSession();
    }
  } catch (err) {
    closeModal();
    showToast(`Failed to delete branch: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Reload sessions helper
// ---------------------------------------------------------------------------

async function reloadSessions() {
  if (!listSessionsFn || !listGhqReposFn) return;
  const [newSessions, repos] = await Promise.all([listSessionsFn(), listGhqReposFn()]);
  sessions = newSessions || [];
  groupSessionsByProject(sessions, repos || []);
  updateDrawerBtnBadge();
}

async function transitionToRecentSession() {
  if (sessions.length === 0) {
    if (onDeleteSession) onDeleteSession();
    return;
  }
  const sorted = [...sessions].sort((a, b) => new Date(b.activity) - new Date(a.activity));
  const target = sorted[0];
  currentSession = target.name;
  currentWindowIndex = 0;
  if (onSelectSession) onSelectSession(target.name, 0);
}

// ---------------------------------------------------------------------------
// Drawer button badge
// ---------------------------------------------------------------------------

function updateDrawerBtnBadge() {
  const drawerBtn = document.getElementById('drawer-btn');
  if (!drawerBtn) return;
  let hasNotification;
  if (sessions.length > 0) {
    const sessionNames = new Set(sessions.map(s => s.name));
    hasNotification = notifications.some(n => sessionNames.has(n.session));
  } else {
    hasNotification = notifications.length > 0;
  }
  if (hasNotification) {
    drawerBtn.classList.add('drawer-btn--has-notification');
  } else {
    drawerBtn.classList.remove('drawer-btn--has-notification');
  }
}

// ---------------------------------------------------------------------------
// Project picker
// ---------------------------------------------------------------------------

async function openProjectPicker() {
  if (pickerMode !== 'none') return;
  pickerFilter = '';
  pickerMode = 'project-list';

  let repos = [];
  try {
    if (listGhqReposFn) repos = await listGhqReposFn() || [];
  } catch (err) {
    console.error('Failed to load ghq repos:', err);
  }

  const existingNames = new Set(sessions.map(s => s.name));
  pickerAvailableRepos = repos.filter(r => !existingNames.has(r.name));

  if (pickerAvailableRepos.length === 0 && repos.length === 0) {
    pickerMode = 'custom-name';
    pickerCustomName = '';
    pickerCustomError = '';
    return;
  }

  // Focus filter input after rendering
  requestAnimationFrame(() => { if (filterInputEl) filterInputEl.focus(); });
}

function closeProjectPicker() {
  pickerMode = 'none';
  pickerFilter = '';
  pickerCloneUrl = '';
  pickerCloning = false;
  pickerCloneStatus = '';
  pickerCustomName = '';
  pickerCustomError = '';
}

async function refreshProjectPicker() {
  if (pickerMode !== 'project-list') return;
  let repos = [];
  try {
    if (listGhqReposFn) repos = await listGhqReposFn() || [];
  } catch { /* ignore */ }
  const existingNames = new Set(sessions.map(s => s.name));
  pickerAvailableRepos = repos.filter(r => !existingNames.has(r.name));
}

async function handleProjectPickerItemClick(repo) {
  if (creating) return;
  creating = true;
  try {
    if (createSessionFn) await createSessionFn(repo.name);
    creating = false;
    closeProjectPicker();
    await reloadSessions();
    if (onCreateSession) {
      onCreateSession(repo.name);
      if (!pinned) doClose();
    }
  } catch (err) {
    creating = false;
    showToast(`Failed to create session: ${err.message}`);
  }
}

function switchToCloneInput() {
  pickerMode = 'clone';
  pickerCloneUrl = '';
  pickerCloning = false;
  pickerCloneStatus = '';
  requestAnimationFrame(() => { if (cloneInputEl) cloneInputEl.focus(); });
}

async function doClone() {
  const url = pickerCloneUrl.trim();
  if (!url || pickerCloning) return;
  pickerCloning = true;
  pickerCloneStatus = 'Cloning...';
  try {
    if (cloneGhqRepoFn) await cloneGhqRepoFn(url);
    pickerCloneStatus = 'Clone successful!';
    // Refresh and go back to project list
    pickerMode = 'project-list';
    pickerCloning = false;
    pickerCloneStatus = '';
    await refreshProjectPicker();
  } catch (err) {
    pickerCloning = false;
    pickerCloneStatus = '';
    showToast(`Failed to clone: ${err.message}`);
  }
}

function switchToCustomName() {
  pickerMode = 'custom-name';
  pickerCustomName = '';
  pickerCustomError = '';
  requestAnimationFrame(() => { if (customNameInputEl) customNameInputEl.focus(); });
}

async function handleCreateCustomSession() {
  if (creating) return;
  const name = pickerCustomName.trim();
  if (!name) {
    pickerCustomError = 'Session name cannot be empty';
    return;
  }
  if (sessions.some(s => s.name === name)) {
    pickerCustomError = `Session "${name}" already exists`;
    return;
  }
  creating = true;
  pickerCustomError = '';
  try {
    if (createSessionFn) await createSessionFn(name);
    creating = false;
    closeProjectPicker();
    await reloadSessions();
    if (onCreateSession) {
      onCreateSession(name);
      if (!pinned) doClose();
    }
  } catch (err) {
    creating = false;
    pickerCustomError = `Failed to create session: ${err.message}`;
  }
}

function handlePickerFilterKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeProjectPicker();
  }
}

function handleCloneKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); doClone(); }
  else if (e.key === 'Escape') { e.preventDefault(); pickerMode = 'project-list'; }
}

function handleCustomNameKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); handleCreateCustomSession(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeProjectPicker(); }
}

// ---------------------------------------------------------------------------
// Branch picker
// ---------------------------------------------------------------------------

async function openBranchPicker(projectName) {
  branchPickerProject = projectName;
  branchPickerMode = 'branch-list';
  branchPickerFilter = '';
  branchPickerBranches = [];
  branchPickerWorktrees = [];

  try {
    if (!listProjectBranchesFn || !listProjectWorktreesFn) return;
    const [branches, worktrees] = await Promise.all([
      listProjectBranchesFn(projectName),
      listProjectWorktreesFn(projectName),
    ]);

    if (worktrees && worktrees.length > 0) {
      projectWorktrees = new Map([...projectWorktrees, [projectName, worktrees]]);
    }

    const existingBranches = new Set(worktrees.filter(w => w.has_session).map(w => w.branch));
    branchPickerBranches = (branches || []).filter(b => {
      if (existingBranches.has(b.name)) return false;
      if (b.remote) {
        const slashIdx = b.name.indexOf('/');
        if (slashIdx >= 0 && existingBranches.has(b.name.substring(slashIdx + 1))) return false;
      }
      return true;
    });
    branchPickerWorktrees = worktrees || [];

    requestAnimationFrame(() => { if (branchFilterInputEl) branchFilterInputEl.focus(); });
  } catch (err) {
    console.error('Failed to load branches:', err);
    branchPickerMode = 'none';
    branchPickerProject = null;
    showToast(`Failed to load branches: ${err.message}`);
  }
}

function closeBranchPicker() {
  branchPickerMode = 'none';
  branchPickerProject = null;
  branchPickerFilter = '';
  branchPickerNewName = '';
}

function switchToCreateBranch() {
  branchPickerMode = 'create-branch';
  branchPickerNewName = '';
  requestAnimationFrame(() => { if (branchNewNameInputEl) branchNewNameInputEl.focus(); });
}

async function handleBranchPickerItemClick(branch) {
  let branchName = branch.name;
  if (branch.remote) {
    const slashIdx = branchName.indexOf('/');
    if (slashIdx >= 0) branchName = branchName.substring(slashIdx + 1);
  }
  await createWorktreeAndConnect(branchPickerProject, branchName, false);
}

async function handleCreateNewBranch() {
  const name = branchPickerNewName.trim();
  if (!name) return;
  await createWorktreeAndConnect(branchPickerProject, name, true);
}

async function createWorktreeAndConnect(projectName, branch, createBranch) {
  if (creating) return;
  creating = true;
  try {
    if (createProjectWorktreesFn) await createProjectWorktreesFn(projectName, branch, createBranch);
    creating = false;
    closeBranchPicker();
    const sessionName = projectName + '@' + branch;
    await reloadSessions();
    if (onCreateSession) {
      onCreateSession(sessionName);
      if (!pinned) doClose();
    }
  } catch (err) {
    creating = false;
    showToast(`Failed to create branch: ${err.message}`);
  }
}

function handleBranchFilterKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeBranchPicker(); }
}

function handleNewBranchKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); handleCreateNewBranch(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeBranchPicker(); }
}

// Branch delete from picker (context menu on branch item in picker)
async function handleBranchPickerDelete(projectName, branchName) {
  try {
    let force = false;
    if (isProjectBranchMergedFn) {
      const { merged } = await isProjectBranchMergedFn(projectName, branchName);
      if (!merged) {
        const confirmed = window.confirm(
          `Branch "${branchName}" has unmerged commits. Delete anyway?`
        );
        if (!confirmed) return;
        force = true;
      }
    }
    if (deleteProjectBranchFn) {
      await deleteProjectBranchFn(projectName, branchName, force);
    }
    await reloadSessions();
    // Refresh branch picker
    await openBranchPicker(projectName);
  } catch (err) {
    showToast(`Failed to delete branch: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Exported methods (called from adapter)
// ---------------------------------------------------------------------------

/**
 * Open the drawer and set current session/window.
 * @param {string} sessionName
 * @param {number} windowIndex
 */
export function show(sessionName, windowIndex) {
  currentSession = sessionName;
  currentWindowIndex = windowIndex;
  doOpen();
}

/**
 * Hide the drawer.
 */
export function hide() {
  doClose();
}

/**
 * Get whether the drawer is open.
 * @returns {boolean}
 */
export function getIsOpen() {
  return visible;
}

/**
 * Get whether the drawer is pinned.
 * @returns {boolean}
 */
export function getIsPinned() {
  return pinned;
}

/**
 * Set the pinned state (for adapter property access).
 * @param {boolean} value
 */
export function setPinned(value) {
  if (value && !pinned) doPin();
  else if (!value && pinned) doUnpin();
}

/**
 * Toggle pin state.
 */
export function togglePin() {
  doTogglePin();
}

/**
 * Set current session and window, re-render if visible.
 * @param {string} session
 * @param {number} windowIndex
 * @param {{ sessionChanged?: boolean }} [opts]
 */
export function setCurrent(session, windowIndex, opts = {}) {
  const changed = (currentSession !== session || currentWindowIndex !== windowIndex);
  currentSession = session;
  currentWindowIndex = windowIndex;

  if (!changed || !visible) return;

  if (opts.sessionChanged) {
    const { repo } = parseSessionName(session);
    // Reload data and fetch worktrees before expanding to avoid
    // branch name flicker (repo name → actual branch name).
    const fetches = [listSessionsFn(), listGhqReposFn()];
    if (listProjectWorktreesFn && !projectWorktrees.has(repo)) {
      fetches.push(listProjectWorktreesFn(repo).catch(() => null));
    }
    Promise.all(fetches).then(([newSessions, repos, worktrees]) => {
      sessions = newSessions || [];
      if (worktrees && worktrees.length > 0) {
        projectWorktrees = new Map([...projectWorktrees, [repo, worktrees]]);
      }
      groupSessionsByProject(sessions, repos || []);
      expandedProjects = new Set([repo]);
    }).catch(() => {});
  }
}

/**
 * Update notifications.
 * @param {Array<{session: string, window_index: number, type: string}>} notifs
 */
export function setNotifications(notifs) {
  notifications = notifs || [];
  updateDrawerBtnBadge();
}

/**
 * Restore pin state from localStorage.
 */
export async function restorePinState() {
  if (pinned) return;
  if (checkSavedPinState()) {
    await doPin();
  }
}

/**
 * Open the drawer.
 */
export async function open() {
  await doOpen();
}

/**
 * Close the drawer.
 */
export function close() {
  doClose();
}

/**
 * Release resources.
 */
export function dispose() {
  sessions = [];
  projects = new Map();
  otherSessions = [];
  expandedProjects = new Set();
  stopRefreshPolling();
  cancelLongPress();

  if (pinned) {
    pinned = false;
    document.body.classList.remove('drawer-pinned');
    document.documentElement.style.removeProperty('--drawer-pinned-width');
  }

  const drawerBtn = document.getElementById('drawer-btn');
  if (drawerBtn) drawerBtn.classList.remove('hidden');

  // Clean up modals/toasts
  modal = null;
  toastMessage = null;
  visible = false;
}

// ---------------------------------------------------------------------------
// Sorted branch sessions helper
// ---------------------------------------------------------------------------

function getSortedBranchSessions(project) {
  return [...project.sessions].sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.branch.localeCompare(b.branch);
  });
}

// Branch picker default branch name
function getBranchPickerDefaultBranch() {
  const defaultWt = branchPickerWorktrees.find(w => w.is_default);
  return defaultWt ? defaultWt.branch : '';
}

function getBranchPickerWorktreeBranches() {
  return new Set(branchPickerWorktrees.filter(w => !w.is_default).map(w => w.branch));
}
</script>

<svelte:window onresize={handleWindowResize} />

<!-- Overlay -->
{#if visible && !pinned}
  <div
    class="drawer-overlay drawer-overlay--visible"
    onclick={doClose}
    role="presentation"
  ></div>
{/if}

<!-- Drawer panel -->
<div
  bind:this={drawerEl}
  class="drawer"
  class:drawer--open={visible}
  class:drawer--pinned={pinned}
  style={pinned ? `width: ${drawerWidth}px` : ''}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <!-- Header -->
  <div class="drawer-header">
    <span class="drawer-header-title">Projects</span>
    <label class="drawer-sort-toggle" aria-label="Sort order">
      <span
        class="drawer-sort-label"
        class:drawer-sort-label--active={sortOrder === 'activity'}
        data-sort="activity"
      >Recent</span>
      <div class="drawer-sort-switch">
        <input
          type="checkbox"
          class="drawer-sort-checkbox"
          checked={sortOrder === 'name'}
          onchange={() => { sortOrder = sortOrder === 'activity' ? 'name' : 'activity'; localStorage.setItem('palmux-sort-order', sortOrder); }}
        />
        <span class="drawer-sort-slider"></span>
      </div>
      <span
        class="drawer-sort-label"
        class:drawer-sort-label--active={sortOrder === 'name'}
        data-sort="name"
      >A-Z</span>
    </label>

    <!-- Pin button -->
    <button
      class="drawer-pin-btn"
      class:drawer-pin-btn--active={pinned}
      aria-label={pinned ? 'Unpin drawer' : 'Pin drawer'}
      onclick={(e) => { e.stopPropagation(); doTogglePin(); }}
    >
      <svg class="drawer-pin-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" stroke-width="1.4"/>
        <line x1="7" y1="7" x2="7" y2="13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <!-- Content -->
  <div class="drawer-content">
    {#if loading}
      <div class="drawer-loading">Loading...</div>
    {:else if loadError}
      <div class="drawer-error">{loadError}</div>
    {:else}
      <!-- 1. Project list -->
      {#each sortedProjects as [projectName, project]}
        {@const isExpanded = expandedProjects.has(projectName)}
        {@const currentRepo = currentSession ? parseSessionName(currentSession).repo : ''}
        {@const isCurrent = currentRepo === projectName}
        {@const hasNotif = project.sessions.some(s => hasSessionNotification(s.name))}

        <div class="drawer-project">
          <!-- Project header -->
          <div
            class="drawer-session-header"
            class:drawer-session-header--current={isCurrent}
            role="button"
            tabindex="0"
            onclick={() => handleProjectHeaderClick(projectName, project)}
            onpointerdown={(e) => {
              if (e.pointerType === 'touch') {
                const session = project.defaultSession || project.sessions[0];
                startLongPress(e.currentTarget, () => showDeleteConfirmation(session));
              }
            }}
            onpointerup={cancelLongPress}
            onpointercancel={cancelLongPress}
            oncontextmenu={(e) => {
              e.preventDefault();
              const session = project.defaultSession || project.sessions[0];
              showDeleteConfirmation(session);
            }}
          >
            <span class="drawer-session-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
            <span class="drawer-session-name">{projectName}</span>
            <span
              class="drawer-session-badge"
              class:drawer-session-badge--active={hasNotif}
            ></span>
          </div>

          <!-- Expanded: branch list -->
          {#if isExpanded}
            <div class="drawer-windows">
              {#each getSortedBranchSessions(project) as branchSession}
                {@const isBranchCurrent = branchSession.name === currentSession}
                <div
                  class="drawer-branch-item"
                  class:drawer-branch-item--current={isBranchCurrent}
                  role="button"
                  tabindex="0"
                  onclick={() => handleBranchClick(branchSession)}
                  onpointerdown={(e) => {
                    if (e.pointerType === 'touch') {
                      startLongPress(e.currentTarget, () => showBranchDeleteConfirmation(projectName, branchSession));
                    }
                  }}
                  onpointerup={cancelLongPress}
                  onpointercancel={cancelLongPress}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    showBranchDeleteConfirmation(projectName, branchSession);
                  }}
                >
                  <span class="drawer-window-icon">{@html GIT_BRANCH_ICON}</span>
                  <span class="drawer-window-name">{branchSession.branch}</span>
                  <span
                    class="drawer-window-badge"
                    class:drawer-window-badge--active={hasSessionNotification(branchSession.name)}
                  ></span>
                  <span class="drawer-window-active">{isBranchCurrent ? '\u25CF' : ''}</span>
                </div>
              {/each}

              <!-- Open Branch button or Branch picker -->
              {#if branchPickerProject === projectName && branchPickerMode !== 'none'}
                <!-- Branch picker inline -->
                <div class="drawer-branch-picker">
                  {#if branchPickerMode === 'branch-list'}
                    <input
                      type="text"
                      class="drawer-project-picker-filter"
                      placeholder="Filter branches..."
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck="false"
                      bind:this={branchFilterInputEl}
                      bind:value={branchPickerFilter}
                      onkeydown={handleBranchFilterKeydown}
                    />
                    <div class="drawer-project-picker-list">
                      {#if filteredBranches.length === 0}
                        <div class="drawer-project-picker-empty">
                          {branchPickerFilter ? 'No matching branches' : 'No available branches'}
                        </div>
                      {:else}
                        {#each filteredBranches as branch}
                          {@const defaultBranch = getBranchPickerDefaultBranch()}
                          {@const canDelete = !branch.remote && branch.name !== defaultBranch}
                          <div
                            class="drawer-project-picker-item"
                            role="button"
                            tabindex="0"
                            onclick={() => handleBranchPickerItemClick(branch)}
                            oncontextmenu={(e) => {
                              if (canDelete) {
                                e.preventDefault();
                                handleBranchPickerDelete(branchPickerProject, branch.name);
                              }
                            }}
                            onpointerdown={(e) => {
                              if (e.pointerType === 'touch' && canDelete) {
                                startLongPress(e.currentTarget, () => handleBranchPickerDelete(branchPickerProject, branch.name));
                              }
                            }}
                            onpointerup={cancelLongPress}
                            onpointercancel={cancelLongPress}
                          >
                            <span class="drawer-window-icon">{@html GIT_BRANCH_ICON}</span>
                            <div class="drawer-project-picker-item-name">
                              {branch.name}
                              {#if branch.remote}
                                <span class="drawer-branch-remote-tag">remote</span>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      {/if}
                    </div>
                    <div class="drawer-picker-actions">
                      <div
                        class="drawer-project-picker-custom"
                        role="button"
                        tabindex="0"
                        onclick={switchToCreateBranch}
                      >+ New branch...</div>
                      <button
                        class="drawer-new-session-cancel drawer-project-picker-cancel"
                        onclick={closeBranchPicker}
                      >Cancel</button>
                    </div>
                  {:else if branchPickerMode === 'create-branch'}
                    <div class="drawer-project-picker-clone-title">Create New Branch</div>
                    <input
                      type="text"
                      class="drawer-project-picker-filter"
                      placeholder="Branch name (e.g. feature/login)"
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck="false"
                      bind:this={branchNewNameInputEl}
                      bind:value={branchPickerNewName}
                      onkeydown={handleNewBranchKeydown}
                    />
                    <div class="drawer-project-picker-clone-actions">
                      <button class="drawer-new-session-cancel" onclick={closeBranchPicker}>Cancel</button>
                      <button class="drawer-new-session-create" onclick={handleCreateNewBranch}>Create</button>
                    </div>
                  {/if}
                </div>
              {:else}
                <div
                  class="drawer-open-branch-btn"
                  role="button"
                  tabindex="0"
                  onclick={() => openBranchPicker(projectName)}
                >Open Branch...</div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      <!-- 2. Other Sessions -->
      {#if otherSessions.length > 0}
        {@const isOtherExpanded = expandedProjects.has('__other__')}
        <div class="drawer-other-sessions">
          <div
            class="drawer-session-header drawer-other-sessions-header"
            role="button"
            tabindex="0"
            onclick={toggleOtherSessions}
          >
            <span class="drawer-session-arrow">{isOtherExpanded ? '\u25BC' : '\u25B6'}</span>
            <span class="drawer-session-name">Other Sessions</span>
          </div>

          {#if isOtherExpanded}
            <div class="drawer-windows">
              {#each otherSessions as session}
                {@const isSessionCurrent = session.name === currentSession}
                <div
                  class="drawer-branch-item"
                  class:drawer-branch-item--current={isSessionCurrent}
                  role="button"
                  tabindex="0"
                  onclick={() => handleOtherSessionClick(session)}
                  onpointerdown={(e) => {
                    if (e.pointerType === 'touch') {
                      startLongPress(e.currentTarget, () => showDeleteConfirmation(session));
                    }
                  }}
                  onpointerup={cancelLongPress}
                  onpointercancel={cancelLongPress}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    showDeleteConfirmation(session);
                  }}
                >
                  <span class="drawer-window-icon">{@html TERMINAL_ICON}</span>
                  <span class="drawer-window-name">{session.name}</span>
                  <span class="drawer-window-active">{isSessionCurrent ? '\u25CF' : ''}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- 3. New Session / Project Picker -->
      <div class="drawer-new-session">
        {#if pickerMode === 'none'}
          <button class="drawer-new-session-btn" onclick={openProjectPicker}>
            + Open Project
          </button>
        {:else if pickerMode === 'project-list'}
          <div class="drawer-project-picker">
            <input
              type="text"
              class="drawer-project-picker-filter"
              placeholder="Filter projects..."
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              bind:this={filterInputEl}
              bind:value={pickerFilter}
              onkeydown={handlePickerFilterKeydown}
            />
            <div class="drawer-project-picker-list">
              {#if filteredRepos.length === 0}
                <div class="drawer-project-picker-empty">
                  {pickerFilter
                    ? 'No matching projects'
                    : pickerAvailableRepos.length > 0
                      ? 'No matching projects'
                      : 'All projects already have sessions'}
                </div>
              {:else}
                {#each filteredRepos as repo}
                  <div
                    class="drawer-project-picker-item"
                    role="button"
                    tabindex="0"
                    onclick={() => handleProjectPickerItemClick(repo)}
                    onpointerdown={(e) => {
                      if (e.pointerType === 'touch') {
                        startLongPress(e.currentTarget, () => showRepoDeleteConfirmation(repo));
                      }
                    }}
                    onpointerup={cancelLongPress}
                    onpointercancel={cancelLongPress}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      showRepoDeleteConfirmation(repo);
                    }}
                  >
                    <div class="drawer-project-picker-item-name">{repo.name}</div>
                    <div class="drawer-project-picker-item-path">{repo.path}</div>
                  </div>
                {/each}
              {/if}
            </div>
            <div class="drawer-picker-actions">
              <div
                class="drawer-project-picker-clone"
                role="button"
                tabindex="0"
                onclick={switchToCloneInput}
              >+ Clone repo...</div>
              <div
                class="drawer-project-picker-custom"
                role="button"
                tabindex="0"
                onclick={switchToCustomName}
              >+ Custom name...</div>
              <button
                class="drawer-new-session-cancel drawer-project-picker-cancel"
                onclick={closeProjectPicker}
              >Cancel</button>
            </div>
          </div>
        {:else if pickerMode === 'clone'}
          <div class="drawer-project-picker">
            <div class="drawer-project-picker-clone-title">Clone Repository</div>
            <input
              type="text"
              class="drawer-project-picker-filter"
              placeholder="https://github.com/owner/repo"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              bind:this={cloneInputEl}
              bind:value={pickerCloneUrl}
              onkeydown={handleCloneKeydown}
              disabled={pickerCloning}
            />
            <div class="drawer-project-picker-clone-actions">
              <button
                class="drawer-new-session-cancel"
                onclick={() => { pickerMode = 'project-list'; }}
                disabled={pickerCloning}
              >Cancel</button>
              <button
                class="drawer-new-session-create"
                onclick={doClone}
                disabled={pickerCloning}
              >Clone</button>
            </div>
            {#if pickerCloneStatus}
              <div class="drawer-project-picker-clone-status">{pickerCloneStatus}</div>
            {/if}
          </div>
        {:else if pickerMode === 'custom-name'}
          <div class="drawer-new-session-form">
            <input
              type="text"
              class="drawer-new-session-input"
              placeholder="Session name"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              bind:this={customNameInputEl}
              bind:value={pickerCustomName}
              onkeydown={handleCustomNameKeydown}
              disabled={creating}
            />
            <div class="drawer-new-session-actions">
              <button class="drawer-new-session-cancel" onclick={closeProjectPicker}>Cancel</button>
              <button class="drawer-new-session-create" onclick={handleCreateCustomSession}>Create</button>
            </div>
            {#if pickerCustomError}
              <div class="drawer-inline-error">{pickerCustomError}</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="drawer-footer">
    <span class="drawer-footer-name">palmux</span>
    <span class="drawer-footer-version">{appVersion}</span>
  </div>

  <!-- Resize handle (visible when pinned) -->
  {#if pinned}
    <div
      class="drawer-resize-handle"
      class:drawer-resize-handle--active={isResizing}
      onpointerdown={onResizeHandlePointerDown}
    ></div>
  {/if}
</div>

<!-- Delete confirmation modal -->
{#if modal}
  <div
    class="drawer-delete-modal-overlay"
    class:drawer-delete-modal-overlay--visible={modalVisible}
    onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
    role="presentation"
  >
    <div class="drawer-delete-modal">
      <div class="drawer-delete-modal-message">{modal.message}</div>
      {#if modal.path}
        <div class="drawer-delete-modal-path">{modal.path}</div>
      {/if}
      <div class="drawer-delete-modal-actions">
        <button class="drawer-delete-modal-cancel" onclick={closeModal}>Cancel</button>
        {#if modal.type === 'delete-branch'}
          <button
            class="drawer-delete-modal-delete"
            style="background: #666"
            disabled={modalDeleting}
            onclick={handleBranchRemove}
          >Remove</button>
          <button
            class="drawer-delete-modal-delete"
            disabled={modalDeleting}
            onclick={handleBranchDeleteWithCheck}
          >{modalDeleteText === 'Delete' ? 'Delete Branch' : modalDeleteText}</button>
        {:else}
          <button
            class="drawer-delete-modal-delete"
            disabled={modalDeleting}
            onclick={handleModalDelete}
          >{modalDeleteText}</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Toast notification -->
{#if toastMessage}
  <div
    class="drawer-toast drawer-toast--error"
    class:drawer-toast--visible={toastVisible}
  >{toastMessage}</div>
{/if}

<style>
  /* Drawer Overlay */
  .drawer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  .drawer-overlay--visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* Drawer Panel */
  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    width: 280px;
    max-width: 80vw;
    height: 100%;
    background: var(--bg-header);
    z-index: 101;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .drawer--open {
    transform: translateX(0);
  }

  .drawer-header {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .drawer-header-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Drawer Sort Toggle */
  .drawer-sort-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }

  .drawer-sort-label {
    font-size: 11px;
    color: #666;
    transition: color 0.2s;
  }

  .drawer-sort-label--active {
    color: var(--accent-primary);
  }

  .drawer-sort-switch {
    position: relative;
    width: 32px;
    height: 18px;
  }

  .drawer-sort-switch input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .drawer-sort-slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--border-subtle);
    border-radius: 9px;
    transition: background 0.2s;
  }

  .drawer-sort-slider::before {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    left: 2px;
    bottom: 2px;
    background: var(--accent-primary);
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .drawer-sort-switch input:checked + .drawer-sort-slider::before {
    transform: translateX(14px);
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* Drawer Session Header */
  .drawer-session-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    min-height: 44px;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid rgba(42, 42, 74, 0.5);
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-session-header:hover {
    background: rgba(126, 200, 227, 0.08);
  }

  .drawer-session-header:active {
    background: var(--bg-hover);
  }

  .drawer-session-header--current {
    background: rgba(126, 200, 227, 0.05);
  }

  .drawer-session-arrow {
    width: 20px;
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .drawer-session-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Drawer Window Items */
  .drawer-windows {
    background: rgba(0, 0, 0, 0.15);
  }

  .drawer-window-item {
    display: flex;
    align-items: center;
    padding: 10px 16px 10px 36px;
    min-height: 44px;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-window-item:hover {
    background: rgba(126, 200, 227, 0.08);
  }

  .drawer-window-item:active {
    background: var(--bg-hover);
  }

  .drawer-window-item--current {
    background: rgba(126, 200, 227, 0.1);
  }

  .drawer-window-name {
    flex: 1;
    font-size: 14px;
    color: var(--text-primary);
    font-family: "Cascadia Code", "Fira Code", "Source Code Pro", monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer-window-index {
    font-size: 14px;
    color: var(--text-primary);
    font-family: "Cascadia Code", "Fira Code", "Source Code Pro", monospace;
    flex-shrink: 0;
  }

  .drawer-window-rename-input {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-family: "Cascadia Code", "Fira Code", "Source Code Pro", monospace;
    color: var(--text-primary);
    background: rgba(126, 200, 227, 0.15);
    border: 1px solid var(--accent-primary);
    border-radius: 4px;
    padding: 2px 6px;
    outline: none;
  }

  .drawer-window-rename-input:focus {
    border-color: var(--color-success);
    box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
  }

  .drawer-window-active {
    color: var(--color-success);
    font-size: 10px;
    flex-shrink: 0;
    width: 18px;
    text-align: center;
  }

  /* Notification Badge (window level) */
  .drawer-window-badge {
    display: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ffb300;
    flex-shrink: 0;
    margin-right: 4px;
  }

  .drawer-window-badge--active {
    display: inline-block;
    animation: notification-pulse 2s infinite;
  }

  /* Notification Badge (session level) */
  .drawer-session-badge {
    display: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ffb300;
    flex-shrink: 0;
    margin-left: auto;
    margin-right: 4px;
  }

  .drawer-session-badge--active {
    display: inline-block;
  }

  @keyframes notification-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Drawer Virtual Items (Files / Git) */
  .drawer-virtual-item {
    display: flex;
    align-items: center;
    padding: 10px 16px 10px 36px;
    min-height: 44px;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-virtual-item:hover {
    background: rgba(126, 200, 227, 0.08);
  }

  .drawer-virtual-item:active {
    background: var(--bg-hover);
  }

  .drawer-virtual-item--current {
    background: rgba(126, 200, 227, 0.1);
  }

  .drawer-virtual-item-icon {
    width: 14px;
    height: 14px;
    margin-right: 8px;
    color: var(--accent-primary);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .drawer-virtual-item-icon :global(svg) {
    display: block;
  }

  .drawer-virtual-item-name {
    font-size: 14px;
    color: var(--text-primary);
    font-family: "Cascadia Code", "Fira Code", "Source Code Pro", monospace;
  }

  /* Drawer Window Terminal Icon */
  .drawer-window-icon {
    width: 14px;
    height: 14px;
    margin-right: 6px;
    color: var(--accent-primary);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .drawer-window-icon :global(svg) {
    display: block;
  }

  .drawer-window-icon--claude {
    color: #D97757;
  }

  /* Drawer New Window Button */
  .drawer-new-window-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 16px 8px 36px;
    min-height: 40px;
    color: var(--accent-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid rgba(42, 42, 74, 0.3);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .drawer-new-window-btn:hover {
    background: rgba(126, 200, 227, 0.08);
  }

  .drawer-new-window-btn:active {
    background: var(--bg-hover);
  }

  .drawer-new-window-btn--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  /* Drawer Loading / Empty / Error */
  .drawer-loading,
  .drawer-empty,
  .drawer-error {
    padding: 24px 16px;
    text-align: center;
    font-size: 14px;
    color: var(--text-secondary);
  }

  .drawer-error {
    color: var(--color-error-text);
  }

  .drawer-window-loading {
    padding: 10px 16px 10px 36px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  /* Drawer New Session Button */
  .drawer-new-session {
    padding: 4px 0;
    border-top: 1px solid rgba(126, 200, 227, 0.08);
  }

  .drawer-new-session-btn {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 10px 16px;
    min-height: 40px;
    background: none;
    border: none;
    border-radius: 0;
    color: rgba(126, 200, 227, 0.7);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    letter-spacing: 0.01em;
  }

  .drawer-new-session-btn:hover {
    background: rgba(126, 200, 227, 0.06);
    color: var(--accent-primary);
  }

  .drawer-new-session-btn:active {
    background: rgba(126, 200, 227, 0.12);
    color: var(--accent-primary);
  }

  /* Drawer New Session Input Form */
  .drawer-new-session-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .drawer-new-session-input {
    width: 100%;
    padding: 8px 12px;
    min-height: 40px;
    background: var(--bg-container);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 16px;
    outline: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .drawer-new-session-input::placeholder {
    color: #6a6a8a;
  }

  .drawer-new-session-input:focus {
    border-color: var(--accent-primary);
  }

  .drawer-new-session-input:disabled {
    opacity: 0.5;
  }

  .drawer-new-session-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .drawer-new-session-create {
    padding: 8px 16px;
    min-height: 40px;
    background: var(--accent-primary);
    color: var(--bg-body);
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-new-session-create:hover {
    background: #6ab8d3;
  }

  .drawer-new-session-create:active {
    background: #5aa8c3;
  }

  .drawer-new-session-cancel {
    padding: 8px 16px;
    min-height: 40px;
    background: none;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-new-session-cancel:hover {
    background: rgba(136, 136, 170, 0.1);
    color: var(--text-primary);
  }

  /* Drawer Inline Error */
  .drawer-inline-error {
    font-size: 13px;
    color: var(--color-error-text);
    padding: 4px 0;
  }

  /* Picker Shared Styles */
  .drawer-project-picker {
    display: flex;
    flex-direction: column;
  }

  .drawer-project-picker-loading {
    padding: 10px 16px;
    font-size: 12px;
    color: #6a6a8a;
  }

  .drawer-project-picker-filter {
    width: calc(100% - 32px);
    padding: 7px 10px 7px 28px;
    min-height: 34px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(126, 200, 227, 0.12);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 16px;
    outline: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 6px 16px 4px 16px;
    transition: border-color 0.2s, background 0.2s;
    background-image: url("data:image/svg+xml,%3Csvg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='6' cy='6' r='4.5' stroke='%236a6a8a' stroke-width='1.3'/%3E%3Cline x1='9.5' y1='9.5' x2='12.5' y2='12.5' stroke='%236a6a8a' stroke-width='1.3' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: 8px center;
    background-size: 14px 14px;
  }

  .drawer-project-picker-filter::placeholder {
    color: #555577;
  }

  .drawer-project-picker-filter:focus {
    border-color: rgba(126, 200, 227, 0.35);
    background-color: rgba(0, 0, 0, 0.3);
  }

  .drawer-project-picker-list {
    max-height: 240px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 2px 0;
  }

  .drawer-project-picker-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    border-left: 2px solid transparent;
  }

  .drawer-project-picker-item:hover {
    background: rgba(126, 200, 227, 0.06);
    border-left-color: rgba(126, 200, 227, 0.3);
  }

  .drawer-project-picker-item:active {
    background: rgba(126, 200, 227, 0.12);
    border-left-color: rgba(126, 200, 227, 0.5);
  }

  .drawer-project-picker-item--creating {
    opacity: 0.5;
    pointer-events: none;
    font-size: 12px;
    color: #6a6a8a;
  }

  .drawer-project-picker-item-name {
    font-size: 13px;
    font-weight: 500;
    color: #d0d0e0;
  }

  .drawer-project-picker-item-path {
    font-size: 10px;
    color: #555577;
    margin-top: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .drawer-project-picker-empty {
    padding: 12px 16px;
    text-align: center;
    font-size: 12px;
    color: #555577;
  }

  /* Picker action links */
  .drawer-picker-actions {
    padding: 4px 0 2px;
    border-top: 1px solid rgba(126, 200, 227, 0.06);
    margin-top: 2px;
  }

  .drawer-project-picker-clone,
  .drawer-project-picker-custom {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    margin: 0;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    border: none;
    border-radius: 0;
    color: rgba(126, 200, 227, 0.55);
    font-size: 12px;
    font-style: normal;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-project-picker-clone:hover,
  .drawer-project-picker-custom:hover {
    background: rgba(126, 200, 227, 0.06);
    color: rgba(126, 200, 227, 0.85);
  }

  .drawer-project-picker-clone:active,
  .drawer-project-picker-custom:active {
    background: rgba(126, 200, 227, 0.1);
  }

  .drawer-project-picker-clone-title {
    font-size: 13px;
    font-weight: 600;
    color: #d0d0e0;
    padding: 8px 16px 4px;
  }

  .drawer-project-picker-clone-actions {
    display: flex;
    gap: 8px;
    padding: 4px 16px 6px;
  }

  .drawer-project-picker-clone-actions button {
    flex: 1;
  }

  .drawer-project-picker-clone-status {
    font-size: 12px;
    color: #7ab896;
    padding: 4px 16px;
  }

  .drawer-delete-modal-path {
    font-size: 11px;
    color: var(--text-secondary);
    word-break: break-all;
    padding: 4px 0 8px;
    font-family: monospace;
  }

  /* Cancel button in pickers */
  .drawer-project-picker-cancel {
    margin: 0;
    width: 100%;
    padding: 8px 16px;
    border: none;
    border-radius: 0;
    text-align: left;
    font-size: 12px;
    font-style: normal;
    min-height: unset;
    color: rgba(136, 136, 170, 0.6);
    background: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .drawer-project-picker-cancel:hover {
    background: rgba(136, 136, 170, 0.06);
    color: rgba(136, 136, 170, 0.9);
  }

  /* Project/Branch structure */
  .drawer-branch-item {
    display: flex;
    align-items: center;
    padding: 6px 12px 6px 28px;
    cursor: pointer;
    color: #ccc;
    font-size: 13px;
    gap: 6px;
    transition: background-color 0.15s;
  }

  .drawer-branch-item:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  .drawer-branch-item:active {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .drawer-branch-item--current {
    color: #fff;
  }

  /* Open Branch trigger */
  .drawer-open-branch-btn {
    display: flex;
    align-items: center;
    padding: 7px 12px 7px 28px;
    cursor: pointer;
    color: rgba(126, 200, 227, 0.5);
    font-size: 12px;
    transition: color 0.15s, background-color 0.15s;
  }

  .drawer-open-branch-btn:hover {
    color: rgba(126, 200, 227, 0.8);
    background-color: rgba(126, 200, 227, 0.06);
  }

  /* Branch Picker (nested inside project) */
  .drawer-branch-picker {
    padding: 2px 0 0;
  }

  .drawer-branch-picker .drawer-project-picker-filter {
    width: calc(100% - 44px);
    margin: 4px 16px 4px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-list {
    max-height: 200px;
  }

  .drawer-branch-picker .drawer-project-picker-item {
    padding: 7px 16px 7px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-item-name {
    font-size: 13px;
    font-weight: 400;
    color: #c0c0d0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .drawer-branch-picker .drawer-project-picker-empty {
    padding: 10px 16px 10px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-clone,
  .drawer-branch-picker .drawer-project-picker-custom {
    padding: 7px 16px 7px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-cancel {
    padding: 7px 16px 7px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-clone-title {
    padding: 8px 16px 4px 28px;
  }

  .drawer-branch-picker .drawer-project-picker-clone-actions {
    padding: 4px 16px 6px 28px;
  }

  .drawer-branch-remote-tag {
    display: inline-block;
    padding: 1px 6px;
    font-size: 9px;
    font-weight: 500;
    color: rgba(136, 136, 170, 0.8);
    background: rgba(136, 136, 170, 0.12);
    border-radius: 3px;
    vertical-align: middle;
    font-style: normal;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .drawer-other-sessions {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin-top: 4px;
    padding-top: 4px;
  }

  .drawer-other-sessions-header {
    color: #888;
  }

  /* Delete Confirmation Modal */
  .drawer-delete-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .drawer-delete-modal-overlay--visible {
    opacity: 1;
  }

  .drawer-delete-modal {
    background: var(--bg-container);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 24px;
    max-width: 300px;
    width: calc(100% - 48px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .drawer-delete-modal-message {
    font-size: 15px;
    color: var(--text-primary);
    text-align: center;
    margin-bottom: 20px;
    line-height: 1.5;
    word-break: break-word;
  }

  .drawer-delete-modal-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .drawer-delete-modal-cancel {
    flex: 1;
    padding: 10px 16px;
    min-height: 44px;
    background: none;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-delete-modal-cancel:hover {
    background: rgba(136, 136, 170, 0.1);
    color: var(--text-primary);
  }

  .drawer-delete-modal-delete {
    flex: 1;
    padding: 10px 16px;
    min-height: 44px;
    background: var(--color-error-text);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .drawer-delete-modal-delete:hover {
    background: #d32f2f;
  }

  .drawer-delete-modal-delete:active {
    background: #c62828;
  }

  .drawer-delete-modal-delete:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Toast notification */
  .drawer-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(100px);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 300;
    transition: transform 0.3s ease;
    max-width: calc(100% - 32px);
    text-align: center;
    word-break: break-word;
  }

  .drawer-toast--visible {
    transform: translateX(-50%) translateY(0);
  }

  .drawer-toast--error {
    background: #d32f2f;
    color: #fff;
    box-shadow: 0 4px 16px rgba(211, 47, 47, 0.3);
  }

  .drawer-toast--info {
    background: #1976d2;
    color: #fff;
    box-shadow: 0 4px 16px rgba(25, 118, 210, 0.3);
  }

  .drawer-toast--success {
    background: #388e3c;
    color: #fff;
    box-shadow: 0 4px 16px rgba(56, 142, 60, 0.3);
  }

  /* Drawer Pin Button */
  .drawer-pin-btn {
    display: none;
  }

  @media (min-width: 601px) {
    .drawer-pin-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      margin-left: 4px;
      background: none;
      border: 1px solid transparent;
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .drawer-pin-btn:hover {
      background: rgba(126, 200, 227, 0.1);
      color: var(--accent-primary);
    }

    .drawer-pin-btn:active {
      background: rgba(126, 200, 227, 0.2);
    }

    :global(.drawer-pin-icon) {
      transition: transform 0.2s ease;
      transform: rotate(45deg);
    }

    .drawer-pin-btn--active {
      color: var(--accent-primary);
      border-color: rgba(126, 200, 227, 0.3);
      background: rgba(126, 200, 227, 0.1);
    }

    .drawer-pin-btn--active :global(.drawer-pin-icon) {
      transform: rotate(0deg);
    }

    .drawer-pin-btn--active :global(.drawer-pin-icon circle) {
      fill: currentColor;
    }

    /* Pinned Drawer */
    .drawer.drawer--pinned {
      transform: translateX(0);
      width: var(--drawer-pinned-width, 280px);
      max-width: none;
      border-right: 1px solid var(--border-subtle);
    }

    /* Drawer Resize Handle */
    .drawer-resize-handle {
      position: absolute;
      top: 0;
      right: -4px;
      width: 8px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;
      display: none;
    }

    .drawer--pinned .drawer-resize-handle {
      display: block;
    }

    .drawer-resize-handle:hover,
    .drawer-resize-handle--active {
      background: rgba(126, 200, 227, 0.3);
    }

    /* App layout shift when drawer is pinned */
    :global(#app) {
      transition: margin-left 0.3s ease;
    }

    :global(body.drawer-pinned #app) {
      margin-left: var(--drawer-pinned-width, 280px);
    }
  }

  /* Drawer Footer */
  .drawer-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 16px;
    border-top: 1px solid rgba(42, 42, 74, 0.6);
  }

  .drawer-footer-name {
    font-size: 11px;
    font-weight: 600;
    color: rgba(126, 200, 227, 0.5);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .drawer-footer-version {
    font-size: 11px;
    color: rgba(136, 136, 170, 0.5);
    font-variant-numeric: tabular-nums;
  }

  /* Mobile adjustments */
  @media (max-width: 600px) {
    .drawer {
      width: 260px;
    }

    .drawer-session-header {
      padding: 10px 14px;
    }

    .drawer-virtual-item {
      padding: 8px 14px 8px 32px;
    }

    .drawer-virtual-item-name {
      font-size: 13px;
    }

    .drawer-window-item {
      padding: 8px 14px 8px 32px;
    }

    .drawer-new-window-btn {
      padding: 6px 14px 6px 32px;
      font-size: 12px;
    }

    .drawer-session-name {
      font-size: 14px;
    }

    .drawer-window-name {
      font-size: 13px;
    }

    .drawer-new-session-btn {
      padding: 8px 14px;
      font-size: 12px;
    }

    .drawer-project-picker-filter {
      margin: 4px 14px;
      width: calc(100% - 28px);
    }

    .drawer-project-picker-list {
      max-height: 200px;
    }

    .drawer-project-picker-item {
      padding: 7px 14px;
    }

    .drawer-project-picker-item-name {
      font-size: 12px;
    }

    .drawer-project-picker-item-path {
      font-size: 9px;
    }

    .drawer-branch-picker .drawer-project-picker-filter {
      margin-left: 24px;
      width: calc(100% - 38px);
    }

    .drawer-branch-picker .drawer-project-picker-item {
      padding: 6px 14px 6px 24px;
    }

    .drawer-branch-picker .drawer-project-picker-empty {
      padding: 8px 14px 8px 24px;
    }

    .drawer-branch-picker .drawer-project-picker-clone,
    .drawer-branch-picker .drawer-project-picker-custom {
      padding: 6px 14px 6px 24px;
    }

    .drawer-branch-picker .drawer-project-picker-cancel {
      padding: 6px 14px 6px 24px;
    }

    .drawer-branch-item {
      padding: 6px 14px 6px 24px;
    }

    .drawer-open-branch-btn {
      padding: 6px 14px 6px 24px;
    }

    .drawer-delete-modal {
      padding: 20px;
      max-width: 260px;
    }

    .drawer-delete-modal-message {
      font-size: 14px;
    }
  }

  /* ============================================================
     Light mode overrides
     ============================================================ */
  :global([data-theme="light"]) .drawer-session-header {
    border-bottom-color: rgba(0, 0, 0, 0.06);
  }
  :global([data-theme="light"]) .drawer-session-header:hover {
    background: rgba(14, 124, 134, 0.05);
  }
  :global([data-theme="light"]) .drawer-session-header:active {
    background: rgba(14, 124, 134, 0.09);
  }
  :global([data-theme="light"]) .drawer-session-header--current {
    background: rgba(14, 124, 134, 0.04);
  }
  :global([data-theme="light"]) .drawer-windows {
    background: rgba(0, 0, 0, 0.02);
  }
  :global([data-theme="light"]) .drawer-window-item {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .drawer-window-item:hover {
    background: rgba(14, 124, 134, 0.05);
  }
  :global([data-theme="light"]) .drawer-window-item:active {
    background: rgba(14, 124, 134, 0.09);
  }
  :global([data-theme="light"]) .drawer-window-item--current {
    background: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-window-rename-input {
    background: rgba(14, 124, 134, 0.05);
  }
  :global([data-theme="light"]) .drawer-window-badge {
    background: #d35400;
  }
  :global([data-theme="light"]) .drawer-virtual-item {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .drawer-virtual-item:hover {
    background: rgba(14, 124, 134, 0.05);
  }
  :global([data-theme="light"]) .drawer-virtual-item:active {
    background: rgba(14, 124, 134, 0.09);
  }
  :global([data-theme="light"]) .drawer-virtual-item--current {
    background: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-new-window-btn {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .drawer-new-window-btn:hover {
    background: rgba(14, 124, 134, 0.05);
  }
  :global([data-theme="light"]) .drawer-new-session-btn {
    border-top-color: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-new-session-btn:hover {
    background: rgba(14, 124, 134, 0.04);
  }
  :global([data-theme="light"]) .drawer-new-session-btn:active {
    background: rgba(14, 124, 134, 0.08);
  }
  :global([data-theme="light"]) .drawer-new-session-create:hover {
    background: #0a6b74;
  }
  :global([data-theme="light"]) .drawer-new-session-create:active {
    background: #085e66;
  }
  :global([data-theme="light"]) .drawer-new-session-cancel:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .drawer-new-session-input::placeholder {
    color: #a0a0a0;
  }
  :global([data-theme="light"]) .drawer-project-picker-filter {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(14, 124, 134, 0.12);
  }
  :global([data-theme="light"]) .drawer-project-picker-filter::placeholder {
    color: #a0a0a0;
  }
  :global([data-theme="light"]) .drawer-project-picker-filter:focus {
    border-color: rgba(14, 124, 134, 0.35);
    background-color: rgba(0, 0, 0, 0.01);
  }
  :global([data-theme="light"]) .drawer-project-picker-item {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .drawer-project-picker-item:hover {
    background: rgba(14, 124, 134, 0.04);
  }
  :global([data-theme="light"]) .drawer-project-picker-item--current {
    background: rgba(14, 124, 134, 0.06);
    border-left-color: rgba(14, 124, 134, 0.3);
  }
  :global([data-theme="light"]) .drawer-project-picker-item--selected {
    background: rgba(14, 124, 134, 0.08);
    border-left-color: rgba(14, 124, 134, 0.5);
  }
  :global([data-theme="light"]) .drawer-project-picker-item--creating {
    color: #a0a0a0;
  }
  :global([data-theme="light"]) .drawer-project-picker-item-name {
    color: #2c2c2c;
  }
  :global([data-theme="light"]) .drawer-project-picker-item-path {
    color: #8a8a8a;
  }
  :global([data-theme="light"]) .drawer-project-picker-item-path--full {
    color: #8a8a8a;
  }
  :global([data-theme="light"]) .drawer-project-picker-custom {
    color: rgba(14, 124, 134, 0.7);
  }
  :global([data-theme="light"]) .drawer-project-picker-custom:hover {
    background: rgba(14, 124, 134, 0.04);
    color: rgba(14, 124, 134, 0.9);
  }
  :global([data-theme="light"]) .drawer-project-picker-clone {
    color: rgba(14, 124, 134, 0.7);
  }
  :global([data-theme="light"]) .drawer-project-picker-clone:hover {
    background: rgba(14, 124, 134, 0.04);
    color: rgba(14, 124, 134, 0.9);
  }
  :global([data-theme="light"]) .drawer-project-picker-clone-status {
    color: #1a8a3e;
  }
  :global([data-theme="light"]) .drawer-project-picker-cancel {
    color: rgba(0, 0, 0, 0.4);
  }
  :global([data-theme="light"]) .drawer-project-picker-cancel:hover {
    background: rgba(0, 0, 0, 0.03);
    color: rgba(0, 0, 0, 0.6);
  }
  :global([data-theme="light"]) .drawer-project-picker-loading {
    color: #a0a0a0;
  }
  :global([data-theme="light"]) .drawer-sort-label {
    color: #8a8a8a;
  }
  :global([data-theme="light"]) .drawer-delete-modal-overlay {
    background: rgba(0, 0, 0, 0.3);
  }
  :global([data-theme="light"]) .drawer-delete-modal {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  }
  :global([data-theme="light"]) .drawer-delete-modal-cancel:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .drawer-delete-modal-delete:hover {
    background: #b01c1c;
  }
  :global([data-theme="light"]) .drawer-delete-modal-delete:active {
    background: #a01919;
  }
  :global([data-theme="light"]) .drawer-overlay {
    background: rgba(0, 0, 0, 0.2);
  }
  :global([data-theme="light"]) .drawer-branch-item {
    border-bottom-color: rgba(0, 0, 0, 0.05);
  }
  :global([data-theme="light"]) .drawer-branch-item:hover {
    background: rgba(14, 124, 134, 0.04);
  }
  :global([data-theme="light"]) .drawer-branch-item:active {
    background: rgba(14, 124, 134, 0.08);
  }
  :global([data-theme="light"]) .drawer-branch-item--current {
    background: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-open-branch-btn {
    color: rgba(14, 124, 134, 0.5);
  }
  :global([data-theme="light"]) .drawer-open-branch-btn:hover {
    color: rgba(14, 124, 134, 0.8);
    background: rgba(14, 124, 134, 0.04);
  }
  :global([data-theme="light"]) .drawer-other-sessions-header {
    color: #6b6b6b;
  }
  :global([data-theme="light"]) .drawer-branch-merged-badge {
    color: rgba(0, 0, 0, 0.4);
    background: rgba(0, 0, 0, 0.04);
  }
  :global([data-theme="light"]) .drawer-branch-delete-btn {
    color: #c41e1e;
  }
  :global([data-theme="light"]) .drawer-branch-delete-btn:hover {
    background: rgba(196, 30, 30, 0.06);
  }
  :global([data-theme="light"]) .drawer-branch-new-name-input {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(14, 124, 134, 0.2);
    color: #2c2c2c;
  }
  :global([data-theme="light"]) .drawer-branch-new-name-input::placeholder {
    color: #a0a0a0;
  }
  :global([data-theme="light"]) .drawer-pin-btn {
    color: #8a8a8a;
  }
  :global([data-theme="light"]) .drawer-pin-btn:hover {
    background: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-pin-btn:active {
    background: rgba(14, 124, 134, 0.10);
  }
  :global([data-theme="light"]) .drawer-pin-btn--active {
    border-color: rgba(14, 124, 134, 0.25);
    background: rgba(14, 124, 134, 0.06);
  }
  :global([data-theme="light"]) .drawer-resize-handle-line {
    background: rgba(14, 124, 134, 0.3);
  }
  :global([data-theme="light"]) .drawer-session-footer {
    border-top-color: rgba(0, 0, 0, 0.06);
  }
  :global([data-theme="light"]) .drawer-session-footer-version {
    color: rgba(0, 0, 0, 0.3);
  }
  :global([data-theme="light"]) .drawer-toast {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
</style>
