/**
 * VRFloatingUI.js
 * ─────────────────────────────────────────────────────────────────────────────
 * World-space floating panel rendered as a Three.js CanvasTexture on a plane.
 * Works in flat (desktop) and WebXR immersive-vr / immersive-ar modes.
 * Replaces the Unity VRKeyboard/WorldCanvas approach with a pure WebXR solution.
 *
 * Features:
 *  - Companion stat display (trust / affection / comfort / arousal bars)
 *  - Relationship stage + mood badge
 *  - Scene mode selector (Casual / Flirt / Cuddle / Adult*)
 *  - Speech bubble with the last NPC line
 *  - QWERTY keyboard panel for text input (pointer/ray interaction)
 *  - Billboard: panel always faces the XR camera
 *  - Controller ray-casting for button interaction in VR
 *
 * Usage:
 *   import { VRFloatingUI } from './webxr_companion_core/VRFloatingUI.js';
 *   const ui = new VRFloatingUI({ scene, renderer, camera, state });
 *   // In render loop:
 *   ui.update(dt, xrFrame);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { CompanionState } from './CompanionState.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_W   = 512;   // canvas px
const PANEL_H   = 320;   // canvas px
const WORLD_W   = 0.40;  // metres wide  (1m ≈ 512px → 0.40m ≈ 205px)
const WORLD_H   = WORLD_W * (PANEL_H / PANEL_W);

const KB_W      = 600;
const KB_H      = 260;
const KB_WORLD_W = 0.48;
const KB_WORLD_H = KB_WORLD_W * (KB_H / KB_W);

// Stat-bar colours
const BAR_COLORS = {
  trust     : '#a78bfa',
  affection : '#f472b6',
  comfort   : '#34d399',
  arousal   : '#fb923c',
};

// ── VRFloatingUI ──────────────────────────────────────────────────────────────

export class VRFloatingUI {
  /**
   * @param {Object} opts
   * @param {THREE.Scene}          opts.scene
   * @param {THREE.WebGLRenderer}  opts.renderer
   * @param {THREE.Camera}         opts.camera
   * @param {boolean}              [opts.visible]
   */
  constructor({ scene, renderer, camera, visible = false }) {
    this.scene    = scene;
    this.renderer = renderer;
    this.camera   = camera;
    this.visible  = visible;

    this._speechText  = '...';
    this._inputBuffer = '';
    this._inputActive = false;
    this._onInputConfirm = null;

    // Raycaster for pointer/controller interaction
    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2();
    this._tmpPos = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._boundKeyDown = (e) => this._onKeyDown(e);
    this._boundPointerClick = (e) => this._onPointerClick(e);
    this._controllerSelectHandlers = [];

    this._buildMainPanel();
    this._buildKeyboardPanel();
    this._buildControllerRays();

    // State subscriptions → repaint
    this._unsubscribeState = CompanionState.onAny(() => this._dirty = true);

    // Keyboard events (desktop fallback)
    window.addEventListener('keydown', this._boundKeyDown);
    // Mouse click (desktop)
    window.addEventListener('click', this._boundPointerClick);
    // XR select
    [0, 1].forEach(i => {
      const handler = () => this._onControllerSelect(i);
      this._controllerSelectHandlers[i] = handler;
      this.renderer.xr.getController(i).addEventListener('select', handler);
    });

    this._dirty = true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  show() { this.visible = true;  this._group.visible = true;  }
  hide() { this.visible = false; this._group.visible = false; }
  toggle() { this.visible ? this.hide() : this.show(); }

  /**
   * Called by CompanionCore after XR session starts.
   * Ensures controller ray lines are properly attached to the live XR controllers.
   */
  activateControllerRays() {
    [0, 1].forEach((i) => {
      const ctrl = this.renderer.xr.getController(i);
      const ray  = this._ctrlRays?.[i];
      if (!ctrl || !ray) return;
      // Re-parent to controller if not already attached
      if (!ctrl.children.includes(ray)) {
        ctrl.add(ray);
      }
    });
  }

  /** Set speech bubble text and trigger repaint. */
  setSpeech(text) {
    this._speechText = text;
    this._dirty = true;
  }

  /** Open the VR keyboard for text input. */
  openKeyboard(promptText, onConfirm) {
    this._inputBuffer    = '';
    this._inputActive    = true;
    this._onInputConfirm = onConfirm;
    this._kbGroup.visible = true;
    this._kbDirty = true;
  }

  closeKeyboard() {
    this._inputActive = false;
    this._kbGroup.visible = false;
  }

  /**
   * Call every frame from the render loop.
   * @param {number}  dt
   * @param {XRFrame} [frame]
   */
  update(dt, frame) {
    // Billboard: face camera
    if (this._group.visible) {
      this._followCamera(this._group, 0.30, -0.18, 0.55);
      this._group.lookAt(this.camera.position);
    }
    if (this._kbGroup.visible) {
      this._followCamera(this._kbGroup, 0.00, -0.42, 0.55);
      this._kbGroup.lookAt(this.camera.position);
    }

    // Repaint when dirty
    if (this._dirty) {
      this._paintMainPanel();
      this._dirty = false;
    }
    if (this._kbDirty) {
      this._paintKeyboard();
      this._kbDirty = false;
    }

    // Controller ray-hit test
    if (frame) this._testControllerRays();
  }


  _followCamera(group, xOffset, yOffset, zDistance) {
    if (!group || !this.camera) return;
    const pos = this._followPos || (this._followPos = new THREE.Vector3());
    const dir = this._followDir || (this._followDir = new THREE.Vector3());
    const right = this._followRight || (this._followRight = new THREE.Vector3());
    this.camera.getWorldPosition(pos);
    this.camera.getWorldDirection(dir);
    right.crossVectors(dir, this.camera.up).normalize();
    group.position.copy(pos)
      .add(dir.multiplyScalar(zDistance * -1))
      .add(right.multiplyScalar(xOffset));
    group.position.y += yOffset;
  }

  // ── Private: main panel ────────────────────────────────────────────────────

  _buildMainPanel() {
    this._canvas   = document.createElement('canvas');
    this._canvas.width  = PANEL_W;
    this._canvas.height = PANEL_H;
    this._ctx      = this._canvas.getContext('2d');
    this._texture  = new THREE.CanvasTexture(this._canvas);

    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_H);
    const mat = new THREE.MeshBasicMaterial({
      map         : this._texture,
      transparent : true,
      depthTest   : false,
      side        : THREE.DoubleSide,
    });
    this._panel = new THREE.Mesh(geo, mat);

    this._group = new THREE.Group();
    this._group.add(this._panel);
    this._group.position.set(0.30, 1.45, -0.55);
    this._group.visible = this.visible;
    this.scene.add(this._group);
  }

  _paintMainPanel() {
    const ctx = this._ctx;
    const W = PANEL_W, H = PANEL_H;
    const s = CompanionState.snapshot();

    // Background
    ctx.clearRect(0, 0, W, H);
    this._roundRect(ctx, 0, 0, W, H, 18, 'rgba(8,5,20,0.88)', 'rgba(168,85,247,0.35)');

    // Header
    ctx.fillStyle = '#c084fc';
    ctx.font      = 'bold 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Companion', 18, 30);

    // Relationship badge
    const stage = s.relationshipStage.replace('_', ' ');
    ctx.fillStyle = 'rgba(168,85,247,0.25)';
    this._roundRect(ctx, 148, 12, 160, 24, 10, 'rgba(168,85,247,0.25)', 'rgba(168,85,247,0.5)');
    ctx.fillStyle = '#e9d5ff';
    ctx.font      = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(stage, 157, 27);

    // Mood badge
    const moodEmoji = this._moodEmoji(s.mood);
    ctx.font = '18px serif';
    ctx.fillText(moodEmoji, W - 46, 30);

    // Scene mode pills
    const modes = ['casual','flirt','cuddle'];
    if (s.adultPackUnlocked) modes.push('adult');
    modes.forEach((mode, i) => {
      const x = 14 + i * 105;
      const active = s.sceneMode === mode;
      const hover = !!this._sceneModeBtns?.[i]?._hover;
      this._roundRect(ctx, x, 46, 96, 22, 8,
        active ? 'rgba(168,85,247,0.50)' : hover ? 'rgba(168,85,247,0.22)' : 'rgba(255,255,255,0.05)',
        active ? 'rgba(168,85,247,0.80)' : hover ? 'rgba(168,85,247,0.55)' : 'rgba(255,255,255,0.12)'
      );
      ctx.fillStyle = active ? '#fff' : '#888';
      ctx.font      = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mode, x + 48, 60);
      ctx.textAlign = 'left';

      // Store hit area for click detection
      if (!this._sceneModeBtns) this._sceneModeBtns = [];
      this._sceneModeBtns[i] = { mode, x, y: 46, w: 96, h: 22 };
    });

    // Stat bars
    const stats = ['trust','affection','comfort','arousal'];
    stats.forEach((key, i) => {
      const y = 88 + i * 42;
      const val = s[key];

      ctx.fillStyle = '#666';
      ctx.font      = '11px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(key.charAt(0).toUpperCase() + key.slice(1), 14, y + 12);

      // Track bg
      this._roundRect(ctx, 14, y + 18, W - 28, 10, 5, 'rgba(255,255,255,0.07)', null);
      // Fill
      const fillW = Math.max(0, (W - 28) * val);
      if (fillW > 1) {
        this._roundRect(ctx, 14, y + 18, fillW, 10, 5, BAR_COLORS[key], null);
      }
      // Percent
      ctx.fillStyle = '#aaa';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(val * 100) + '%', W - 14, y + 28);
      ctx.textAlign = 'left';
    });

    // Speech bubble
    const bubbleY = 260;
    this._roundRect(ctx, 14, bubbleY, W - 28, 48, 10, 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.10)');
    ctx.fillStyle = '#ccc';
    ctx.font      = 'italic 12px "Segoe UI", system-ui, sans-serif';
    this._wrapText(ctx, this._speechText, 22, bubbleY + 17, W - 44, 16);

    this._texture.needsUpdate = true;
  }

  // ── Private: keyboard panel ────────────────────────────────────────────────

  _buildKeyboardPanel() {
    this._kbCanvas  = document.createElement('canvas');
    this._kbCanvas.width  = KB_W;
    this._kbCanvas.height = KB_H;
    this._kbCtx     = this._kbCanvas.getContext('2d');
    this._kbTexture = new THREE.CanvasTexture(this._kbCanvas);

    const geo = new THREE.PlaneGeometry(KB_WORLD_W, KB_WORLD_H);
    const mat = new THREE.MeshBasicMaterial({
      map         : this._kbTexture,
      transparent : true,
      depthTest   : false,
      side        : THREE.DoubleSide,
    });
    this._kbPlane = new THREE.Mesh(geo, mat);

    this._kbGroup = new THREE.Group();
    this._kbGroup.add(this._kbPlane);
    this._kbGroup.position.set(0, 1.0, -0.55);
    this._kbGroup.visible = false;
    this.scene.add(this._kbGroup);

    // Key hit-areas (normalised [0,1] on canvas)
    this._kbKeys = this._buildKeyLayout();
    this._kbDirty = true;
  }

  _buildKeyLayout() {
    const rows = [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['Z','X','C','V','B','N','M'],
      ['⌫','Space','✓','✕'],
    ];
    const keys = [];
    const rowH  = 46;
    const yOff  = 50;   // below input display
    rows.forEach((row, ri) => {
      const keyW = Math.floor((KB_W - 20) / row.length);
      row.forEach((k, ki) => {
        const x = 10 + ki * keyW;
        const y = yOff + ri * rowH;
        const w = keyW - 4;
        const h = 38;
        keys.push({ label: k, x, y, w, h });
      });
    });
    return keys;
  }

  _paintKeyboard() {
    const ctx = this._kbCtx;
    const W = KB_W, H = KB_H;

    ctx.clearRect(0, 0, W, H);
    this._roundRect(ctx, 0, 0, W, H, 14, 'rgba(8,5,20,0.90)', 'rgba(168,85,247,0.40)');

    // Input display
    this._roundRect(ctx, 10, 8, W - 20, 34, 8, 'rgba(255,255,255,0.06)', 'rgba(168,85,247,0.40)');
    ctx.fillStyle = '#fff';
    ctx.font      = '14px "Segoe UI", monospace';
    ctx.fillText((this._inputBuffer || '') + '|', 18, 30);

    // Keys
    this._kbKeys.forEach(k => {
      const isAction = ['⌫','Space','✓','✕'].includes(k.label);
      const bg = isAction ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.08)';
      this._roundRect(ctx, k.x, k.y, k.w, k.h, 6, bg, 'rgba(255,255,255,0.14)');
      ctx.fillStyle = '#ddd';
      ctx.font      = isAction ? '11px "Segoe UI"' : '13px "Segoe UI"';
      ctx.textAlign = 'center';
      ctx.fillText(k.label, k.x + k.w / 2, k.y + k.h / 2 + 5);
      ctx.textAlign = 'left';
    });

    this._kbTexture.needsUpdate = true;
  }

  // ── Private: controller rays ───────────────────────────────────────────────

  _buildControllerRays() {
    this._ctrlRays = [0, 1].map((i) => {
      const geo  = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1),
      ]);
      // Default invisible; shown only when pointing at a UI panel
      const mat  = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.0 });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 999;
      line.material.depthTest = false;
      // Attach to XR controller object so it follows the controller in world space
      const ctrl = this.renderer.xr.getController(i);
      if (ctrl) ctrl.add(line);
      return line;
    });
    this._lastPanelHover = null;   // { px, py } from last controller hover on main panel
  }

  _testControllerRays() {
    let anyHit = false;
    [0, 1].forEach(i => {
      const ctrl = this.renderer.xr.getController(i);
      if (!ctrl) return;

      // Use controller's own world matrix – valid inside XR frame
      ctrl.updateMatrixWorld(true);
      const wm  = ctrl.matrixWorld;
      const dir = this._tmpDir.set(0, 0, -1).transformDirection(wm).normalize();
      const pos = this._tmpPos.setFromMatrixPosition(wm);

      this._raycaster.set(pos, dir);

      const meshes = [];
      if (this._group.visible)    meshes.push(this._panel);
      if (this._kbGroup.visible)  meshes.push(this._kbPlane);
      if (!meshes.length) return;

      const hits = this._raycaster.intersectObjects(meshes);
      if (hits.length > 0) {
        anyHit = true;
        const hit = hits[0];
        const uv  = hit.uv;
        if (!uv) return;
        // Make ray visible when hitting UI
        if (this._ctrlRays?.[i]) this._ctrlRays[i].material.opacity = 0.65;

        if (hit.object === this._panel) {
          const px = uv.x * PANEL_W;
          const py = (1 - uv.y) * PANEL_H;
          this._lastPanelHover = { px, py };
          this._handlePanelHover(px, py);
        } else if (hit.object === this._kbPlane) {
          this._lastPanelHover = null;
          const px = uv.x * KB_W;
          const py = (1 - uv.y) * KB_H;
          this._lastKbHover = { px, py };
        }
      } else {
        if (this._ctrlRays?.[i]) this._ctrlRays[i].material.opacity = 0.0;
      }
    });
    if (!anyHit) this._lastPanelHover = null;
  }

  _onControllerSelect(handIndex) {
    // Keyboard takes priority when open
    if (this._lastKbHover && this._kbGroup.visible) {
      this._handleKbClick(this._lastKbHover.px, this._lastKbHover.py);
      this._lastKbHover = null;
      return;
    }
    // Main panel: scene-mode pills and other buttons
    if (this._lastPanelHover && this._group.visible) {
      this._handlePanelClick(this._lastPanelHover.px, this._lastPanelHover.py);
      this._lastPanelHover = null;
    }
  }

  // ── Private: interaction handlers ─────────────────────────────────────────

  _handlePanelHover(px, py) {
    if (!this._sceneModeBtns) return;
    // Highlight hovered scene-mode pill and trigger repaint
    let changed = false;
    this._sceneModeBtns.forEach(btn => {
      if (!btn) return;
      const inside = px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h;
      if (inside !== !!btn._hover) { btn._hover = inside; changed = true; }
    });
    if (changed) this._dirty = true;
  }

  _onPointerClick(e) {
    // Desktop: convert mouse to UV via raycaster
    this._pointer.set(
      (e.clientX / window.innerWidth)  * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const meshes = [this._panel];
    if (this._kbGroup.visible) meshes.push(this._kbPlane);
    const hits = this._raycaster.intersectObjects(meshes);
    if (!hits.length) return;

    const hit = hits[0];
    const uv  = hit.uv;
    if (!uv) return;

    if (hit.object === this._panel) {
      const px = uv.x * PANEL_W;
      const py = (1 - uv.y) * PANEL_H;
      this._handlePanelClick(px, py);
    } else if (hit.object === this._kbPlane) {
      const px = uv.x * KB_W;
      const py = (1 - uv.y) * KB_H;
      this._handleKbClick(px, py);
    }
  }

  _handlePanelClick(px, py) {
    if (!this._sceneModeBtns) return;
    this._sceneModeBtns.forEach(btn => {
      if (btn && px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
        if (btn.mode === 'adult' && !CompanionState.get('adultPackUnlocked')) {
          this.setSpeech('Adult Pack nicht freigeschaltet.');
          return;
        }
        CompanionState.set('sceneMode', btn.mode);
        this._dirty = true;
      }
    });
  }

  _handleKbClick(px, py) {
    const key = this._kbKeys.find(k => px >= k.x && px <= k.x + k.w && py >= k.y && py <= k.y + k.h);
    if (!key) return;

    if (key.label === '⌫') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
    } else if (key.label === 'Space') {
      this._inputBuffer += ' ';
    } else if (key.label === '✓') {
      if (this._onInputConfirm) this._onInputConfirm(this._inputBuffer);
      this.closeKeyboard();
      return;
    } else if (key.label === '✕') {
      this.closeKeyboard();
      return;
    } else {
      this._inputBuffer += key.label.toLowerCase();
    }
    this._kbDirty = true;
  }

  _onKeyDown(e) {
    if (!this._inputActive) return;
    if (e.key === 'Backspace') {
      this._inputBuffer = this._inputBuffer.slice(0, -1);
    } else if (e.key === 'Enter') {
      if (this._onInputConfirm) this._onInputConfirm(this._inputBuffer);
      this.closeKeyboard();
      return;
    } else if (e.key === 'Escape') {
      this.closeKeyboard();
      return;
    } else if (e.key.length === 1) {
      this._inputBuffer += e.key;
    }
    this._kbDirty = true;
  }

  // ── Private: canvas helpers ────────────────────────────────────────────────

  _roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  _wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(' ');
    let line  = '';
    let curY  = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, curY);
        line = word;
        curY += lineH;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, curY);
  }

  _moodEmoji(mood) {
    const map = {
      neutral:'😐', happy:'😊', shy:'🙈', playful:'🎉',
      melancholy:'😔', excited:'✨', annoyed:'😤',
      loving:'💕', embarrassed:'😳', surprised:'😲',
    };
    return map[mood] || '😐';
  }
}


VRFloatingUI.prototype.destroy = function destroy() {
  window.removeEventListener('keydown', this._boundKeyDown);
  window.removeEventListener('click', this._boundPointerClick);
  [0, 1].forEach((i) => {
    const ctrl = this.renderer?.xr?.getController?.(i);
    const handler = this._controllerSelectHandlers?.[i];
    if (ctrl && handler) ctrl.removeEventListener('select', handler);
  });
  this._unsubscribeState?.();
  this.scene?.remove?.(this._group);
  this.scene?.remove?.(this._kbGroup);
  this._panel?.geometry?.dispose?.();
  this._panel?.material?.map?.dispose?.();
  this._panel?.material?.dispose?.();
  this._kbPlane?.geometry?.dispose?.();
  this._kbPlane?.material?.map?.dispose?.();
  this._kbPlane?.material?.dispose?.();
  this._ctrlRays?.forEach(ray => { ray?.geometry?.dispose?.(); ray?.material?.dispose?.(); ray?.parent?.remove?.(ray); });
};
