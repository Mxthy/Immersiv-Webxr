/**
 * ReactionPipeline.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates all companion reactions:
 *   • VRM expression blending (expressionManager)
 *   • VRMA animation clip triggers (AnimationMixer hooks)
 *   • WebXR haptic feedback
 *   • Speech Synthesis (Web Speech API) with optional TTS adapter interface
 *   • CompanionState changes driven by events
 *
 * Wire up:
 *   const rp = new ReactionPipeline({ vrm, mixer, renderer, floatingUI, state });
 *   zones.on('zoneEnter', rp.handleZoneEnter.bind(rp));
 *   zones.on('gazeHeld',  rp.handleGazeHeld.bind(rp));
 *
 * In render loop:
 *   rp.update(dt, timestamp);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { CompanionState, MOODS } from './CompanionState.js';

// ── Expression presets ────────────────────────────────────────────────────────

const EXPR_PRESETS = {
  neutral    : { happy: 0, sad: 0, surprised: 0, angry: 0, relaxed: 0 },
  happy      : { happy: 1.0, relaxed: 0.3 },
  shy        : { happy: 0.55, relaxed: 0.1 },
  playful    : { happy: 0.8, surprised: 0.3 },
  melancholy : { sad: 0.7, relaxed: 0.2 },
  excited    : { happy: 1.0, surprised: 0.7 },
  annoyed    : { angry: 0.6 },
  loving     : { happy: 0.8, relaxed: 0.5 },
  embarrassed: { happy: 0.4, surprised: 0.4 },
  surprised  : { surprised: 1.0 },
};

// Zone → expression mapping
const ZONE_EXPR_MAP = {
  head       : 'surprised',
  shoulder_l : 'shy',
  shoulder_r : 'shy',
  hand_l     : 'happy',
  hand_r     : 'happy',
  chest      : 'surprised',
  waist      : 'happy',
  hips       : 'surprised',
  upper_leg_l: 'shy',
  upper_leg_r: 'shy',
  breast     : 'excited',
  groin      : 'excited',
  butt       : 'surprised',
};

// Zone → reaction lines (de / en)
const ZONE_LINES = {
  head       : { de: ['*hält inne*', 'Du berührst mein Gesicht...'],       en: ['*pauses*', 'You\'re touching my face...'] },
  shoulder_l : { de: ['Hmm~'],                                              en: ['Hmm~'] },
  shoulder_r : { de: ['*lächelt leise*'],                                   en: ['*smiles quietly*'] },
  chest      : { de: ['W-was machst du?', '...'],                           en: ['W-what are you doing?', '...'] },
  hips       : { de: ['H-hey!', '*weicht leicht zurück*'],                  en: ['H-hey!', '*steps back slightly*'] },
  breast     : { de: ['Ah—', '*errötet stark*'],                            en: ['Ah—', '*blushes deeply*'] },
  groin      : { de: ['...!', '*zieht scharf Luft ein*'],                   en: ['...!', '*sharp intake of breath*'] },
  butt       : { de: ['H-hey! Das—', '...!'],                               en: ['H-hey! That—', '...!'] },
};

// Scene-mode ambient lines (called when idle + mood + scene combo)
const SCENE_LINES = {
  casual : {
    neutral  : { de: ['Was machst du so?', 'Schön hier.'],                  en: ['What are you up to?', 'Nice here.'] },
    happy    : { de: ['Ich freue mich, dass du hier bist.'],                en: ['I\'m glad you\'re here.'] },
    shy      : { de: ['Ich... weiß nicht was ich sagen soll.'],             en: ['I... don\'t know what to say.'] },
  },
  flirt : {
    neutral  : { de: ['Du schaust mich so an...', '*lächelt seitlich*'],    en: ['The way you look at me...', '*side smile*'] },
    happy    : { de: ['Ich mag dich, weißt du das?'],                       en: ['I like you, you know that?'] },
    loving   : { de: ['Bleib einfach bei mir.'],                            en: ['Just stay with me.'] },
  },
  cuddle : {
    loving   : { de: ['*lehnt sich an dich an*', 'Mmmh...'],               en: ['*leans against you*', 'Mmmh...'] },
    happy    : { de: ['Das ist warm und gut.'],                              en: ['This is warm and nice.'] },
    neutral  : { de: ['*liegt still*'],                                      en: ['*lies still*'] },
  },
};

// ── TTS Adapter interface ─────────────────────────────────────────────────────
// Swap this object out for a real TTS provider (ElevenLabs, Azure, etc.)

class _WebSpeechAdapter {
  #voices = [];
  #ready  = false;
  #lang   = 'de-DE';

  constructor() {
    if (!window.speechSynthesis) return;
    const load = () => {
      this.#voices = window.speechSynthesis.getVoices();
      this.#ready  = this.#voices.length > 0;
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
  }

  setLang(lang) { this.#lang = lang === 'de' ? 'de-DE' : 'en-US'; }

  speak(text, { pitch = 1.1, rate = 0.95 } = {}) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang  = this.#lang;
    utt.pitch = pitch;
    utt.rate  = rate;

    // Prefer a female voice if available
    const preferred = this.#voices.find(v =>
      v.lang.startsWith(this.#lang.slice(0, 2)) &&
      /female|woman|girl/i.test(v.name)
    ) || this.#voices.find(v => v.lang.startsWith(this.#lang.slice(0, 2)));
    if (preferred) utt.voice = preferred;

    window.speechSynthesis.speak(utt);
  }

  stop() { window.speechSynthesis?.cancel(); }
}

// ── ReactionPipeline class ────────────────────────────────────────────────────

export class ReactionPipeline {
  /**
   * @param {Object} opts
   * @param {import('@pixiv/three-vrm').VRM}  opts.vrm
   * @param {THREE.AnimationMixer}             opts.mixer
   * @param {THREE.WebGLRenderer}              opts.renderer
   * @param {import('./VRFloatingUI').VRFloatingUI} [opts.floatingUI]
   * @param {string}                           [opts.lang]  - 'de' | 'en'
   * @param {Object}                           [opts.ttsAdapter] - custom TTS
   */
  constructor({ vrm, mixer, renderer, floatingUI, lang = 'de', ttsAdapter } = {}) {
    this.vrm        = vrm;
    this.mixer      = mixer;
    this.renderer   = renderer;
    this.floatingUI = floatingUI;
    this.lang       = lang;

    this.tts        = ttsAdapter ?? new _WebSpeechAdapter();
    this.tts.setLang?.(lang);

    // VRMA clips registry: name → AnimationAction
    this._clips     = new Map();
    this._contentPacks = new Map();

    // Runtime HUD-adjustable settings
    this.hapticsEnabled = true;
    this.stateDeltaScale = 1.0;
    this.ttsEnabled = true;

    // Current expression blend target
    this._exprTarget  = { ...EXPR_PRESETS.neutral };
    this._exprCurrent = {};

    // Timers
    this._idleTimer       = 0;
    this._idleInterval    = 8;    // seconds between idle lines
    this._reactionCooldown = 0;
    this._reactionCooldownMax = 2.0;

    // Listen for state changes to drive mood-expressions
    CompanionState.on('mood', (mood) => this._onMoodChange(mood));
    CompanionState.on('sceneMode', (mode) => this._onSceneModeChange(mode));
    CompanionState.on('arousal', (val) => {
      if (val > 0.85) this._setExpressionBlend('excited');
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Call from render loop. */
  update(dt, timestamp) {
    this._blendExpressions(dt);
    this._idleTimer += dt;
    if (this._idleTimer >= this._idleInterval) {
      this._idleTimer = 0;
      this._doIdleLine();
    }
    if (this._reactionCooldown > 0) this._reactionCooldown -= dt;
  }

  /** Bind VRM after model load. */
  rebindVRM(vrm, mixer) {
    this.vrm   = vrm;
    this.mixer = mixer;
    this._exprCurrent = {};
  }

  /** Set language for TTS and line selection. */
  setLang(lang) {
    this.lang = lang;
    this.tts.setLang?.(lang);
  }

  /**
   * Register a VRMA AnimationAction so the pipeline can trigger it by name.
   * @param {string} name
   * @param {THREE.AnimationAction} action
   */
  registerClip(name, action) {
    this._clips.set(name, action);
  }

  /**
   * Register declarative reaction data from a SceneSystem content pack.
   * Supported optional fields:
   *   - expressionSets: { presetName: { happy: 0.5, relaxed: 0.2, ... } }
   *   - animationHints: { zoneId|default|idle: ['clipNameA', 'clipNameB'] }
   *   - zoneReactions: { zoneId|default: { expression, lines, haptic, stateDelta, animation } }
   */
  registerContentPack(id, packDefinition = {}) {
    this._contentPacks.set(id, packDefinition);

    if (packDefinition.expressionSets && typeof packDefinition.expressionSets === 'object') {
      Object.assign(EXPR_PRESETS, packDefinition.expressionSets);
    }

    console.log(`[ReactionPipeline] Content pack reactions registered: "${id}"`);
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  handleZoneEnter({ zone, hand, def }) {
    if (this._reactionCooldown > 0) return;
    this._reactionCooldown = this._reactionCooldownMax;

    const sceneMode = CompanionState.get('sceneMode');
    const packReaction = this._resolvePackZoneReaction(sceneMode, zone);

    // Expression
    const exprName = packReaction?.expression || ZONE_EXPR_MAP[zone] || 'surprised';
    this._setExpressionBlend(exprName, packReaction?.expressionIntensity ?? 0.85, packReaction?.holdSeconds ?? 2.0);

    // Speech
    const lines = packReaction?.lines?.[this.lang] || ZONE_LINES[zone]?.[this.lang];
    let spokenLine = '';
    if (lines?.length) {
      const line = lines[Math.floor(Math.random() * lines.length)];
      spokenLine = line;
      this._say(line);
    }

    // TTS
    if (!spokenLine?.startsWith?.('*')) {
      const textLine = spokenLine || lines?.find(l => !l.startsWith('*'));
      if (textLine && this.ttsEnabled) this.tts.speak?.(textLine);
    }

    // VRMA clip trigger for zone-specific body reaction
    const clipHint = packReaction?.animation || this._resolvePackAnimationHint(sceneMode, zone) || zone;
    this._triggerClip(clipHint);

    // Haptics on opposite hand (the one not touching)
    const h = packReaction?.haptic || {};
    this._pulseHaptic(hand === 0 ? 1 : 0, h.durationMs ?? 80, h.intensity ?? 0.4);

    if (packReaction?.stateDelta) {
      Object.entries(packReaction.stateDelta).forEach(([key, delta]) => {
        if (typeof delta === 'number') CompanionState.nudge(key, delta * this.stateDeltaScale);
      });
    }
  }

  handleZoneExit({ zone }) {
    // Fade expression back
    setTimeout(() => this._setExpressionBlend('neutral'), 1200);
  }

  handleGazeHeld({ seconds }) {
    if (this._reactionCooldown > 0) return;
    this._reactionCooldown = 4.0;
    this._setExpressionBlend('shy', 0.7, 3.0);
    const shyLines = {
      de: ['D-du starrst mich an...', '*schaut weg*'],
      en: ['Y-you\'re staring...', '*looks away*'],
    };
    const line = shyLines[this.lang][Math.floor(Math.random() * 2)];
    this._say(line);
    if (!line.startsWith('*') && this.ttsEnabled) this.tts.speak?.(line);
  }

  /**
   * Trigger a named reaction manually (e.g. from personality NPC response).
   * @param {string} reactionName  - 'wave'|'happy'|'shy'|'nod'|'shake'|'excited'|'loving'
   */
  triggerReaction(reactionName) {
    this._setExpressionBlend(reactionName);
    this._triggerClip(reactionName);
  }

  /**
   * Speak a line (updates speech bubble + TTS).
   */
  say(text) { this._say(text); if (this.ttsEnabled) this.tts.speak?.(text); }

  // ── Private: expressions ───────────────────────────────────────────────────

  _setExpressionBlend(presetName, intensity = 1.0, holdSeconds = 0) {
    const preset = EXPR_PRESETS[presetName] || EXPR_PRESETS.neutral;
    this._exprTarget = {};
    Object.entries(preset).forEach(([k, v]) => {
      this._exprTarget[k] = v * intensity;
    });
    if (holdSeconds > 0) {
      setTimeout(() => {
        this._exprTarget = { ...EXPR_PRESETS.neutral };
      }, holdSeconds * 1000);
    }
  }

  _blendExpressions(dt) {
    if (!this.vrm?.expressionManager) return;
    const speed = 4.0 * dt;   // blend speed

    // Merge all known expression names
    const allKeys = new Set([
      ...Object.keys(this._exprTarget),
      ...Object.keys(this._exprCurrent),
    ]);

    allKeys.forEach(key => {
      const target  = this._exprTarget[key] ?? 0;
      const current = this._exprCurrent[key] ?? 0;
      const next    = current + (target - current) * Math.min(1, speed);
      this._exprCurrent[key] = next;
      try { this.vrm.expressionManager.setValue(key, next); } catch(_) {}
    });
  }

  // ── Private: VRMA clip hooks ───────────────────────────────────────────────

  _triggerClip(name) {
    // Exact match first, then fuzzy
    let action = this._clips.get(name);
    if (!action) {
      for (const [k, v] of this._clips) {
        if (k.toLowerCase().includes(name.toLowerCase())) { action = v; break; }
      }
    }
    if (!action) {
      // Fallback to the host app's procedural animation switch if available.
      // This covers built-ins such as breath, wave, happy, shy, nod, shake,
      // dance and ragdoll when no external VRMA clip has been loaded.
      try {
        if (typeof window.setAnim === 'function') window.setAnim(name, null);
      } catch (_) {}
      return;
    }

    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(0.25).play();
  }

  // ── Private: TTS / speech bubble ──────────────────────────────────────────

  _say(text) {
    if (this.floatingUI) this.floatingUI.setSpeech(text);
    // Also update existing DOM speech bubble if present
    const el = document.getElementById('npc-speech');
    if (el) el.textContent = text;
  }

  // ── Private: idle lines ────────────────────────────────────────────────────

  _doIdleLine() {
    const sceneMode = CompanionState.get('sceneMode');
    const mood      = CompanionState.get('mood');
    const pack      = this._contentPacks.get(sceneMode);
    const packBank  = pack?.idleLines?.[mood]?.[this.lang]
                   || pack?.idleLines?.neutral?.[this.lang];
    const bank      = packBank
                   || SCENE_LINES[sceneMode]?.[mood]?.[this.lang]
                   || SCENE_LINES['casual']?.['neutral']?.[this.lang]
                   || [];
    if (!bank.length) return;
    const line = bank[Math.floor(Math.random() * bank.length)];
    this._say(line);
    if (!line.startsWith('*') && this.ttsEnabled) this.tts.speak?.(line, { rate: 0.88 });
  }

  // ── Private: mood/scene change reactions ──────────────────────────────────

  _onMoodChange(mood) {
    this._setExpressionBlend(mood, 0.75, 4.0);
  }

  _onSceneModeChange(mode) {
    const pack = this._contentPacks.get(mode);
    const packLine = pack?.sceneEnterLines?.[this.lang];
    if (packLine?.length) {
      const line = packLine[Math.floor(Math.random() * packLine.length)];
      this._say(line);
      if (!line.startsWith('*') && this.ttsEnabled) this.tts.speak?.(line);
      const clip = this._resolvePackAnimationHint(mode, 'sceneEnter');
      if (clip) this._triggerClip(clip);
      return;
    }

    const announcements = {
      casual : { de: 'Entspannt bleiben~',    en: 'Keeping it relaxed~' },
      flirt  : { de: 'Du interessierst mich.', en: 'You interest me.' },
      cuddle : { de: '*kuschelt*',             en: '*cuddles up*' },
      adult  : { de: '...',                    en: '...' },
    };
    const line = announcements[mode]?.[this.lang] || '';
    if (line) { this._say(line); if (!line.startsWith('*') && this.ttsEnabled) this.tts.speak?.(line); }
  }

  // ── Private: haptics ───────────────────────────────────────────────────────

  _pulseHaptic(handIndex, durationMs, intensity) {
    try {
      if (!this.hapticsEnabled) return;
      const session = this.renderer.xr.getSession();
      if (!session) return;
      const src = [...(session.inputSources || [])][handIndex];
      src?.gamepad?.hapticActuators?.[0]?.pulse(intensity, durationMs);
    } catch (_) {}
  }

  _resolvePackZoneReaction(sceneMode, zone) {
    const pack = this._contentPacks.get(sceneMode);
    if (!pack?.zoneReactions) return null;
    return pack.zoneReactions[zone] || pack.zoneReactions.default || null;
  }

  _resolvePackAnimationHint(sceneMode, key) {
    const pack = this._contentPacks.get(sceneMode);
    const hints = pack?.animationHints;
    if (!hints) return null;

    const pick = hints[key] || hints.default;
    if (Array.isArray(pick)) return pick[Math.floor(Math.random() * pick.length)];
    return pick || null;
  }
}
