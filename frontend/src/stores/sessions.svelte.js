// sessions.svelte.js - Session and window cache store

let sessions = $state([]);
let currentSession = $state(null);
let currentWindows = $state([]);
let isClaudeCodeMode = $state(false);
let claudeWindow = $state(-1);
let loading = $state(false);
let error = $state(null);

export function getSessions() { return sessions; }
export function setSessions(s) { sessions = s || []; }

export function getCurrentSession() { return currentSession; }
export function setCurrentSession(s) { currentSession = s; }

export function getCurrentWindows() { return currentWindows; }
export function setCurrentWindows(w) { currentWindows = w || []; }

export function getIsClaudeCodeMode() { return isClaudeCodeMode; }
export function setIsClaudeCodeMode(v) { isClaudeCodeMode = v; }

export function getClaudeWindow() { return claudeWindow; }
export function setClaudeWindow(w) { claudeWindow = w; }

export function getLoading() { return loading; }
export function setLoading(v) { loading = v; }

export function getError() { return error; }
export function setError(e) { error = e; }

/**
 * Check if a window is a Claude window.
 * @param {number} windowIndex
 * @returns {boolean}
 */
export function isClaudeWindow(windowIndex) {
  if (!isClaudeCodeMode) return false;
  return currentWindows.some(w => w.index === windowIndex && w.name === 'claude');
}

/**
 * Find the latest session by activity.
 * @returns {object|null}
 */
export function getLatestSession() {
  if (sessions.length === 0) return null;
  let latest = sessions[0];
  for (let i = 1; i < sessions.length; i++) {
    if (new Date(sessions[i].activity) > new Date(latest.activity)) {
      latest = sessions[i];
    }
  }
  return latest;
}
