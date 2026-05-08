/**
 * AdultGateController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Runtime gate for optional private / adult interaction packs.
 *
 * This module intentionally contains no explicit content. It only handles:
 *   - explicit age + consent confirmation
 *   - optional relationship/comfort requirements
 *   - dynamic loading of a separate content-pack module
 *   - registration with SceneSystem
 *   - enabling adult-gated InteractionZones
 *   - small debug/status API for the host app
 */

import { CompanionState } from './CompanionState.js';

const DEFAULT_MIN_STATE = Object.freeze({
  trust     : 0.65,
  affection : 0.50,
  comfort   : 0.55,
});

const ALLOWED_STAGES = Object.freeze([
  'close_friend',
  'romantic_interest',
  'partner',
]);

export class AdultGateController {
  constructor({
    core,
    lang = 'de',
    packUrl = './contentpacks/privateInteractionPack.js',
    minState = DEFAULT_MIN_STATE,
    requireRelationshipGate = true,
  } = {}) {
    this.core = core;
    this.lang = lang;
    this.packUrl = packUrl;
    this.minState = { ...DEFAULT_MIN_STATE, ...(minState || {}) };
    this.requireRelationshipGate = requireRelationshipGate;

    this.packRegistered = false;
    this.lastError = '';
    this.lastStatus = 'locked';
  }

  init() {
    this.lastStatus = CompanionState.get('adultPackUnlocked') ? 'unlocked' : 'locked';
    this.core?.zones?.refreshAccess?.();
    return this;
  }

  setLang(lang) {
    this.lang = lang || this.lang;
  }

  getStatus() {
    const state = CompanionState.snapshot();
    const relationship = this._relationshipCheck(state);
    return {
      unlocked: !!state.adultPackUnlocked,
      registered: this.packRegistered,
      status: this.lastStatus,
      lastError: this.lastError,
      relationshipOk: relationship.ok,
      relationshipReason: relationship.reason,
      minState: { ...this.minState },
      sceneMode: state.sceneMode,
      relationshipStage: state.relationshipStage,
    };
  }

  async requestUnlock({ skipRelationshipGate = false } = {}) {
    this.lastError = '';

    if (!this.core?.sceneSystem) {
      return this._fail('CompanionCore ist noch nicht bereit.');
    }

    if (!this._confirmAgeAndConsent()) {
      return this._fail('Nicht bestätigt.');
    }

    const state = CompanionState.snapshot();
    const rel = this._relationshipCheck(state);
    if (this.requireRelationshipGate && !skipRelationshipGate && !rel.ok) {
      return this._fail(rel.reason);
    }

    try {
      const mod = await import(this.packUrl);
      const pack = mod.privateInteractionPack || mod.adultPackDefinition || mod.default;
      if (!pack) return this._fail('Content-Pack exportiert keine Pack-Definition.');

      this.core.registerContentPack?.('adult', pack, false);
      this.core.sceneSystem?.setPackLocked?.('adult', false);
      this.core.unlockAdultPack?.();
      this.core.zones?.refreshAccess?.();

      this.packRegistered = true;
      this.lastStatus = 'unlocked';
      this.core.say?.(this._t('Privater Modus freigeschaltet.', 'Private mode unlocked.'), false);
      console.log('[AdultGate] Optional private pack unlocked and registered.');
      return true;
    } catch (err) {
      console.warn('[AdultGate] Failed to load optional pack:', err);
      return this._fail('Pack konnte nicht geladen werden: ' + (err?.message || err));
    }
  }

  async enterAdultScene() {
    if (!CompanionState.get('adultPackUnlocked') || !this.packRegistered) {
      const ok = await this.requestUnlock();
      if (!ok) return false;
    }

    CompanionState.set('sceneMode', 'adult');
    this.lastStatus = 'active';
    this.core.say?.(this._t('Privater Szenenmodus aktiv.', 'Private scene mode active.'), false);
    return true;
  }

  lock() {
    this.core?.sceneSystem?.setPackLocked?.('adult', true);
    CompanionState.set({
      adultPackUnlocked: false,
      sceneMode: CompanionState.get('sceneMode') === 'adult' ? 'cuddle' : CompanionState.get('sceneMode'),
    });
    this.core?.zones?.refreshAccess?.();
    this.lastStatus = 'locked';
    this.core?.say?.(this._t('Privater Modus gesperrt.', 'Private mode locked.'), false);
  }

  /**
   * Dev helper for headset QA. It does not bypass age/consent. It only primes
   * relationship values so zone access and scene transitions can be tested.
   */
  primeRelationshipForTesting() {
    CompanionState.set({
      trust: Math.max(CompanionState.get('trust') || 0, this.minState.trust),
      affection: Math.max(CompanionState.get('affection') || 0, this.minState.affection),
      comfort: Math.max(CompanionState.get('comfort') || 0, this.minState.comfort),
      relationshipStage: 'close_friend',
    });
    this.core?.say?.(this._t('Testwerte gesetzt. Gate kann jetzt geprüft werden.', 'Test values set. Gate can now be checked.'), false);
  }

  _relationshipCheck(state) {
    if ((state.trust || 0) < this.minState.trust) {
      return { ok: false, reason: `trust ${state.trust?.toFixed?.(2) ?? 0} < ${this.minState.trust}` };
    }
    if ((state.affection || 0) < this.minState.affection) {
      return { ok: false, reason: `affection ${state.affection?.toFixed?.(2) ?? 0} < ${this.minState.affection}` };
    }
    if ((state.comfort || 0) < this.minState.comfort) {
      return { ok: false, reason: `comfort ${state.comfort?.toFixed?.(2) ?? 0} < ${this.minState.comfort}` };
    }
    if (!ALLOWED_STAGES.includes(state.relationshipStage)) {
      return { ok: false, reason: `stage ${state.relationshipStage} ist noch nicht freigegeben` };
    }
    return { ok: true, reason: 'ok' };
  }

  _confirmAgeAndConsent() {
    const ageText = this._t(
      'Bestätige: Du bist mindestens 18 Jahre alt.',
      'Confirm: You are at least 18 years old.',
    );
    const consentText = this._t(
      'Bestätige: Du möchtest optionale private Interaktionsmodule aktivieren. Du kannst sie jederzeit wieder sperren.',
      'Confirm: You want to enable optional private interaction modules. You can lock them again at any time.',
    );
    return window.confirm(ageText) && window.confirm(consentText);
  }

  _fail(message) {
    this.lastError = message;
    this.lastStatus = 'blocked';
    this.core?.say?.(this._t(`Gate blockiert: ${message}`, `Gate blocked: ${message}`), false);
    console.warn('[AdultGate]', message);
    return false;
  }

  _t(de, en) {
    return this.lang === 'en' ? en : de;
  }
}
