/**
 * SceneSystem.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages environment / mood transitions between scene modes:
 *   casual  — neutral lit room, ambient idle behaviour
 *   flirt   — warmer pink/purple lighting, closer proximity, playful poses
 *   cuddle  — soft warm lights, slow breathing animations, reduced personal space
 *   adult   — (gated) darkened intimate lighting, unlocked interaction zones
 *             Loaded separately as ContentPack — no explicit content here.
 *
 * Each mode is a "ScenePack" object with:
 *   - lighting preset
 *   - animation hint (sent to ReactionPipeline)
 *   - environment colour / fog
 *   - companion behaviour params
 *
 * Usage:
 *   import { SceneSystem } from './webxr_companion_core/SceneSystem.js';
 *   const ss = new SceneSystem({ scene, renderer, state, pipeline });
 *   ss.transition('flirt');
 *
 * ContentPack API:
 *   SceneSystem.registerContentPack('adult', adultPackDefinition);
 *   // adultPackDefinition imported from a separate optional file that is
 *   // not included here and must be acquired + age-verified separately.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { CompanionState, SCENE_MODES } from './CompanionState.js';

// ── Scene pack definitions ─────────────────────────────────────────────────

const BUILT_IN_PACKS = {

  casual: {
    id       : 'casual',
    label    : { de: 'Entspannt', en: 'Casual' },
    locked   : false,

    env: {
      background : 0x090912,
      fogColor   : 0x090912,
      fogDensity : 0.045,
    },

    lights: [
      { type: 'ambient',     color: 0xffffff,  intensity: 0.50 },
      { type: 'directional', color: 0xffffff,  intensity: 1.40, pos: [2, 5, 3]  },
      { type: 'directional', color: 0xa855f7,  intensity: 0.42, pos: [-3, 4, -2] },
      { type: 'point',       color: 0xec4899,  intensity: 0.32, pos: [1, 2, -1], distance: 10 },
    ],

    companion: {
      personalSpaceRadius : 0.5,
      idleAnimHint        : 'breath',
      lookAtEnabled       : true,
      arousalDecayRate    : 0.005,   // per second
      comfortGainRate     : 0.002,
    },
  },

  flirt: {
    id       : 'flirt',
    label    : { de: 'Flirten', en: 'Flirt' },
    locked   : false,

    env: {
      background : 0x0d0518,
      fogColor   : 0x0d0518,
      fogDensity : 0.038,
    },

    lights: [
      { type: 'ambient',     color: 0xffe0f0,  intensity: 0.45 },
      { type: 'directional', color: 0xffb0d0,  intensity: 1.20, pos: [1.5, 4, 2]  },
      { type: 'directional', color: 0xcc55ff,  intensity: 0.60, pos: [-2, 5, -1]  },
      { type: 'point',       color: 0xff66aa,  intensity: 0.70, pos: [0.5, 1.5, -0.5], distance: 8 },
    ],

    companion: {
      personalSpaceRadius : 0.30,   // less shy, allows closer
      idleAnimHint        : 'wave',
      lookAtEnabled       : true,
      arousalDecayRate    : 0.002,
      comfortGainRate     : 0.004,
    },
  },

  cuddle: {
    id       : 'cuddle',
    label    : { de: 'Kuscheln', en: 'Cuddle' },
    locked   : false,

    env: {
      background : 0x060210,
      fogColor   : 0x060210,
      fogDensity : 0.030,
    },

    lights: [
      { type: 'ambient',     color: 0xfff0e0,  intensity: 0.35 },
      { type: 'directional', color: 0xffddcc,  intensity: 0.80, pos: [0.5, 3, 1.5] },
      { type: 'point',       color: 0xff8844,  intensity: 0.60, pos: [0, 1.2, 0.5], distance: 5 },
      { type: 'point',       color: 0xaa44ff,  intensity: 0.22, pos: [-1, 2, -1],   distance: 8 },
    ],

    companion: {
      personalSpaceRadius : 0.10,   // very close OK
      idleAnimHint        : 'breath',
      lookAtEnabled       : false,  // looking at each other
      arousalDecayRate    : 0.001,
      comfortGainRate     : 0.010,
    },
  },

  // The 'adult' pack is NOT defined here.
  // It is registered at runtime via SceneSystem.registerContentPack('adult', def).
  // The definition lives in a separate optional file that is gated and not
  // part of this core module. No explicit adult content is present in any
  // of these core files.
};

// ── SceneSystem class ─────────────────────────────────────────────────────────

export class SceneSystem {
  /**
   * @param {Object} opts
   * @param {THREE.Scene}        opts.scene
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {import('./ReactionPipeline').ReactionPipeline} [opts.pipeline]
   * @param {import('./InteractionZones').InteractionZones} [opts.zones]
   */
  constructor({ scene, renderer, pipeline, zones } = {}) {
    this.scene    = scene;
    this.renderer = renderer;
    this.pipeline = pipeline;
    this.zones    = zones;

    this._packs        = { ...BUILT_IN_PACKS };
    this._activeLights = [];   // THREE.Light instances added by this system
    this._current      = null;
    this._transitioning = false;

    // Sync when CompanionState sceneMode changes
    CompanionState.on('sceneMode', (mode) => this.transition(mode));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Transition to a new scene mode with cross-fade.
   * @param {string} mode  - one of SCENE_MODES
   */
  async transition(mode) {
    if (!SCENE_MODES.includes(mode)) {
      console.warn(`[SceneSystem] Unknown mode: "${mode}"`);
      return;
    }

    const pack = this._packs[mode];
    if (!pack) {
      console.warn(`[SceneSystem] Pack not registered: "${mode}"`);
      CompanionState.set('sceneMode', this._current?.id ?? 'casual');
      return;
    }

    if (pack.locked) {
      console.warn(`[SceneSystem] Pack "${mode}" is locked.`);
      return;
    }

    if (this._current?.id === mode) return;

    console.log(`[SceneSystem] Transitioning to "${mode}"`);
    this._transitioning = true;

    await this._crossfade(pack);
    this._current = pack;
    this._transitioning = false;

    // Update zone access for gated content
    this.zones?.refreshAccess?.();

    // Notify pipeline for ambient speech
    this.pipeline?._onSceneModeChange?.(mode);
  }

  /**
   * Register an optional content pack (e.g. adult pack from external file).
   * @param {string} id   - 'adult' or any custom id
   * @param {Object} def  - same shape as BUILT_IN_PACKS entries
   */
  registerContentPack(id, def) {
    if (!def?.env || !def?.lights) {
      console.error('[SceneSystem] Content pack missing env or lights.');
      return;
    }
    this._packs[id] = { ...def, id, locked: false };
    this.pipeline?.registerContentPack?.(id, this._packs[id]);
    console.log(`[SceneSystem] Content pack "${id}" registered.`);
  }

  /**
   * Lock/unlock a content pack (e.g. after age verification or purchase).
   */
  setPackLocked(id, locked) {
    if (this._packs[id]) this._packs[id].locked = locked;
    if (!locked && id === 'adult') CompanionState.set('adultPackUnlocked', true);
    if (locked  && id === 'adult') CompanionState.set('adultPackUnlocked', false);
  }

  /** Get current companion behaviour params for the active scene. */
  getCompanionParams() {
    return this._current?.companion ?? BUILT_IN_PACKS.casual.companion;
  }

  /** Initialise — call once after construction to apply the initial scene. */
  async init(initialMode = 'casual') {
    await this.transition(initialMode);
  }

  // ── Private: lighting ─────────────────────────────────────────────────────

  async _crossfade(pack) {
    // Remove previous managed lights
    this._activeLights.forEach(l => this.scene.remove(l));
    this._activeLights = [];

    // Environment
    const env = pack.env;
    this.scene.background = new THREE.Color(env.background);
    this.scene.fog        = new THREE.FogExp2(env.fogColor, env.fogDensity);

    // Add new lights
    pack.lights.forEach(def => {
      const light = this._makeLight(def);
      if (light) {
        this.scene.add(light);
        this._activeLights.push(light);
      }
    });

    // Simple tween: fade renderer tone mapping exposure
    const target = pack.env.exposure ?? 1.05;
    await this._tweenExposure(this.renderer.toneMappingExposure, target, 1200);
  }

  _makeLight(def) {
    let light;
    switch (def.type) {
      case 'ambient':
        light = new THREE.AmbientLight(def.color, def.intensity);
        break;
      case 'directional':
        light = new THREE.DirectionalLight(def.color, def.intensity);
        if (def.pos) light.position.set(...def.pos);
        light.castShadow = false;
        break;
      case 'point':
        light = new THREE.PointLight(def.color, def.intensity, def.distance ?? 10);
        if (def.pos) light.position.set(...def.pos);
        break;
      case 'spot':
        light = new THREE.SpotLight(def.color, def.intensity, def.distance ?? 10, def.angle ?? 0.4);
        if (def.pos) light.position.set(...def.pos);
        break;
      default:
        console.warn(`[SceneSystem] Unknown light type: "${def.type}"`);
        return null;
    }
    return light;
  }

  _tweenExposure(from, to, durationMs) {
    return new Promise(resolve => {
      const start = performance.now();
      const tick  = (now) => {
        const t = Math.min(1, (now - start) / durationMs);
        this.renderer.toneMappingExposure = from + (to - from) * this._easeInOut(t);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  _easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
}

// ── Content Pack template (for external adult-pack file) ───────────────────
/**
 * ADULT CONTENT PACK TEMPLATE
 * ───────────────────────────
 * Create a separate file (e.g. adult_content_pack.js) with this structure
 * and import it only after age verification / purchase unlock.
 * This core file contains NO adult content.
 *
 * Example:
 *
 *   export const ADULT_PACK = {
 *     label    : { de: 'Erwachsen', en: 'Adult' },
 *     env: {
 *       background : 0x020008,
 *       fogColor   : 0x020008,
 *       fogDensity : 0.025,
 *       exposure   : 0.90,
 *     },
 *     lights: [
 *       { type: 'ambient',     color: 0xfff0e8, intensity: 0.22 },
 *       { type: 'point',       color: 0xff6699, intensity: 0.80, pos: [0, 1.5, 0.3], distance: 5 },
 *       { type: 'point',       color: 0x9933ff, intensity: 0.30, pos: [-1, 2, -1],   distance: 7 },
 *     ],
 *     companion: {
 *       personalSpaceRadius : 0.05,
 *       idleAnimHint        : 'breath',
 *       lookAtEnabled       : false,
 *       arousalDecayRate    : 0.0005,
 *       comfortGainRate     : 0.012,
 *     },
 *   };
 *
 * Registration (in main app after unlock):
 *   import { ADULT_PACK } from './adult_content_pack.js';
 *   sceneSystem.registerContentPack('adult', ADULT_PACK);
 *   sceneSystem.setPackLocked('adult', false);
 *   CompanionState.set('adultPackUnlocked', true);
 *   sceneSystem.transition('adult');
 */
