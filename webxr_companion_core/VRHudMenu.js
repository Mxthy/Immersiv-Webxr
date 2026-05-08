/**
 * VRHudMenu.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Controller-first WebXR HUD layer:
 *   - radial quick menu for scene/actions
 *   - settings HUD for distance, haptics, zone debug, intensity and voice
 *   - desktop fallback through the same 3D panels
 *
 * This does not replace VRFloatingUI. It complements it:
 *   - VRFloatingUI = status/speech/details panel
 *   - VRHudMenu    = fast controller menu + runtime settings
 */

import * as THREE from 'three';
import { CompanionState } from './CompanionState.js';

const RADIAL_SIZE = 640;
const SETTINGS_W = 620;
const SETTINGS_H = 420;

const RADIAL_WORLD = 0.56;
const SETTINGS_WORLD_W = 0.62;
const SETTINGS_WORLD_H = SETTINGS_WORLD_W * (SETTINGS_H / SETTINGS_W);

const DEFAULT_SETTINGS = Object.freeze({
  uiDistance: 0.78,
  hapticsEnabled: true,
  zoneDebug: false,
  interactionIntensity: 1.0,
  voiceEnabled: true,
  followMode: false,
});

export class VRHudMenu {
  constructor({ scene, renderer, camera, core = null, visible = false } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.core = core;
    this.visible = visible;

    this.settings = { ...DEFAULT_SETTINGS };
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._hover = null;
    this._dirty = true;
    this._settingsDirty = true;

    this._buildRadial();
    this._buildSettings();
    this._bindInputs();
    this.applySettings();
  }

  setCore(core) {
    this.core = core;
    this.applySettings();
  }

  showRadial() {
    this.visible = true;
    this._radialGroup.visible = true;
    this._settingsGroup.visible = false;
    this._placeInFrontOfCamera();
    this._dirty = true;
  }

  hideRadial() {
    this.visible = false;
    this._radialGroup.visible = false;
  }

  toggleRadial() {
    this._radialGroup.visible ? this.hideRadial() : this.showRadial();
  }

  showSettings() {
    this._settingsGroup.visible = true;
    this._radialGroup.visible = false;
    this._placeInFrontOfCamera(this._settingsGroup, -0.04);
    this._settingsDirty = true;
  }

  hideSettings() {
    this._settingsGroup.visible = false;
  }

  toggleSettings() {
    this._settingsGroup.visible ? this.hideSettings() : this.showSettings();
  }

  update(dt, frame) {
    if (this._radialGroup.visible) {
      this._radialGroup.lookAt(this.camera.position);
      if (this._dirty) this._paintRadial();
    }
    if (this._settingsGroup.visible) {
      this._settingsGroup.lookAt(this.camera.position);
      if (this._settingsDirty) this._paintSettings();
    }
    if (frame) this._testControllerRays();
  }

  applySettings() {
    if (this.core?.pipeline) {
      this.core.pipeline.hapticsEnabled = !!this.settings.hapticsEnabled;
      this.core.pipeline.stateDeltaScale = this.settings.interactionIntensity;
      this.core.pipeline.ttsEnabled = !!this.settings.voiceEnabled;
    }
    this.core?.zones?.setDebugVisible?.(!!this.settings.zoneDebug);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _buildRadial() {
    this._radialCanvas = document.createElement('canvas');
    this._radialCanvas.width = RADIAL_SIZE;
    this._radialCanvas.height = RADIAL_SIZE;
    this._radialCtx = this._radialCanvas.getContext('2d');
    this._radialTex = new THREE.CanvasTexture(this._radialCanvas);

    const geo = new THREE.PlaneGeometry(RADIAL_WORLD, RADIAL_WORLD);
    const mat = new THREE.MeshBasicMaterial({
      map: this._radialTex,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this._radialPlane = new THREE.Mesh(geo, mat);
    this._radialGroup = new THREE.Group();
    this._radialGroup.add(this._radialPlane);
    this._radialGroup.visible = this.visible;
    this.scene.add(this._radialGroup);

    this._radialActions = [
      { id: 'casual',   label: 'Casual',   action: () => this.core?.setScene?.('casual') },
      { id: 'flirt',    label: 'Flirt',    action: () => this.core?.setScene?.('flirt') },
      { id: 'cuddle',   label: 'Cuddle',   action: () => this.core?.setScene?.('cuddle') },
      { id: 'private',  label: 'Private',  action: () => window.AdultGate?.enterAdultScene?.() },
      { id: 'panel',    label: 'Panel',    action: () => this.core?.toggleUI?.() },
      { id: 'settings', label: 'Settings', action: () => this.showSettings() },
      { id: 'follow',   label: 'Follow',   action: () => this._toggleFollow() },
      { id: 'hide',     label: 'Hide',     action: () => this.hideRadial() },
    ];
  }

  _buildSettings() {
    this._settingsCanvas = document.createElement('canvas');
    this._settingsCanvas.width = SETTINGS_W;
    this._settingsCanvas.height = SETTINGS_H;
    this._settingsCtx = this._settingsCanvas.getContext('2d');
    this._settingsTex = new THREE.CanvasTexture(this._settingsCanvas);

    const geo = new THREE.PlaneGeometry(SETTINGS_WORLD_W, SETTINGS_WORLD_H);
    const mat = new THREE.MeshBasicMaterial({
      map: this._settingsTex,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this._settingsPlane = new THREE.Mesh(geo, mat);
    this._settingsGroup = new THREE.Group();
    this._settingsGroup.add(this._settingsPlane);
    this._settingsGroup.visible = false;
    this.scene.add(this._settingsGroup);

    this._settingsButtons = [];
  }

  _bindInputs() {
    window.addEventListener('click', (e) => this._onPointerClick(e));
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        this.toggleRadial();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        this.toggleSettings();
      }
    });
  }

  bindXRControllers() {
    [0, 1].forEach((i) => {
      const ctrl = this.renderer.xr.getController(i);
      if (!ctrl || ctrl.userData?.vrHudBound) return;
      ctrl.userData.vrHudBound = true;
      ctrl.addEventListener('select', () => this._onControllerSelect(i));
    });
  }

  // ── Paint ──────────────────────────────────────────────────────────────────

  _paintRadial() {
    const ctx = this._radialCtx;
    const W = RADIAL_SIZE;
    const C = W / 2;
    const s = CompanionState.snapshot();

    ctx.clearRect(0, 0, W, W);
    this._circle(ctx, C, C, 290, 'rgba(8,5,20,0.84)', 'rgba(168,85,247,0.36)', 4);
    this._circle(ctx, C, C, 88, 'rgba(18,12,38,0.94)', 'rgba(244,114,182,0.42)', 3);

    ctx.fillStyle = '#f5d0fe';
    ctx.font = 'bold 24px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HUD', C, C - 10);
    ctx.font = '15px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText(s.sceneMode || 'casual', C, C + 18);

    const enabledAdult = !!s.adultPackUnlocked;
    this._radialHit = [];
    const count = this._radialActions.length;
    this._radialActions.forEach((item, idx) => {
      const angle = -Math.PI / 2 + idx * (Math.PI * 2 / count);
      const x = C + Math.cos(angle) * 205;
      const y = C + Math.sin(angle) * 205;
      const disabled = item.id === 'private' && !enabledAdult;
      const active = item.id === s.sceneMode || (item.id === 'follow' && this.settings.followMode);
      const hover = this._hover?.panel === 'radial' && this._hover?.id === item.id;

      this._pill(ctx, x - 62, y - 25, 124, 50,
        disabled ? 'rgba(64,48,72,0.38)' :
        active ? 'rgba(236,72,153,0.54)' :
        hover ? 'rgba(168,85,247,0.52)' :
        'rgba(255,255,255,0.08)',
        disabled ? 'rgba(120,113,108,0.22)' :
        active ? 'rgba(244,114,182,0.88)' :
        'rgba(255,255,255,0.18)'
      );

      ctx.fillStyle = disabled ? '#78716c' : '#f8fafc';
      ctx.font = 'bold 16px system-ui, Segoe UI, sans-serif';
      ctx.fillText(item.label, x, y + 5);
      this._radialHit.push({ ...item, x: x - 62, y: y - 25, w: 124, h: 50, disabled });
    });

    ctx.fillStyle = '#a1a1aa';
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.fillText('Left squeeze: menu · Right squeeze: settings', C, W - 32);

    this._radialTex.needsUpdate = true;
    this._dirty = false;
  }

  _paintSettings() {
    const ctx = this._settingsCtx;
    const W = SETTINGS_W;
    const H = SETTINGS_H;
    ctx.clearRect(0, 0, W, H);
    this._pill(ctx, 0, 0, W, H, 'rgba(8,5,20,0.90)', 'rgba(168,85,247,0.38)', 18);

    ctx.fillStyle = '#f5d0fe';
    ctx.font = 'bold 24px system-ui, Segoe UI, sans-serif';
    ctx.fillText('VR Settings HUD', 24, 38);
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText('Controller ray + select. Ctrl+Shift+S on desktop.', 24, 62);

    this._settingsButtons = [];
    const rows = [
      { key: 'uiDistance', label: 'HUD distance', value: `${this.settings.uiDistance.toFixed(2)}m`, minus: -0.08, plus: 0.08 },
      { key: 'interactionIntensity', label: 'Interaction intensity', value: `${this.settings.interactionIntensity.toFixed(1)}x`, minus: -0.1, plus: 0.1 },
      { key: 'hapticsEnabled', label: 'Haptics', value: this.settings.hapticsEnabled ? 'on' : 'off', toggle: true },
      { key: 'voiceEnabled', label: 'TTS / voice', value: this.settings.voiceEnabled ? 'on' : 'off', toggle: true },
      { key: 'zoneDebug', label: 'Zone debug spheres', value: this.settings.zoneDebug ? 'on' : 'off', toggle: true },
      { key: 'followMode', label: 'Follow mode flag', value: this.settings.followMode ? 'on' : 'off', toggle: true },
    ];

    rows.forEach((row, i) => {
      const y = 92 + i * 46;
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 15px system-ui, Segoe UI, sans-serif';
      ctx.fillText(row.label, 28, y + 18);
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '13px ui-monospace, Menlo, monospace';
      ctx.fillText(row.value, 278, y + 18);

      if (row.toggle) {
        this._button(ctx, 'Toggle', 440, y - 3, 126, 31, () => {
          this.settings[row.key] = !this.settings[row.key];
          this._onSettingChanged();
        });
      } else {
        this._button(ctx, '−', 410, y - 3, 46, 31, () => {
          this._adjust(row.key, row.minus);
        });
        this._button(ctx, '+', 465, y - 3, 46, 31, () => {
          this._adjust(row.key, row.plus);
        });
        this._button(ctx, 'Apply', 520, y - 3, 70, 31, () => this._onSettingChanged());
      }
    });

    this._button(ctx, 'Back', 28, H - 54, 112, 34, () => this.showRadial());
    this._button(ctx, 'Panel', 156, H - 54, 112, 34, () => this.core?.toggleUI?.());
    this._button(ctx, 'Close', W - 140, H - 54, 112, 34, () => this.hideSettings());

    this._settingsTex.needsUpdate = true;
    this._settingsDirty = false;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  _testControllerRays() {
    [0, 1].forEach((i) => {
      const ctrl = this.renderer.xr.getController(i);
      if (!ctrl) return;
      const mat = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(mat).normalize();
      const pos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.set(pos, dir);
      const meshes = [];
      if (this._radialGroup.visible) meshes.push(this._radialPlane);
      if (this._settingsGroup.visible) meshes.push(this._settingsPlane);
      const hits = this._raycaster.intersectObjects(meshes);
      if (!hits.length) return;
      this._lastControllerHit = this._hitToCanvas(hits[0]);
      this._updateHover(this._lastControllerHit);
    });
  }

  _onControllerSelect() {
    if (!this._lastControllerHit) return;
    this._dispatchHit(this._lastControllerHit);
    this._lastControllerHit = null;
  }

  _onPointerClick(e) {
    this._pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const meshes = [];
    if (this._radialGroup.visible) meshes.push(this._radialPlane);
    if (this._settingsGroup.visible) meshes.push(this._settingsPlane);
    const hits = this._raycaster.intersectObjects(meshes);
    if (!hits.length) return;
    this._dispatchHit(this._hitToCanvas(hits[0]));
  }

  _hitToCanvas(hit) {
    const uv = hit.uv;
    if (!uv) return null;
    if (hit.object === this._radialPlane) {
      return { panel: 'radial', x: uv.x * RADIAL_SIZE, y: (1 - uv.y) * RADIAL_SIZE };
    }
    return { panel: 'settings', x: uv.x * SETTINGS_W, y: (1 - uv.y) * SETTINGS_H };
  }

  _dispatchHit(hit) {
    if (!hit) return;
    if (hit.panel === 'radial') {
      const btn = this._radialHit?.find(b => this._in(hit, b));
      if (btn && !btn.disabled) {
        this.core?.assets?.play?.('uiConfirm');
        btn.action?.();
        this._dirty = true;
      } else if (btn?.disabled) {
        this.core?.say?.('Private mode is locked.', false);
      }
    } else {
      const btn = this._settingsButtons?.find(b => this._in(hit, b));
      if (btn) {
        this.core?.assets?.play?.('uiConfirm');
        btn.action?.();
      }
    }
  }

  _updateHover(hit) {
    if (!hit) return;
    const prev = this._hover?.id;
    if (hit.panel === 'radial') {
      const btn = this._radialHit?.find(b => this._in(hit, b));
      this._hover = btn ? { panel: 'radial', id: btn.id } : null;
      if (prev !== this._hover?.id) this._dirty = true;
    }
  }

  // ── Actions/settings ───────────────────────────────────────────────────────

  _toggleFollow() {
    this.settings.followMode = !this.settings.followMode;
    this.core?.say?.(this.settings.followMode ? 'Follow mode marked on.' : 'Follow mode marked off.', false);
    this._dirty = true;
    this._settingsDirty = true;
  }

  _adjust(key, delta) {
    if (key === 'uiDistance') {
      this.settings.uiDistance = Math.min(1.30, Math.max(0.42, this.settings.uiDistance + delta));
    } else if (key === 'interactionIntensity') {
      this.settings.interactionIntensity = Math.min(1.8, Math.max(0.3, this.settings.interactionIntensity + delta));
    }
    this._onSettingChanged();
  }

  _onSettingChanged() {
    this.applySettings();
    this._placeInFrontOfCamera(this._settingsGroup, -0.04);
    this._dirty = true;
    this._settingsDirty = true;
  }

  _placeInFrontOfCamera(group = this._radialGroup, yOffset = 0) {
    if (!group || !this.camera) return;
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(pos);
    this.camera.getWorldDirection(dir);
    group.position.copy(pos).add(dir.multiplyScalar(this.settings.uiDistance));
    group.position.y += yOffset;
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────

  _button(ctx, label, x, y, w, h, action) {
    this._pill(ctx, x, y, w, h, 'rgba(168,85,247,0.20)', 'rgba(255,255,255,0.18)', 8);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 5);
    ctx.textAlign = 'left';
    this._settingsButtons.push({ x, y, w, h, action });
  }

  _pill(ctx, x, y, w, h, fill, stroke, r = 12) {
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
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  _circle(ctx, x, y, r, fill, stroke, lineWidth = 2) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }

  _in(p, b) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }
}
