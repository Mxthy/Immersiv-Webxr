/**
 * CompanionCore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Main integration entry point.
 * Wires together all sub-modules and exports a single `CompanionCore` class
 * that you drop into the existing bab82afe2_vr_companion_app.html.
 *
 * INTEGRATION — add this block INSIDE the existing <script type="module">
 * right after the THREE.js / VRM imports, then follow the instructions in
 * the README for the 5 hook points.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUICK-DROP INTEGRATION (copy-paste into existing HTML script module):
 *
 *   import { CompanionCore } from './webxr_companion_core/CompanionCore.js';
 *
 *   // 1. Create once, after renderer / scene / camera are ready:
 *   const CC = new CompanionCore({ scene, renderer, camera });
 *   await CC.init();
 *
 *   // 2. After VRM loads (inside doLoadVRM success callback):
 *   CC.onVRMLoaded(vrm, mixer);
 *
 *   // 3. In the render loop (inside renderer.setAnimationLoop):
 *   CC.update(dt, timestamp);
 *
 *   // 4. On XR session start (inside enterVR success):
 *   CC.onXRSessionStart(session);
 *
 *   // 5. Toggle UI panel with B button / menu button:
 *   CC.toggleUI();
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CompanionState, tickSessionTimer }  from './CompanionState.js';
import { InteractionZones }                   from './InteractionZones.js';
import { VRFloatingUI }                       from './VRFloatingUI.js';
import { VRHudMenu }                          from './VRHudMenu.js';
import { ReactionPipeline }                   from './ReactionPipeline.js';
import { SceneSystem }                        from './SceneSystem.js';
import { SaveSystem }                         from './SaveSystem.js';

export { CompanionState, SaveSystem };   // re-export for convenience

export class CompanionCore {
  /**
   * @param {Object} opts
   * @param {THREE.Scene}          opts.scene
   * @param {THREE.WebGLRenderer}  opts.renderer
   * @param {THREE.Camera}         opts.camera
   * @param {string}               [opts.lang]         - 'de' | 'en'
   * @param {boolean}              [opts.debugZones]   - show zone wireframes
   * @param {boolean}              [opts.showUI]       - show UI panel on start
   */
  constructor({ scene, renderer, camera, lang = 'de', debugZones = false, showUI = false }) {
    this.scene    = scene;
    this.renderer = renderer;
    this.camera   = camera;
    this.lang     = lang;

    // Sub-systems (fully initialised in init() / onVRMLoaded())
    this.state    = CompanionState;
    this.save     = SaveSystem;
    this.floatUI  = null;
    this.hudMenu  = null;
    this.zones    = null;
    this.pipeline = null;
    this.sceneSystem = null;

    this._debugZones    = debugZones;
    this._showUIOnStart = showUI;
    this._xrFrame       = null;
    this._xrRefSpace    = null;
    this._stopAutoSave  = null;
    this._sessionTimer  = null;
    this._xrEndHandler = null;
    this._squeezeHandlers = [];
    this._boundXRSession = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Async init: open SaveSystem DB, restore state, build UI + scene.
   * Call once after scene/renderer/camera are ready.
   */
  async init() {
    // Storage
    await this.save.init();
    this.save.loadCompanionState();
    this._stopAutoSave = this.save.startAutoSave(30_000);

    // Floating UI panel
    this.floatUI = new VRFloatingUI({
      scene    : this.scene,
      renderer : this.renderer,
      camera   : this.camera,
      visible  : this._showUIOnStart,
    });

    this.hudMenu = new VRHudMenu({
      scene    : this.scene,
      renderer : this.renderer,
      camera   : this.camera,
      core     : this,
      visible  : false,
    });

    // Reaction pipeline (VRM not loaded yet — placeholder)
    this.pipeline = new ReactionPipeline({
      vrm       : null,
      mixer     : null,
      renderer  : this.renderer,
      floatingUI: this.floatUI,
      lang      : this.lang,
    });

    // Scene system
    this.sceneSystem = new SceneSystem({
      scene   : this.scene,
      renderer: this.renderer,
      pipeline: this.pipeline,
    });
    await this.sceneSystem.init(CompanionState.get('sceneMode') || 'casual');

    // Session timer
    this._sessionTimer = setInterval(() => {
      tickSessionTimer();
      // Periodically auto-derive mood from stats
      const derivedMood = CompanionState.deriveMood();
      if (derivedMood !== CompanionState.get('mood')) {
        CompanionState.set('mood', derivedMood);
      }
    }, 1000);

    // Controller B/Y button listener for UI toggle (added when session starts)
    console.log('[CompanionCore] Init complete.');
  }

  /**
   * Call inside doLoadVRM() success callback, after VRM is added to scene.
   * @param {import('@pixiv/three-vrm').VRM} vrm
   * @param {THREE.AnimationMixer}           mixer
   */
  onVRMLoaded(vrm, mixer) {
    // Rebuild interaction zones on new VRM
    if (this.zones) {
      // Destroy old debug meshes
      this.zones.rebind(vrm);
    } else {
      this.zones = new InteractionZones({
        vrm          : vrm,
        scene        : this.scene,
        renderer     : this.renderer,
        debugVisible : this._debugZones,
      });

      // Wire zone events → reaction pipeline
      this.zones.on('zoneEnter', (e) => this.pipeline?.handleZoneEnter(e));
      this.zones.on('zoneExit',  (e) => this.pipeline?.handleZoneExit(e));
      this.zones.on('gazeHeld',  (e) => this.pipeline?.handleGazeHeld(e));
    }

    // Update pipeline with new VRM
    this.pipeline?.rebindVRM(vrm, mixer);

    // Attach sceneSystem zones ref for gated access
    this.sceneSystem.zones = this.zones;
    this.hudMenu?.applySettings?.();

    console.log('[CompanionCore] VRM bound.');
  }

  /**
   * Main update — call every frame inside renderer.setAnimationLoop.
   * @param {number} dt          - delta time (seconds)
   * @param {number} timestamp   - ms timestamp
   * @param {XRFrame} [frame]
   */
  update(dt, timestamp, frame = null) {
    if (frame) this._xrFrame = frame;

    // Zone collision
    this.zones?.update(
      dt,
      this._xrFrame,
      this._xrRefSpace,
      this.camera
    );

    // Reaction blending
    this.pipeline?.update(dt, timestamp);

    // UI billboard + repaint
    this.floatUI?.update(dt, this._xrFrame);
    this.hudMenu?.update(dt, this._xrFrame);
  }

  /**
   * Call when a WebXR session starts.
   * @param {XRSession} session
   */
  async onXRSessionStart(session) {
    if (this._boundXRSession === session) return;
    if (this._boundXRSession && this._xrEndHandler) {
      try { this._boundXRSession.removeEventListener('end', this._xrEndHandler); } catch (_) {}
    }
    this._boundXRSession = session;
    this._xrEndHandler = () => {
      this._xrFrame    = null;
      this._xrRefSpace = null;
      this._boundXRSession = null;
    };
    session.addEventListener('end', this._xrEndHandler);

    try {
      this._xrRefSpace = await session.requestReferenceSpace('local-floor');
    } catch (_) {
      this._xrRefSpace = await session.requestReferenceSpace('local').catch(() => null);
    }

    // Map controller squeeze → HUD controls.
    // Left squeeze: radial quick menu. Right squeeze: settings HUD.
    [0, 1].forEach(i => {
      const ctrl = this.renderer.xr.getController(i);
      const prev = this._squeezeHandlers[i];
      if (ctrl && prev) ctrl.removeEventListener('squeezestart', prev);
      const handler = () => {
        if (i === 0) this.toggleHud();
        else this.toggleSettingsHud();
      };
      this._squeezeHandlers[i] = handler;
      ctrl?.addEventListener('squeezestart', handler);
    });
    this.hudMenu?.bindXRControllers?.();
    // Activate VRFloatingUI controller ray helpers now that XR is live
    this.floatUI?.activateControllerRays?.();

    console.log('[CompanionCore] XR session bound.');
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  toggleUI()     { this.floatUI?.toggle(); }
  showUI()       { this.floatUI?.show();   }
  hideUI()       { this.floatUI?.hide();   }
  toggleHud()    { this.hudMenu?.toggleRadial(); }
  showHud()      { this.hudMenu?.showRadial();   }
  hideHud()      { this.hudMenu?.hideRadial();   }
  toggleSettingsHud() { this.hudMenu?.toggleSettings(); }

  /**
   * Set speech bubble text (proxy to pipeline.say).
   * @param {string} text
   * @param {boolean} [speak] - also use TTS
   */
  say(text, speak = true) {
    if (speak) this.pipeline?.say(text);
    else       this.floatUI?.setSpeech(text);
  }

  // ── Content gates ──────────────────────────────────────────────────────────

  /**
   * Unlock the adult content pack.
   * Does NOT load the pack definition — that must be done externally after
   * age verification. This merely sets the state flag.
   */
  unlockAdultPack() {
    CompanionState.set('adultPackUnlocked', true);
    this.zones?.refreshAccess();
    console.log('[CompanionCore] Adult pack unlocked.');
  }

  /**
   * Register an external content pack definition and optionally transition to it.
   * @param {string} id
   * @param {Object} packDefinition
   * @param {boolean} [autoTransition]
   */
  registerContentPack(id, packDefinition, autoTransition = false) {
    this.sceneSystem?.registerContentPack(id, packDefinition);
    if (autoTransition) {
      CompanionState.set('sceneMode', id);
    }
  }

  // ── State API shortcuts ────────────────────────────────────────────────────

  nudgeTrust    (delta) { CompanionState.nudge('trust',     delta); }
  nudgeAffection(delta) { CompanionState.nudge('affection', delta); }
  nudgeComfort  (delta) { CompanionState.nudge('comfort',   delta); }
  nudgeArousal  (delta) { CompanionState.nudge('arousal',   delta); }
  setMood       (mood)  { CompanionState.set('mood', mood);         }
  setScene      (mode)  { CompanionState.set('sceneMode', mode);    }

  // ── Save shortcuts ─────────────────────────────────────────────────────────

  async saveCharacter(name, morphState, modelUrl) {
    return this.save.saveCharacter(name, {
      modelUrl,
      morphState,
      companionSnapshot: CompanionState.snapshot(),
    });
  }

  async listCharacters() { return this.save.listCharacters(); }

  // ── Teardown ───────────────────────────────────────────────────────────────

  destroy() {
    this._stopAutoSave?.();
    clearInterval(this._sessionTimer);
    if (this._boundXRSession && this._xrEndHandler) {
      try { this._boundXRSession.removeEventListener('end', this._xrEndHandler); } catch (_) {}
    }
    [0, 1].forEach((i) => {
      const ctrl = this.renderer?.xr?.getController?.(i);
      const handler = this._squeezeHandlers?.[i];
      if (ctrl && handler) ctrl.removeEventListener('squeezestart', handler);
    });
    this.floatUI?.destroy?.();
    this.hudMenu?.destroy?.();
    this.pipeline?.destroy?.();
    this.zones?.destroy?.();
    this.save.saveCompanionState();
    console.log('[CompanionCore] Destroyed.');
  }
}

