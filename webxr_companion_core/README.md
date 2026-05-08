# WebXR Companion Core

**Platform:** WebXR (immersive-vr / immersive-ar) · Three.js r180 · @pixiv/three-vrm 3.5  
**Target app:** `bab82afe2_vr_companion_app.html`  
**No Unity dependency.**

---

## Module Overview

```
webxr_companion_core/
  CompanionCore.js      ← Main entry point / wiring hub
  CompanionState.js     ← Reactive state store (trust/affection/comfort/arousal/mood/scene/stage)
  InteractionZones.js   ← Body-volume sphere system on VRM humanoid bones
  VRFloatingUI.js       ← World-space floating panel (CanvasTexture + WebXR raycasting)
  ReactionPipeline.js   ← VRM expressions · VRMA hooks · haptics · Speech Synthesis
  SaveSystem.js         ← localStorage (state/settings) + IndexedDB (characters/sessions)
  SceneSystem.js        ← Scene mode lighting/env transitions + ContentPack API
  README.md             ← This file
```

---

## Integration — 5 Hook Points

### Step 1 — Add the import to the HTML `<script type="module">`

Inside `bab82afe2_vr_companion_app.html`, at the **top** of the existing `<script type="module">` block, after the existing three / VRM imports:

```js
// ── COMPANION CORE ───────────────────────────────────────────────────────────
import { CompanionCore, CompanionState, SaveSystem }
  from './webxr_companion_core/CompanionCore.js';
```

---

### Step 2 — Construct after renderer/scene/camera are ready

Find the section after the renderer, scene, camera, and controls are set up (around line 690 in the original file). Add:

```js
// ── COMPANION CORE INIT ──────────────────────────────────────────────────────
const CC = new CompanionCore({
  scene,
  renderer,
  camera,
  lang        : currentLang,   // 'de' | 'en' — from existing i18n
  debugZones  : false,         // set true to see zone wireframes in VR
  showUI      : false,         // UI panel starts hidden; toggle with B/Y button
});
await CC.init();
// Expose globally so existing HTML callbacks can call CC.say() etc.
window.CC = CC;
```

---

### Step 3 — Hook into `doLoadVRM` success callback

Find the line `S.vrm = vrm; S.vrmUrl = url;` inside the `gltfLoader.load` success callback (around line 943). Add **one line** below it:

```js
S.vrm = vrm; S.vrmUrl = url;
CC.onVRMLoaded(vrm, S.mixer);         // ← ADD THIS
```

---

### Step 4 — Hook into the render loop

Inside `renderer.setAnimationLoop`, after `if (S.mixer) S.mixer.update(dt);`, add:

```js
// Companion Core update (zones, expressions, UI billboard)
CC.update(dt, timestamp);             // ← ADD THIS
```

---

### Step 5 — Hook into `enterVR`

Inside the `window.enterVR` function, after `renderer.xr.setSession(session);`, add:

```js
renderer.xr.setSession(session);
CC.onXRSessionStart(session);         // ← ADD THIS
```

That's it. The companion system is now live.

---

## Full Minimal Integration Diff

```diff
// ── After existing three/VRM imports ─────────────────────────────────────────
+ import { CompanionCore, CompanionState, SaveSystem }
+   from './webxr_companion_core/CompanionCore.js';

// ── After scene/camera/renderer setup ────────────────────────────────────────
+ const CC = new CompanionCore({ scene, renderer, camera, lang: currentLang });
+ await CC.init();
+ window.CC = CC;

// ── Inside doLoadVRM success callback ────────────────────────────────────────
  S.vrm = vrm; S.vrmUrl = url;
+ CC.onVRMLoaded(vrm, S.mixer);

// ── Inside renderer.setAnimationLoop ─────────────────────────────────────────
  if (S.mixer) S.mixer.update(dt);
+ CC.update(dt, timestamp);

// ── Inside enterVR, after renderer.xr.setSession ─────────────────────────────
  renderer.xr.setSession(session);
+ CC.onXRSessionStart(session);
```

---

## CompanionState — Fields

| Field | Type | Range/Values | Description |
|---|---|---|---|
| `trust` | number | 0–1 | How much the companion trusts the user |
| `affection` | number | 0–1 | Affection level |
| `comfort` | number | 0–1 | Physical/emotional comfort |
| `arousal` | number | 0–1 | Arousal level |
| `mood` | string | see MOODS | Current mood |
| `sceneMode` | string | casual/flirt/cuddle/adult | Active scene mode |
| `relationshipStage` | string | stranger→partner | Relationship progression |
| `adultPackUnlocked` | boolean | — | Adult content gate |

### Usage examples

```js
// Read
const trust = CompanionState.get('trust');
const snap  = CompanionState.snapshot();

// Write
CompanionState.set('affection', 0.7);
CompanionState.nudge('trust', +0.05);

// Subscribe
CompanionState.on('mood', (mood, prev) => console.log('Mood changed:', mood));
CompanionState.onAny((key, val, prev) => console.log(key, val));
```

---

## InteractionZones — Body Volumes

Zones are defined in `ZONE_DEFINITIONS` (InteractionZones.js). Each maps to a VRM humanoid bone with a sphere radius. Adult-gated zones are disabled until `adultPackUnlocked = true`.

| Zone id | Bone | Radius | Adult-gated |
|---|---|---|---|
| head | head | 0.12 | No |
| chest | chest | 0.14 | No |
| breast | chest+offset | 0.10 | **Yes** |
| groin | hips+offset | 0.08 | **Yes** |
| butt | hips+offset | 0.10 | **Yes** |
| (…others) | | | No |

Events emitted (listen with `CC.zones.on('zoneEnter', fn)`):
- `zoneEnter` — `{ zone, hand, def }`
- `zoneExit` — `{ zone }`
- `zoneHeld` — `{ zone, heldFor, dt }` (every frame while held)
- `gazeHeld` — `{ seconds }` (after 2s sustained gaze)

---

## VRFloatingUI — World-Space Panel

The panel is a Three.js `PlaneGeometry` with a `CanvasTexture`. It billboard-faces the camera.

```js
CC.floatUI.show();
CC.floatUI.setSpeech('Hallo~');
CC.floatUI.openKeyboard('Dein Name:', (text) => console.log('Input:', text));
CC.toggleUI();   // shortcut via CompanionCore
```

**Panel content (auto-updated from state):**
- Trust / Affection / Comfort / Arousal progress bars
- Relationship stage badge + Mood emoji
- Scene mode selector pills (Casual / Flirt / Cuddle / Adult*)
- Speech bubble

**Controller interaction:** Ray from controller → plane UV → hit-test → button click.

---

## ReactionPipeline

| Trigger | Expression | State change |
|---|---|---|
| Zone enter (head/shoulder) | surprised → back to neutral | affection +0.02 |
| Zone enter (chest/hips) | surprised | affection +0.02 |
| Zone enter (breast/groin)* | excited | arousal +rate |
| Gaze held 2s | shy | comfort -0.04 |
| mood=loving | relaxed+happy blend | — |
| arousal > 0.85 | excited | — |

**VRMA clip hooks:** register clips by name after loading:

```js
// After loadClip() creates an action:
const action = S.mixer.clipAction(clip);
CC.pipeline.registerClip('wave', action);
CC.pipeline.registerClip('idle', action);
// Pipeline will trigger matching clips on zone reactions
```

**TTS Adapter:** Swap the default Web Speech API adapter with any provider:

```js
// Custom TTS adapter interface:
const myTTS = {
  setLang(lang) { /* ... */ },
  speak(text, opts) { /* call ElevenLabs / Azure here */ },
  stop() { /* ... */ },
};
CC.pipeline.tts = myTTS;
```

---

## SaveSystem

```js
// Auto-save runs every 30s after CC.init().

// Manual save
SaveSystem.saveCompanionState();

// Characters (localStorage fallback + IndexedDB)
await SaveSystem.saveCharacter('Yuki', { modelUrl, morphState, personality: 'shy' });
const chars = await SaveSystem.listCharacters();
const yuki  = await SaveSystem.loadCharacter('Yuki');

// Settings
SaveSystem.saveSettings({ lang: 'de', defaultModel: 'url...' });
const settings = SaveSystem.getSettings();

// Export / Import
const json = await SaveSystem.exportAll();
await SaveSystem.importAll(json);
```

---

## SceneSystem — Scene Modes

Built-in packs: `casual`, `flirt`, `cuddle`.  
Adult pack: **not included** — registered externally.

```js
// Transition (also called when CompanionState.sceneMode changes)
CC.setScene('flirt');

// Register adult pack (your separate file, after age-gate):
import { ADULT_PACK } from './adult_content_pack.js';   // NOT in this repo
CC.registerContentPack('adult', ADULT_PACK);
CC.unlockAdultPack();
CC.setScene('adult');
```

The adult pack template/schema is documented as a comment at the bottom of `SceneSystem.js`.

---

## Interaction with Existing App Functions

### Connecting NPC personality → Companion state:

```js
// In the existing selectPersonality() function, add:
window.selectPersonality = (key) => {
  // ... existing code ...
  CC.nudgeTrust(0.03);
  CC.setMood(key === 'shy' ? 'shy' : key === 'playful' ? 'playful' : 'neutral');
};
```

### Connecting npcRespond() → pipeline:

```js
window.npcRespond = () => {
  // ... existing code ...
  const reply = responses[Math.floor(Math.random() * responses.length)];
  CC.say(reply);           // speech bubble + TTS
  document.getElementById('npc-speech').textContent = reply;
};
```

### Connecting saveCharacter() → SaveSystem:

```js
window.saveCharacter = async () => {
  const name = document.getElementById('char-name').value.trim();
  if (!name) { toast('⚠️ Name eingeben!'); return; }
  await CC.saveCharacter(name, S.morphState, S.vrmUrl);
  toast('✅ "' + name + '" gespeichert!');
};
```

### Language switch → pipeline lang:

```js
window.setLang = (lang) => {
  // ... existing i18n code ...
  CC.pipeline.setLang(lang);
};
```

---

## Controller Mapping (from vrstudios_bindings_universal.json)

| Button | Action |
|---|---|
| B / Y (squeeze) | Toggle floating UI panel |
| Trigger | Grab / select |
| Grip | Grab character |
| A / X | (reserved — can bind to scene mode cycle) |

---

## Architecture Diagram

```
bab82afe2_vr_companion_app.html
  └─ <script type="module">
       ├─ Three.js / @pixiv/three-vrm / three-vrm-animation
       │
       └─ CompanionCore.js  ─── init / update / onVRMLoaded / onXRSessionStart
            ├─ CompanionState.js       reactive state store
            │    └─ (all modules subscribe)
            ├─ InteractionZones.js     sphere volumes on VRM bones
            │    └─ emits → ReactionPipeline
            ├─ ReactionPipeline.js     expressions · VRMA · haptics · TTS
            │    └─ updates → VRFloatingUI (speech bubble)
            ├─ VRFloatingUI.js         CanvasTexture panel in XR space
            │    └─ reads CompanionState (auto-repaints on change)
            ├─ SceneSystem.js          lighting / env / ContentPack API
            │    └─ driven by CompanionState.sceneMode
            └─ SaveSystem.js           localStorage + IndexedDB persistence
```

---

## Browser / Device Requirements

- **Meta Quest 2/3/Pro** — primary target (Chromium WebXR)
- **Chrome 120+** on PC with VR headset via WebXR API
- **Firefox Reality / Wolvic** — supported
- Passthrough AR (immersive-ar) supported on Quest with `local-floor` reference space
- `speechSynthesis` (TTS) available in Chromium; swap adapter for better voices
- No server required — fully client-side

---

## File Sizes (approximate)

| File | Lines | Notes |
|---|---|---|
| CompanionCore.js | 282 | Entry point |
| CompanionState.js | 219 | Reactive store |
| InteractionZones.js | 353 | Zone detection |
| VRFloatingUI.js | 523 | Canvas UI + keyboard |
| ReactionPipeline.js | 370 | Expressions + TTS |
| SaveSystem.js | 303 | Storage |
| SceneSystem.js | 332 | Lighting |
| **Total** | **~2382** | |

All files are vanilla ES modules, no bundler required.
