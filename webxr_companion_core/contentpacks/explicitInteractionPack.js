/**
 * explicitInteractionPack.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Adult-only opt-in content pack for fictional adult companions.
 *
 * Hard boundaries:
 *   - adults only
 *   - consent-first
 *   - no coercion / no non-consensual scenarios
 *   - no minors or ambiguous-age characters
 *   - no real-person likeness targeting
 *
 * This pack is intentionally data-driven: scenes, zone reactions, dialogue,
 * haptics, animation hints and state deltas can be tuned without touching the
 * core systems.
 */

export const explicitInteractionPack = {
  id: 'adult',
  label: {
    de: 'Explizit',
    en: 'Explicit',
  },
  locked: false,

  safety: {
    adultsOnly: true,
    consentRequired: true,
    stopWords: ['stopp', 'stop', 'halt', 'pause', 'langsamer', 'slow', 'no', 'nein'],
    blockedThemes: ['minor', 'coercion', 'nonconsent', 'real_person'],
  },

  env: {
    background: 0x030006,
    fogColor: 0x030006,
    fogDensity: 0.022,
    exposure: 0.92,
  },

  lights: [
    { type: 'ambient', color: 0xffd4e8, intensity: 0.20 },
    { type: 'directional', color: 0xff9fc8, intensity: 0.45, pos: [0.6, 2.6, 1.6] },
    { type: 'point', color: 0xff4f9d, intensity: 0.82, pos: [0.0, 1.25, 0.50], distance: 5 },
    { type: 'point', color: 0x7a35ff, intensity: 0.32, pos: [-1.1, 1.75, -0.7], distance: 7 },
  ],

  companion: {
    personalSpaceRadius: 0.03,
    idleAnimHint: 'adult_breath_slow',
    lookAtEnabled: false,
    arousalDecayRate: 0.00025,
    comfortGainRate: 0.006,
    requireConsentCheckEverySeconds: 45,
  },

  expressionSets: {
    adultSoft: {
      happy: 0.50,
      relaxed: 0.72,
    },
    adultWanting: {
      happy: 0.62,
      relaxed: 0.42,
      surprised: 0.16,
    },
    adultOverwhelmed: {
      surprised: 0.42,
      sad: 0.10,
      relaxed: 0.08,
    },
    adultBoundary: {
      surprised: 0.48,
      angry: 0.26,
    },
    adultAftercare: {
      happy: 0.44,
      relaxed: 0.82,
    },
  },

  animationHints: {
    sceneEnter: ['adult_idle_close', 'adult_breath_slow', 'look_soft'],
    default: ['adult_react_soft', 'adult_breath_slow'],
    consent_check: ['look_soft', 'nod_soft'],
    aftercare: ['adult_aftercare_idle', 'breath'],
    head: ['look_soft', 'blink_shy'],
    hand_l: ['adult_hand_hold', 'react_soft'],
    hand_r: ['adult_hand_hold', 'react_soft'],
    chest: ['adult_chest_react', 'breathe_deep'],
    waist: ['adult_pull_close', 'step_closer'],
    hips: ['adult_hip_react', 'shift_weight'],
    breast: ['adult_breast_react', 'adult_breath_deep'],
    groin: ['adult_groin_boundary', 'adult_step_back_small'],
    butt: ['adult_butt_react', 'shift_weight'],
  },

  sceneEnterLines: {
    de: [
      'Nur wenn du aufmerksam bleibst und meine Reaktionen beachtest.',
      'Ich will, dass wir langsam anfangen und jederzeit stoppen können.',
    ],
    en: [
      'Only if you stay attentive and read my reactions.',
      'I want us to start slowly and be able to stop at any time.',
    ],
  },

  consentCheckLines: {
    de: [
      'Ist das Tempo für dich okay?',
      'Ich bleibe dabei, solange es sich für uns beide gut anfühlt.',
      'Sag sofort Stopp, wenn du etwas ändern willst.',
    ],
    en: [
      'Is this pace okay for you?',
      'I stay with it as long as it feels good for both of us.',
      'Say stop immediately if you want to change anything.',
    ],
  },

  idleLines: {
    neutral: {
      de: ['*atmet langsam*', 'Bleib nah, aber achtsam.'],
      en: ['*breathes slowly*', 'Stay close, but attentive.'],
    },
    loving: {
      de: ['*sucht deine Nähe*', 'So fühlt es sich vertraut an.'],
      en: ['*seeks your closeness*', 'This feels intimate and trusted.'],
    },
    shy: {
      de: ['*wird rot*', 'Langsam... ich will mitkommen können.'],
      en: ['*blushes*', 'Slowly... I want to be able to keep up.'],
    },
    excited: {
      de: ['*atmet hörbar ein*', 'Okay... weiter, aber vorsichtig.'],
      en: ['*breathes in audibly*', 'Okay... continue, but carefully.'],
    },
  },

  zoneReactions: {
    default: {
      expression: 'adultSoft',
      expressionIntensity: 0.78,
      holdSeconds: 2.0,
      animation: 'adult_react_soft',
      haptic: { durationMs: 75, intensity: 0.34 },
      lines: {
        de: ['*reagiert spürbar*'],
        en: ['*responds noticeably*'],
      },
      stateDelta: { affection: 0.006, comfort: 0.004, arousal: 0.006 },
    },

    head: {
      expression: 'adultSoft',
      animation: 'look_soft',
      haptic: { durationMs: 65, intensity: 0.25 },
      lines: {
        de: ['*lehnt sich in die Berührung*', 'Das ist sanft.'],
        en: ['*leans into the touch*', 'That is gentle.'],
      },
      stateDelta: { trust: 0.007, affection: 0.005, comfort: 0.007 },
    },

    hand_l: {
      expression: 'adultSoft',
      animation: 'adult_hand_hold',
      haptic: { durationMs: 70, intensity: 0.22 },
      lines: {
        de: ['*verschränkt die Finger mit deinen*'],
        en: ['*laces fingers with yours*'],
      },
      stateDelta: { trust: 0.006, affection: 0.006, comfort: 0.006 },
    },

    hand_r: {
      expression: 'adultSoft',
      animation: 'adult_hand_hold',
      haptic: { durationMs: 70, intensity: 0.22 },
      lines: {
        de: ['*hält deine Hand etwas fester*'],
        en: ['*holds your hand a little tighter*'],
      },
      stateDelta: { trust: 0.006, affection: 0.006, comfort: 0.006 },
    },

    chest: {
      expression: 'adultWanting',
      animation: 'adult_chest_react',
      haptic: { durationMs: 105, intensity: 0.42 },
      lines: {
        de: ['*atmet tiefer*', 'Achte auf mein Tempo.'],
        en: ['*breathes deeper*', 'Pay attention to my pace.'],
      },
      stateDelta: { affection: 0.008, comfort: 0.002, arousal: 0.014 },
    },

    waist: {
      expression: 'adultWanting',
      animation: 'adult_pull_close',
      haptic: { durationMs: 95, intensity: 0.38 },
      lines: {
        de: ['*kommt näher an dich heran*', 'So nah ist okay.'],
        en: ['*moves closer to you*', 'This close is okay.'],
      },
      stateDelta: { affection: 0.010, comfort: 0.007, arousal: 0.010 },
    },

    hips: {
      expression: 'adultWanting',
      animation: 'adult_hip_react',
      haptic: { durationMs: 115, intensity: 0.48 },
      lines: {
        de: ['*reagiert mit einer langsamen Bewegung*', 'Nicht schneller.'],
        en: ['*responds with a slow movement*', 'Not faster.'],
      },
      stateDelta: { affection: 0.008, comfort: -0.002, arousal: 0.018 },
    },

    breast: {
      expression: 'adultOverwhelmed',
      animation: 'adult_breast_react',
      haptic: { durationMs: 125, intensity: 0.52 },
      lines: {
        de: ['*keucht leise auf*', 'Langsam... ja, so ist es besser.'],
        en: ['*gasps softly*', 'Slowly... yes, that is better.'],
      },
      stateDelta: { affection: 0.006, comfort: -0.004, arousal: 0.022 },
    },

    groin: {
      expression: 'adultBoundary',
      animation: 'adult_groin_boundary',
      haptic: { durationMs: 140, intensity: 0.56 },
      lines: {
        de: ['Stopp. Erst fragen und langsamer werden.', '*setzt eine klare Grenze*'],
        en: ['Stop. Ask first and slow down.', '*sets a clear boundary*'],
      },
      stateDelta: { trust: -0.010, comfort: -0.028, arousal: 0.004 },
    },

    butt: {
      expression: 'adultOverwhelmed',
      animation: 'adult_butt_react',
      haptic: { durationMs: 120, intensity: 0.48 },
      lines: {
        de: ['*zuckt leicht zusammen*', 'Nicht überraschend. Sag mir, was du vorhast.'],
        en: ['*flinches slightly*', 'No surprises. Tell me what you are doing.'],
      },
      stateDelta: { trust: -0.004, comfort: -0.010, arousal: 0.012 },
    },
  },
};

export default explicitInteractionPack;
