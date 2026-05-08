/**
 * CompanionState.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central reactive state store for the WebXR Companion system.
 * Drop-in module for bab82afe2_vr_companion_app.html.
 *
 * Usage:
 *   import { CompanionState } from './webxr_companion_core/CompanionState.js';
 *   CompanionState.on('affection', (val, prev) => console.log(val));
 *   CompanionState.set('affection', 0.6);
 *
 * All numeric stats are clamped [0 … 1] unless noted.
 * Strings are validated against their enum sets.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Enumerations ─────────────────────────────────────────────────────────────

export const MOODS = Object.freeze([
  'neutral', 'happy', 'shy', 'playful', 'melancholy',
  'excited', 'annoyed', 'loving', 'embarrassed', 'surprised',
]);

export const SCENE_MODES = Object.freeze([
  'casual', 'flirt', 'cuddle', 'adult',   // 'adult' requires ContentPack unlock
]);

export const RELATIONSHIP_STAGES = Object.freeze([
  'stranger', 'acquaintance', 'friend', 'close_friend',
  'romantic_interest', 'partner',
]);

// ── Default state ─────────────────────────────────────────────────────────────

const DEFAULTS = {
  // Emotional stats  [0 … 1]
  trust       : 0.0,
  affection   : 0.0,
  comfort     : 0.5,
  arousal     : 0.0,

  // Qualitative state
  mood              : 'neutral',        // one of MOODS
  sceneMode         : 'casual',         // one of SCENE_MODES
  relationshipStage : 'stranger',       // one of RELATIONSHIP_STAGES

  // Session meta
  sessionStartTime  : null,
  totalInteractionSeconds : 0,

  // Content-gate
  adultPackUnlocked : false,
};

// ── Internal store ────────────────────────────────────────────────────────────

class _CompanionState {
  #state    = { ...DEFAULTS, sessionStartTime: Date.now() };
  #listeners = new Map();   // key → Set<fn>
  #globalListeners = new Set();

  // ── Read ───────────────────────────────────────────────────────────────────

  get(key) {
    if (key === undefined) return { ...this.#state };
    return this.#state[key];
  }

  snapshot() {
    return { ...this.#state };
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Set one or multiple state fields.
   * @param {string|Object} keyOrObj  - field name or {key:val, …} object
   * @param {*}             [value]   - value when keyOrObj is a string
   */
  set(keyOrObj, value) {
    if (typeof keyOrObj === 'object') {
      Object.entries(keyOrObj).forEach(([k, v]) => this._applyField(k, v));
    } else {
      this._applyField(keyOrObj, value);
    }
  }

  /**
   * Nudge a numeric stat by delta, clamped [0, 1].
   * @param {string} key
   * @param {number} delta  - positive or negative
   */
  nudge(key, delta) {
    const prev = this.#state[key];
    if (typeof prev !== 'number') return;
    this.set(key, prev + delta);
  }

  /**
   * Reset all state to defaults (call on session end or character switch).
   */
  reset() {
    const prev = { ...this.#state };
    this.#state = { ...DEFAULTS, sessionStartTime: Date.now() };
    // Emit change for every field that changed
    Object.keys(DEFAULTS).forEach(k => {
      if (this.#state[k] !== prev[k]) this._emit(k, this.#state[k], prev[k]);
    });
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to changes of a specific field.
   * @param {string}   key
   * @param {Function} fn   - called with (newValue, previousValue)
   * @returns {Function} unsubscribe
   */
  on(key, fn) {
    if (!this.#listeners.has(key)) this.#listeners.set(key, new Set());
    this.#listeners.get(key).add(fn);
    return () => this.#listeners.get(key)?.delete(fn);
  }

  /**
   * Subscribe to any state change.
   * @param {Function} fn  - called with (key, newValue, previousValue)
   * @returns {Function} unsubscribe
   */
  onAny(fn) {
    this.#globalListeners.add(fn);
    return () => this.#globalListeners.delete(fn);
  }

  // ── Derived helpers ────────────────────────────────────────────────────────

  /**
   * Mood derived from current numeric stats if not manually overridden.
   * Override with set('mood', 'happy') for explicit control.
   */
  deriveMood() {
    const { trust, affection, comfort, arousal } = this.#state;
    if (arousal > 0.7)               return 'excited';
    if (affection > 0.7 && trust > 0.5) return 'loving';
    if (affection > 0.6)             return 'happy';
    if (comfort < 0.3)               return 'shy';
    if (trust < 0.2)                 return 'melancholy';
    return 'neutral';
  }

  /**
   * Auto-advance relationship stage based on trust + affection.
   * Call after significant interactions.
   */
  updateRelationshipStage() {
    const { trust, affection, totalInteractionSeconds: secs } = this.#state;
    let stage = 'stranger';
    if (trust > 0.1 || secs > 60)              stage = 'acquaintance';
    if (trust > 0.3 && affection > 0.2)        stage = 'friend';
    if (trust > 0.55 && affection > 0.4)       stage = 'close_friend';
    if (trust > 0.7 && affection > 0.65)       stage = 'romantic_interest';
    if (trust > 0.85 && affection > 0.85)      stage = 'partner';
    this.set('relationshipStage', stage);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _applyField(key, value) {
    if (!(key in DEFAULTS)) {
      console.warn(`[CompanionState] Unknown field: "${key}"`);
      return;
    }
    const prev = this.#state[key];

    // Type-specific validation
    if (['trust','affection','comfort','arousal'].includes(key)) {
      value = Math.max(0, Math.min(1, Number(value) || 0));
    } else if (key === 'mood' && !MOODS.includes(value)) {
      console.warn(`[CompanionState] Unknown mood: "${value}"`);
      return;
    } else if (key === 'sceneMode' && !SCENE_MODES.includes(value)) {
      console.warn(`[CompanionState] Unknown sceneMode: "${value}"`);
      return;
    } else if (key === 'relationshipStage' && !RELATIONSHIP_STAGES.includes(value)) {
      console.warn(`[CompanionState] Unknown relationshipStage: "${value}"`);
      return;
    } else if (key === 'sceneMode' && value === 'adult' && !this.#state.adultPackUnlocked) {
      console.warn('[CompanionState] Adult mode requires adultPackUnlocked = true');
      return;
    }

    if (value === prev) return;   // no-op
    this.#state[key] = value;
    this._emit(key, value, prev);
  }

  _emit(key, value, prev) {
    this.#listeners.get(key)?.forEach(fn => {
      try { fn(value, prev); } catch(e) { console.error('[CompanionState] Listener error:', e); }
    });
    this.#globalListeners.forEach(fn => {
      try { fn(key, value, prev); } catch(e) { console.error('[CompanionState] GlobalListener error:', e); }
    });
  }
}

export const CompanionState = new _CompanionState();

// ── Convenience: session timer (call once per second from render loop or setInterval) ──
let _lastTick = Date.now();
export function tickSessionTimer() {
  const now   = Date.now();
  const delta = (now - _lastTick) / 1000;
  _lastTick   = now;
  if (delta < 5) {  // ignore large gaps (tab backgrounded)
    CompanionState.nudge('totalInteractionSeconds', delta);
  }
}
