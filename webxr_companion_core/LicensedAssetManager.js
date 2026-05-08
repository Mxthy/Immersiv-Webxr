import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export class LicensedAssetManager {
  constructor({
    scene,
    renderer,
    manifestUrl = './assets/asset_manifest.json',
    autoEnvironment = true,
    lang = 'de',
  } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.manifestUrl = manifestUrl;
    this.autoEnvironment = autoEnvironment;
    this.lang = lang;

    this.manifest = null;
    this.audioContext = null;
    this.buffers = new Map();
    this.environmentTexture = null;
    this.ready = false;
    this.errors = [];
  }

  async init() {
    try {
      const res = await fetch(this.manifestUrl);
      if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
      this.manifest = await res.json();
      if (this.autoEnvironment) await this.applyEnvironment();
      this.ready = true;
      console.log('[LicensedAssets] Ready:', this.getStatus());
    } catch (err) {
      this.errors.push(String(err?.message || err));
      console.warn('[LicensedAssets] Init failed:', err);
    }
    return this;
  }

  getStatus() {
    return {
      ready: this.ready,
      environment: this.manifest?.environment?.id || null,
      sounds: Object.keys(this.manifest?.sounds || {}),
      loadedSounds: [...this.buffers.keys()],
      errors: [...this.errors],
    };
  }

  async applyEnvironment() {
    const env = this.manifest?.environment;
    if (!env?.path || !this.scene) return false;

    return await new Promise((resolve) => {
      new RGBELoader().load(
        env.path,
        (texture) => {
          texture.mapping = THREE.EquirectangularReflectionMapping;
          this.environmentTexture = texture;
          this.scene.environment = texture;
          if (env.background) this.scene.background = texture;
          if (this.renderer) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = env.intensity ?? 0.85;
          }
          console.log('[LicensedAssets] HDRI applied:', env.id);
          resolve(true);
        },
        undefined,
        (err) => {
          this.errors.push(`HDRI load failed: ${err?.message || err}`);
          console.warn('[LicensedAssets] HDRI load failed:', err);
          resolve(false);
        },
      );
    });
  }

  async unlockAudio() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        this.errors.push('Web Audio API unavailable');
        return false;
      }
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    return true;
  }

  async loadSound(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    const def = this.manifest?.sounds?.[id];
    if (!def?.path) return null;
    await this.unlockAudio();
    const res = await fetch(def.path);
    if (!res.ok) throw new Error(`Sound ${id} HTTP ${res.status}`);
    const arr = await res.arrayBuffer();
    const buffer = await this.audioContext.decodeAudioData(arr);
    this.buffers.set(id, buffer);
    return buffer;
  }

  async play(id, volumeOverride = null) {
    try {
      const def = this.manifest?.sounds?.[id];
      const buffer = await this.loadSound(id);
      if (!buffer || !this.audioContext) return false;

      const src = this.audioContext.createBufferSource();
      const gain = this.audioContext.createGain();
      gain.gain.value = volumeOverride ?? def?.volume ?? 0.25;
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(this.audioContext.destination);
      src.start();
      return true;
    } catch (err) {
      this.errors.push(`Sound ${id} failed: ${err?.message || err}`);
      console.warn('[LicensedAssets] Sound failed:', id, err);
      return false;
    }
  }

  attachToCompanionCore(core) {
    if (!core) return;
    core.assets = this;

    const originalSetScene = core.setScene?.bind(core);
    if (originalSetScene) {
      core.setScene = (...args) => {
        const result = originalSetScene(...args);
        this.play('sceneShift');
        return result;
      };
    }

    const originalZoneEnter = core.pipeline?.handleZoneEnter?.bind(core.pipeline);
    if (originalZoneEnter) {
      core.pipeline.handleZoneEnter = (event) => {
        const result = originalZoneEnter(event);
        const zone = event?.zone || event?.def?.id || '';
        const intense = ['breast', 'groin', 'butt', 'hips'].includes(zone);
        this.play(intense ? 'zoneIntense' : 'zoneSoft');
        return result;
      };
    }
  }
}
