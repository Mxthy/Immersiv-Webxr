/**
 * privateInteractionPack.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Optional neutral private-scene pack. This file is deliberately non-explicit:
 * it only defines lighting and behaviour hints. Replace or extend it with your
 * own age-gated assets/animations later if your target platform allows it.
 */

export const privateInteractionPack = {
  id: 'adult',
  label: {
    de: 'Privat',
    en: 'Private',
  },
  locked: false,

  env: {
    background: 0x05000a,
    fogColor: 0x05000a,
    fogDensity: 0.024,
  },

  lights: [
    { type: 'ambient', color: 0xffd7ea, intensity: 0.22 },
    { type: 'directional', color: 0xffaacd, intensity: 0.55, pos: [0.8, 2.8, 1.8] },
    { type: 'point', color: 0xff5fa8, intensity: 0.72, pos: [0.0, 1.25, 0.55], distance: 5 },
    { type: 'point', color: 0x7c3cff, intensity: 0.28, pos: [-1.0, 1.8, -0.8], distance: 7 },
  ],

  companion: {
    personalSpaceRadius: 0.04,
    idleAnimHint: 'breath',
    lookAtEnabled: false,
    arousalDecayRate: 0.0005,
    comfortGainRate: 0.008,
  },

  /**
   * Extra expression presets merged into ReactionPipeline at registration.
   * Keys must match VRM ExpressionManager names where possible.
   */
  expressionSets: {
    privateSoft: {
      happy: 0.45,
      relaxed: 0.65,
    },
    privateShy: {
      happy: 0.25,
      surprised: 0.30,
      relaxed: 0.20,
    },
    privateBoundary: {
      surprised: 0.45,
      angry: 0.20,
    },
    privateClose: {
      happy: 0.55,
      relaxed: 0.75,
    },
  },

  /**
   * VRMA / AnimationMixer clip-name hints. The pipeline first tries exact clip
   * names, then fuzzy name matching. Use your real VRMA clip names here later.
   */
  animationHints: {
    sceneEnter: ['breath', 'idle_close', 'look_soft'],
    default: ['breath', 'react_soft'],
    head: ['look_soft', 'blink_shy'],
    chest: ['react_soft', 'breathe_deep'],
    waist: ['step_closer', 'breathe_deep'],
    hips: ['shift_weight', 'react_shy'],
    breast: ['private_boundary_soft', 'react_shy'],
    groin: ['private_boundary_clear', 'step_back_small'],
    butt: ['private_boundary_soft', 'shift_weight'],
  },

  sceneEnterLines: {
    de: ['*die Stimmung wird ruhiger*', 'Lass uns langsam und aufmerksam bleiben.'],
    en: ['*the mood settles down*', 'Let’s keep this slow and attentive.'],
  },

  idleLines: {
    neutral: {
      de: ['*atmet ruhig*', 'Sag mir, wenn ich stoppen soll.'],
      en: ['*breathes calmly*', 'Tell me if I should stop.'],
    },
    loving: {
      de: ['*bleibt nah bei dir*', 'So ist es angenehm.'],
      en: ['*stays close to you*', 'This feels comfortable.'],
    },
    shy: {
      de: ['*schaut kurz weg*', 'Bitte langsam.'],
      en: ['*looks away briefly*', 'Please, slowly.'],
    },
  },

  /**
   * Zone-specific reaction map. This remains deliberately non-explicit and
   * consent-oriented. It lets you replace lines, animations, expressions and
   * balancing without editing ReactionPipeline.js.
   */
  zoneReactions: {
    default: {
      expression: 'privateSoft',
      expressionIntensity: 0.75,
      holdSeconds: 2.0,
      animation: 'react_soft',
      haptic: { durationMs: 70, intensity: 0.32 },
      lines: {
        de: ['*reagiert leise*'],
        en: ['*responds quietly*'],
      },
      stateDelta: { affection: 0.006, comfort: 0.004 },
    },

    head: {
      expression: 'privateSoft',
      animation: 'look_soft',
      haptic: { durationMs: 60, intensity: 0.24 },
      lines: {
        de: ['*entspannt sich etwas*', 'Das ist sanft.'],
        en: ['*relaxes a little*', 'That is gentle.'],
      },
      stateDelta: { trust: 0.006, affection: 0.004, comfort: 0.006 },
    },

    chest: {
      expression: 'privateShy',
      animation: 'breathe_deep',
      haptic: { durationMs: 90, intensity: 0.38 },
      lines: {
        de: ['Bitte achtsam.', '*atmet langsam*'],
        en: ['Please be mindful.', '*breathes slowly*'],
      },
      stateDelta: { affection: 0.006, comfort: 0.002, arousal: 0.008 },
    },

    waist: {
      expression: 'privateClose',
      animation: 'step_closer',
      haptic: { durationMs: 85, intensity: 0.35 },
      lines: {
        de: ['*kommt etwas näher*', 'So ist die Nähe okay.'],
        en: ['*moves a little closer*', 'This closeness is okay.'],
      },
      stateDelta: { affection: 0.008, comfort: 0.006, arousal: 0.006 },
    },

    hips: {
      expression: 'privateShy',
      animation: 'shift_weight',
      haptic: { durationMs: 100, intensity: 0.42 },
      lines: {
        de: ['Langsam, ja?', '*verlagert das Gewicht*'],
        en: ['Slowly, okay?', '*shifts weight*'],
      },
      stateDelta: { affection: 0.004, comfort: -0.002, arousal: 0.010 },
    },

    breast: {
      expression: 'privateBoundary',
      animation: 'private_boundary_soft',
      haptic: { durationMs: 110, intensity: 0.46 },
      lines: {
        de: ['Achte auf meine Reaktion.', '*hält kurz inne*'],
        en: ['Pay attention to my reaction.', '*pauses briefly*'],
      },
      stateDelta: { comfort: -0.004, arousal: 0.012 },
    },

    groin: {
      expression: 'privateBoundary',
      animation: 'private_boundary_clear',
      haptic: { durationMs: 130, intensity: 0.50 },
      lines: {
        de: ['Stopp, erst langsamer.', '*setzt eine klare Grenze*'],
        en: ['Stop, slower first.', '*sets a clear boundary*'],
      },
      stateDelta: { trust: -0.006, comfort: -0.018, arousal: 0.006 },
    },

    butt: {
      expression: 'privateBoundary',
      animation: 'private_boundary_soft',
      haptic: { durationMs: 110, intensity: 0.44 },
      lines: {
        de: ['Nicht überraschend, bitte.', '*dreht sich leicht*'],
        en: ['No surprises, please.', '*turns slightly*'],
      },
      stateDelta: { comfort: -0.008, arousal: 0.008 },
    },
  },
};

export default privateInteractionPack;
