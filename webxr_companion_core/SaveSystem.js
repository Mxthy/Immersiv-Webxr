/**
 * SaveSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent storage for the WebXR Companion app.
 * Provides two layers:
 *   1. localStorage  — fast, small data (< ~5 KB): companion state, settings
 *   2. IndexedDB     — large binary data: morph presets, character configs
 *
 * Usage:
 *   import { SaveSystem } from './webxr_companion_core/SaveSystem.js';
 *   await SaveSystem.init();
 *   await SaveSystem.saveCompanionState();
 *   await SaveSystem.loadCompanionState();
 *
 *   await SaveSystem.saveCharacter('Yuki', { modelUrl, morphState, … });
 *   const chars = await SaveSystem.listCharacters();
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CompanionState } from './CompanionState.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_STATE_KEY   = 'companion_state_v1';
const LS_SETTINGS_KEY = 'companion_settings_v1';
const IDB_NAME       = 'CompanionDB';
const IDB_VERSION    = 1;
const STORE_CHARS    = 'characters';
const STORE_SESSIONS = 'sessions';

// ── SaveSystem ────────────────────────────────────────────────────────────────

class _SaveSystem {
  #db = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  async init() {
    try {
      this.#db = await this._openDB();
      console.log('[SaveSystem] IndexedDB ready.');
    } catch (e) {
      console.warn('[SaveSystem] IndexedDB unavailable, using localStorage only.', e);
    }
  }

  // ── Companion state (localStorage) ────────────────────────────────────────

  /** Persist current CompanionState snapshot to localStorage. */
  saveCompanionState() {
    try {
      const snap = CompanionState.snapshot();
      localStorage.setItem(LS_STATE_KEY, JSON.stringify({
        _version : 1,
        _saved   : Date.now(),
        ...snap,
      }));
    } catch (e) {
      console.error('[SaveSystem] Failed to save companion state:', e);
    }
  }

  /**
   * Load and restore persisted CompanionState.
   * @returns {boolean} true if data was found and applied
   */
  loadCompanionState() {
    try {
      const raw = localStorage.getItem(LS_STATE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const { _version, _saved, ...fields } = data;
      CompanionState.set(fields);
      console.log('[SaveSystem] Companion state restored from', new Date(_saved).toLocaleString());
      return true;
    } catch (e) {
      console.error('[SaveSystem] Failed to load companion state:', e);
      return false;
    }
  }

  /** Wipe companion state from localStorage. */
  clearCompanionState() {
    localStorage.removeItem(LS_STATE_KEY);
  }

  // ── App settings (localStorage) ───────────────────────────────────────────

  /** @param {Object} settings */
  saveSettings(settings) {
    try {
      const existing = this.getSettings();
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify({ ...existing, ...settings, _saved: Date.now() }));
    } catch (e) {
      console.error('[SaveSystem] Failed to save settings:', e);
    }
  }

  /** @returns {Object} */
  getSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  // ── Characters (IndexedDB with localStorage fallback) ─────────────────────

  /**
   * Save or update a named character configuration.
   * @param {string} name
   * @param {Object} data  - { modelUrl, morphState, personality, gender, … }
   */
  async saveCharacter(name, data) {
    const record = {
      id        : this._slugify(name),
      name,
      saved     : Date.now(),
      ...data,
    };

    if (this.#db) {
      await this._idbPut(STORE_CHARS, record);
    } else {
      // localStorage fallback — store as JSON array
      const chars = this._lsGetChars();
      const idx   = chars.findIndex(c => c.id === record.id);
      if (idx >= 0) chars[idx] = record; else chars.push(record);
      this._lsSetChars(chars);
    }
    console.log(`[SaveSystem] Character "${name}" saved.`);
    return record;
  }

  /**
   * Load a character by name or id.
   * @param {string} nameOrId
   * @returns {Object|null}
   */
  async loadCharacter(nameOrId) {
    const id = this._slugify(nameOrId);
    if (this.#db) {
      return await this._idbGet(STORE_CHARS, id);
    }
    return this._lsGetChars().find(c => c.id === id) || null;
  }

  /**
   * List all saved characters.
   * @returns {Object[]}
   */
  async listCharacters() {
    if (this.#db) {
      return await this._idbGetAll(STORE_CHARS);
    }
    return this._lsGetChars();
  }

  /**
   * Delete a character by name or id.
   */
  async deleteCharacter(nameOrId) {
    const id = this._slugify(nameOrId);
    if (this.#db) {
      await this._idbDelete(STORE_CHARS, id);
    } else {
      const chars = this._lsGetChars().filter(c => c.id !== id);
      this._lsSetChars(chars);
    }
  }

  // ── Sessions (IndexedDB) ───────────────────────────────────────────────────

  /** Record a completed session for relationship history. */
  async logSession(summary) {
    const record = {
      id       : `session_${Date.now()}`,
      recorded : Date.now(),
      ...summary,
    };
    if (this.#db) {
      await this._idbPut(STORE_SESSIONS, record);
    }
    return record;
  }

  /** Get the last N sessions. */
  async getRecentSessions(n = 10) {
    if (!this.#db) return [];
    const all = await this._idbGetAll(STORE_SESSIONS);
    return all.sort((a, b) => b.recorded - a.recorded).slice(0, n);
  }

  // ── Auto-save helper ───────────────────────────────────────────────────────

  /**
   * Start an interval that auto-saves companion state every intervalMs ms.
   * Returns a cancellation function.
   */
  startAutoSave(intervalMs = 30000) {
    const id = setInterval(() => this.saveCompanionState(), intervalMs);
    console.log(`[SaveSystem] Auto-save every ${intervalMs / 1000}s started.`);
    return () => clearInterval(id);
  }

  // ── Export / Import ────────────────────────────────────────────────────────

  /** Export all data as a JSON string for download. */
  async exportAll() {
    const chars    = await this.listCharacters();
    const sessions = await this.getRecentSessions(100);
    const state    = CompanionState.snapshot();
    const settings = this.getSettings();
    return JSON.stringify({ _export: Date.now(), state, settings, chars, sessions }, null, 2);
  }

  /** Import a previously exported JSON string. */
  async importAll(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.state)    CompanionState.set(data.state);
    if (data.settings) this.saveSettings(data.settings);
    if (data.chars)    for (const c of data.chars) await this.saveCharacter(c.name, c);
    console.log('[SaveSystem] Import complete.');
  }

  // ── Private: IndexedDB helpers ─────────────────────────────────────────────

  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_CHARS)) {
          db.createObjectStore(STORE_CHARS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        }
      };

      req.onsuccess  = (e) => resolve(e.target.result);
      req.onerror    = (e) => reject(e.target.error);
    });
  }

  _idbPut(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  _idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  _idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  _idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx  = this.#db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  // ── Private: localStorage char fallback ───────────────────────────────────

  _lsGetChars() {
    try {
      return JSON.parse(localStorage.getItem('companion_chars_v1') || '[]');
    } catch (_) { return []; }
  }

  _lsSetChars(arr) {
    localStorage.setItem('companion_chars_v1', JSON.stringify(arr));
  }

  // ── Private: utils ─────────────────────────────────────────────────────────

  _slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  }
}

export const SaveSystem = new _SaveSystem();
