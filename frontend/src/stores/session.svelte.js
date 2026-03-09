/**
 * Session & project state store.
 * Centralizes session list, active session, and project (ghq) information.
 */
import { listSessions, createSession as apiCreateSession, deleteSession as apiDeleteSession } from '../../js/api.js';

/** @typedef {{ name: string, windows: number, attached: number, created: number }} Session */
/** @typedef {{ name: string, path: string, full_path: string }} Project */

let sessions = $state([]);
let activeSession = $state(null);
let projects = $state([]);
let loading = $state(false);
let error = $state(null);

export const sessionStore = {
  get sessions() { return sessions; },
  get activeSession() { return activeSession; },
  set activeSession(value) { activeSession = value; },
  get projects() { return projects; },
  set projects(value) { projects = value; },
  get loading() { return loading; },
  get error() { return error; },

  /** Fetch sessions from API and update store */
  async fetchSessions() {
    loading = true;
    error = null;
    try {
      sessions = await listSessions();
      return sessions;
    } catch (e) {
      error = e;
      throw e;
    } finally {
      loading = false;
    }
  },

  /** Create a new session */
  async createSession(name) {
    const result = await apiCreateSession(name);
    await this.fetchSessions();
    return result;
  },

  /** Delete a session */
  async deleteSession(name) {
    await apiDeleteSession(name);
    if (activeSession === name) {
      activeSession = null;
    }
    await this.fetchSessions();
  },

  /** Set sessions directly (e.g. from external polling) */
  setSessions(newSessions) {
    sessions = newSessions;
  },

  /** Find session by name */
  findSession(name) {
    return sessions.find(s => s.name === name) || null;
  },
};
