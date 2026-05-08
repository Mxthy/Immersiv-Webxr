/**
 * InteractionZones.js
 * ─────────────────────────────────────────────────────────────────────────────
 * WebXR / three.js / three-vrm port of VRInteractionManager.cs
 *
 * Creates invisible sphere volumes anchored to VRM humanoid bones.
 * Each frame, controller tip positions are tested against those spheres.
 * Emits events: 'zoneEnter', 'zoneExit', 'zoneHeld' for the ReactionPipeline.
 *
 * Usage:
 *   import { InteractionZones } from './webxr_companion_core/InteractionZones.js';
 *   const zones = new InteractionZones({ vrm, scene, renderer, state });
 *   // In render loop:
 *   zones.update(dt, xrFrame, referenceSpace);
 *
 * Depends on:
 *   - three (imported via importmap as 'three')
 *   - CompanionState (../CompanionState.js)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { CompanionState } from './CompanionState.js';

// ── Zone definitions  ─────────────────────────────────────────────────────────
// Maps zone names → VRM humanoid bone name + sphere radius + arousal rate
// Gate: zones with adultGated=true are disabled unless adultPackUnlocked.

export const ZONE_DEFINITIONS = Object.freeze([
  { id: 'head',         bone: 'head',              radius: 0.12, arousalRate: 0.00, adultGated: false },
  { id: 'shoulder_l',   bone: 'leftShoulder',       radius: 0.09, arousalRate: 0.00, adultGated: false },
  { id: 'shoulder_r',   bone: 'rightShoulder',      radius: 0.09, arousalRate: 0.00, adultGated: false },
  { id: 'hand_l',       bone: 'leftHand',           radius: 0.07, arousalRate: 0.00, adultGated: false },
  { id: 'hand_r',       bone: 'rightHand',          radius: 0.07, arousalRate: 0.00, adultGated: false },
  { id: 'chest',        bone: 'chest',              radius: 0.14, arousalRate: 0.02, adultGated: false },
  { id: 'waist',        bone: 'spine',              radius: 0.11, arousalRate: 0.01, adultGated: false },
  { id: 'hips',         bone: 'hips',               radius: 0.13, arousalRate: 0.02, adultGated: false },
  { id: 'upper_leg_l',  bone: 'leftUpperLeg',       radius: 0.09, arousalRate: 0.01, adultGated: false },
  { id: 'upper_leg_r',  bone: 'rightUpperLeg',      radius: 0.09, arousalRate: 0.01, adultGated: false },
  // Adult-gated zones — only active when ContentPack unlocked
  { id: 'breast',       bone: 'chest',              radius: 0.10, arousalRate: 0.08, adultGated: true,  offset: new THREE.Vector3(0, 0.04, 0.08) },
  { id: 'groin',        bone: 'hips',               radius: 0.08, arousalRate: 0.12, adultGated: true,  offset: new THREE.Vector3(0, -0.06, 0.04) },
  { id: 'butt',         bone: 'hips',               radius: 0.10, arousalRate: 0.08, adultGated: true,  offset: new THREE.Vector3(0, 0.02, -0.10) },
]);

// Haptic patterns (duration ms, intensity 0-1)
export const HAPTIC_PATTERNS = Object.freeze({
  gentle  : { duration: 80,  intensity: 0.30 },
  medium  : { duration: 120, intensity: 0.55 },
  strong  : { duration: 200, intensity: 0.85 },
  pulse   : { duration: 40,  intensity: 0.70 },  // repeated 3×
});

// ── InteractionZones class ────────────────────────────────────────────────────

export class InteractionZones {
  /**
   * @param {Object} opts
   * @param {import('@pixiv/three-vrm').VRM} opts.vrm
   * @param {THREE.Scene}    opts.scene
   * @param {THREE.WebGLRenderer} opts.renderer  - for xr.getController
   * @param {boolean}        [opts.debugVisible] - show wireframe spheres
   */
  constructor({ vrm, scene, renderer, debugVisible = false }) {
    this.vrm          = vrm;
    this.scene        = scene;
    this.renderer     = renderer;
    this.debugVisible = debugVisible;

    this._zones        = [];   // runtime zone records
    this._debugMeshes  = [];
    this._listeners    = new Map();   // 'zoneEnter'|'zoneExit'|'zoneHeld' → Set<fn>

    // Track which controllers are inside each zone
    this._controllerPositions = [
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];

    this._gazeTimer     = 0;
    this._gazeThreshold = 2.0;   // seconds for sustained-gaze shy reaction
    this._tmpQuat = new THREE.Quaternion();
    this._tmpOffset = new THREE.Vector3();
    this._eyePos = new THREE.Vector3();
    this._toEye = new THREE.Vector3();
    this._camFwd = new THREE.Vector3();

    this._build();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Main update — call inside renderer.setAnimationLoop or your render fn.
   * @param {number} dt       - delta time in seconds
   * @param {XRFrame} [frame] - current XRFrame (null outside XR session)
   * @param {XRReferenceSpace} [refSpace]
   * @param {THREE.Camera} camera - for gaze detection
   */
  update(dt, frame, refSpace, camera) {
    this._syncControllerPositions(frame, refSpace);
    this._testZones(dt);
    if (camera) this._testGaze(dt, camera);
  }

  /** Re-attach to a new VRM after a model swap. */
  rebind(vrm) {
    this._destroyDebug();
    this.vrm = vrm;
    this._zones = [];
    this._build();
  }

  /** Show / hide debug wireframes. */
  setDebugVisible(v) {
    this.debugVisible = v;
    this._debugMeshes.forEach(m => { m.visible = v; });
  }

  /** Refresh adult-gated zone enable state from CompanionState. */
  refreshAccess() {
    const unlocked = CompanionState.get('adultPackUnlocked');
    this._zones.forEach(z => {
      if (z.def.adultGated) z.enabled = unlocked;
    });
  }

  // ── Event emitter ──────────────────────────────────────────────────────────

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach(fn => {
      try { fn(payload); } catch(e) { console.error('[InteractionZones]', e); }
    });
  }

  // ── Private: build zones ───────────────────────────────────────────────────

  _build() {
    if (!this.vrm?.humanoid) {
      console.warn('[InteractionZones] No VRM humanoid — zones not built.');
      return;
    }
    const h = this.vrm.humanoid;
    const unlocked = CompanionState.get('adultPackUnlocked');

    ZONE_DEFINITIONS.forEach(def => {
      const boneNode = h.getRawBoneNode(def.bone);
      if (!boneNode) return;   // bone not in this VRM

      const zoneObj = {
        def,
        bone      : boneNode,
        enabled   : def.adultGated ? unlocked : true,
        occupied  : false,         // any controller inside right now
        heldFor   : 0,             // continuous hold time
        _worldPos : new THREE.Vector3(),
      };
      this._zones.push(zoneObj);

      if (this.debugVisible) this._addDebugMesh(zoneObj);
    });

    console.log(`[InteractionZones] Built ${this._zones.length} zones on VRM.`);
  }

  // ── Private: update controller world positions ─────────────────────────────

  _syncControllerPositions(frame, refSpace) {
    [0, 1].forEach(i => {
      const ctrl = this.renderer.xr.getController(i);
      if (ctrl) {
        ctrl.getWorldPosition(this._controllerPositions[i]);
      }
    });

    // Also try XRFrame-based hand tracking for more precise tips
    if (frame && refSpace) {
      const session = frame.session;
      const sources = [...(session.inputSources || [])];
      sources.forEach((src, i) => {
        if (i > 1) return;
        if (src.gripSpace) {
          const pose = frame.getPose(src.gripSpace, refSpace);
          if (pose) {
            const p = pose.transform.position;
            this._controllerPositions[i].set(p.x, p.y, p.z);
          }
        }
      });
    }
  }

  // ── Private: sphere-in-sphere intersection test ───────────────────────────

  _testZones(dt) {
    this._zones.forEach(zone => {
      if (!zone.enabled) return;

      // World position of the bone (with optional per-zone offset)
      zone.bone.getWorldPosition(zone._worldPos);
      if (zone.def.offset) {
        const off = this._tmpOffset.copy(zone.def.offset).applyQuaternion(zone.bone.getWorldQuaternion(this._tmpQuat));
        zone._worldPos.add(off);
      }

      const r = zone.def.radius;
      let anyInside = false;

      this._controllerPositions.forEach((cp, hand) => {
        const dist = cp.distanceTo(zone._worldPos);
        if (dist < r) {
          anyInside = true;

          if (!zone.occupied) {
            // ── Zone Enter ──
            zone.occupied = true;
            zone.heldFor  = 0;
            this._onZoneEnter(zone, hand);
          }
        }
      });

      if (zone.occupied && !anyInside) {
        // ── Zone Exit ──
        zone.occupied = false;
        this._onZoneExit(zone);
      }

      if (zone.occupied) {
        zone.heldFor += dt;
        // ── Zone Held (continuous) ──
        if (zone.def.arousalRate > 0) {
          CompanionState.nudge('arousal', zone.def.arousalRate * dt);
          CompanionState.nudge('affection', zone.def.arousalRate * 0.3 * dt);
        }
        this.emit('zoneHeld', { zone: zone.def.id, heldFor: zone.heldFor, dt });
      }
    });

    // Update debug mesh positions
    if (this.debugVisible) {
      this._zones.forEach((zone, i) => {
        const m = this._debugMeshes[i];
        if (m) {
          m.position.copy(zone._worldPos);
          m.material.color.setHex(zone.occupied ? 0xff4488 : 0x8844ff);
        }
      });
    }
  }

  _onZoneEnter(zone, handIndex) {
    console.log(`[InteractionZones] Enter: ${zone.def.id} (hand ${handIndex})`);

    // State nudge on entry
    CompanionState.nudge('affection', 0.02);
    CompanionState.nudge('comfort',   0.01);

    this.emit('zoneEnter', { zone: zone.def.id, hand: handIndex, def: zone.def });

    // Haptics
    this._triggerHaptic(handIndex, HAPTIC_PATTERNS.gentle);
  }

  _onZoneExit(zone) {
    this.emit('zoneExit', { zone: zone.def.id });
    CompanionState.updateRelationshipStage();
  }

  // ── Private: gaze detection (ported from VRInteractionManager.cs) ─────────

  _testGaze(dt, camera) {
    if (!this.vrm?.humanoid) return;
    const head = this.vrm.humanoid.getRawBoneNode('head');
    if (!head) return;

    const eyePos = this._eyePos;
    head.getWorldPosition(eyePos);
    eyePos.y += 0.07;   // approximate eye centre above head bone

    const toEye = this._toEye.subVectors(eyePos, camera.position);
    const dist  = toEye.length();

    if (dist > 3.0) { this._gazeTimer = 0; return; }

    const camFwd = this._camFwd;
    camera.getWorldDirection(camFwd);
    const angle = camFwd.angleTo(toEye.normalize()) * (180 / Math.PI);

    if (angle > 8) { this._gazeTimer = 0; return; }

    this._gazeTimer += dt;
    if (this._gazeTimer >= this._gazeThreshold) {
      this._gazeTimer = 0;
      this.emit('gazeHeld', { seconds: this._gazeThreshold });
      CompanionState.nudge('comfort', -0.04);   // slight discomfort from staring
      CompanionState.nudge('affection', 0.01);
    }
  }

  // ── Private: haptics ───────────────────────────────────────────────────────

  _triggerHaptic(handIndex, pattern) {
    try {
      const session = this.renderer.xr.getSession();
      if (!session) return;
      const sources = [...(session.inputSources || [])];
      const src = sources[handIndex];
      if (src?.gamepad?.hapticActuators?.length) {
        const actuator = src.gamepad.hapticActuators[0];
        if (pattern.pulse) {
          for (let i = 0; i < 3; i++) {
            setTimeout(() => actuator.pulse(pattern.intensity, pattern.duration), i * (pattern.duration + 30));
          }
        } else {
          actuator.pulse(pattern.intensity, pattern.duration);
        }
      }
    } catch (e) {
      // Haptics not available — silent fail
    }
  }

  // ── Private: debug helpers ────────────────────────────────────────────────

  _addDebugMesh(zone) {
    const geo  = new THREE.SphereGeometry(zone.def.radius, 8, 8);
    const mat  = new THREE.MeshBasicMaterial({
      color     : 0x8844ff,
      wireframe : true,
      transparent: true,
      opacity   : 0.45,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = this.debugVisible;
    this.scene.add(mesh);
    this._debugMeshes.push(mesh);
  }

  _destroyDebug() {
    this._debugMeshes.forEach(m => {
      this.scene.remove(m);
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    });
    this._debugMeshes = [];
  }

  destroy() {
    this._destroyDebug();
    this._zones = [];
    this._listeners.clear();
  }

  /**
   * Returns an array describing all currently occupied zones.
   */
  getOccupiedZones() {
    return this._zones.filter(z => z.occupied).map(z => z.def.id);
  }
}
