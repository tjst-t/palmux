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
  claudePath = 'claude',
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
let sortOrder = $state('activity');

/** @type {Array<{session: string, window_index: number, type: string}>} */
let notifications = $state([]);

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
  try { return localStorage.getItem('palmux-drawer-pinned') === '1' && window.innerWidth > 600; }
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
        projectWorktrees.set(expandedProject, worktrees);
        projectWorktrees = projectWorktrees; // trigger reactivity
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
  expandedProjects.clear();
  if (currentSession) {
    const { repo } = parseSessionName(currentSession);
    expandedProjects.add(repo);
    expandedProjects = expandedProjects; // trigger reactivity
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
      projectWorktrees.set(expandedProject, worktrees);
      projectWorktrees = projectWorktrees;
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
    expandedProjects.delete(projectName);
    expandedProjects = expandedProjects;
    // Reset branch picker if it was for this project
    if (branchPickerProject === projectName) {
      branchPickerMode = 'none';
      branchPickerProject = null;
    }
  } else {
    expandedProjects.clear();
    expandedProjects.add(projectName);
    expandedProjects = expandedProjects;

    // Load worktree cache if needed
    if (!projectWorktrees.has(projectName) && listProjectWorktreesFn) {
      listProjectWorktreesFn(projectName).then(wts => {
        if (wts && wts.length > 0) {
          projectWorktrees.set(projectName, wts);
          projectWorktrees = projectWorktrees;
          groupSessionsByProject(sessions, lastRepos || []);
        }
      }).catch(() => {});
    }

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
  if (expandedProjects.has('__other__')) {
    expandedProjects.delete('__other__');
  } else {
    expandedProjects.add('__other__');
  }
  expandedProjects = expandedProjects;
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

  try {
    if (modal.type === 'delete-session') {
      if (deleteSessionFn) await deleteSessionFn(modal.session.name);
      closeModal();
      await reloadSessions();
      if (modal.session.name === currentSession) {
        await transitionToRecentSession();
      } else if (onDeleteSession) {
        onDeleteSession();
      }
    } else if (modal.type === 'delete-repo') {
      if (deleteGhqRepoFn) await deleteGhqRepoFn(modal.repo.full_path);
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
  try {
    if (deleteProjectWorktreesFn) {
      await deleteProjectWorktreesFn(modal.projectName, modal.branchSession.branch, true);
    }
    closeModal();
    await reloadSessions();
    if (modal.branchSession.name === currentSession) {
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
  try {
    let force = false;
    if (isProjectBranchMergedFn) {
      const { merged } = await isProjectBranchMergedFn(modal.projectName, modal.branchSession.branch);
      if (!merged) {
        const confirmed = window.confirm(
          `Branch "${modal.branchSession.branch}" has unmerged commits. Delete anyway?`
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
      await deleteProjectWorktreesFn(modal.projectName, modal.branchSession.branch, true);
    }
    if (deleteProjectBranchFn) {
      await deleteProjectBranchFn(modal.projectName, modal.branchSession.branch, force);
    }
    closeModal();
    await reloadSessions();
    if (modal.branchSession.name === currentSession) {
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
      projectWorktrees.set(projectName, worktrees);
      projectWorktrees = projectWorktrees;
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
    expandedProjects.clear();
    expandedProjects.add(repo);
    expandedProjects = expandedProjects;
    // Reload data
    const fetches = [listSessionsFn(), listGhqReposFn()];
    if (listProjectWorktreesFn && !projectWorktrees.has(repo)) {
      fetches.push(listProjectWorktreesFn(repo).catch(() => null));
    }
    Promise.all(fetches).then(([newSessions, repos, worktrees]) => {
      sessions = newSessions || [];
      if (worktrees && worktrees.length > 0) {
        projectWorktrees.set(repo, worktrees);
        projectWorktrees = projectWorktrees;
      }
      groupSessionsByProject(sessions, repos || []);
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
  <!-- Sort toggle -->
  <div class="drawer-sort-toggle">
    <span
      class="drawer-sort-label"
      class:drawer-sort-label--active={sortOrder === 'activity'}
      data-sort="activity"
    >Activity</span>
    <label class="drawer-sort-switch">
      <input
        type="checkbox"
        class="drawer-sort-checkbox"
        checked={sortOrder === 'name'}
        onchange={() => { sortOrder = sortOrder === 'activity' ? 'name' : 'activity'; }}
      />
      <span class="drawer-sort-slider"></span>
    </label>
    <span
      class="drawer-sort-label"
      class:drawer-sort-label--active={sortOrder === 'name'}
      data-sort="name"
    >Name</span>

    <!-- Pin button -->
    <button
      class="drawer-pin-btn"
      class:drawer-pin-btn--active={pinned}
      aria-label={pinned ? 'Unpin drawer' : 'Pin drawer'}
      onclick={(e) => { e.stopPropagation(); doTogglePin(); }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M10 1L6 5L2 6L10 14L11 10L15 6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="2" y1="14" x2="6" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
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
