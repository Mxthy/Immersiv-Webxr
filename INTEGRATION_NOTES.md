# WebXR Companion App — Integration Notes

## Project path

`/home/user/workspace/webxr_companion_app_integrated/`

```
webxr_companion_app_integrated/
├── index.html                       (patched copy of bab82afe2_vr_companion_app.html)
├── webxr_companion_core/            (drop-in core, copied from workspace)
│   ├── CompanionCore.js
│   ├── CompanionState.js
│   ├── InteractionZones.js
│   ├── VRFloatingUI.js
│   ├── VRHudMenu.js
│   ├── ReactionPipeline.js
│   ├── SaveSystem.js
│   ├── SceneSystem.js
│   ├── LicensedAssetManager.js
│   ├── AdultGateController.js
│   ├── contentpacks/
│   │   └── privateInteractionPack.js
│   │   └── explicitInteractionPack.js
│   └── README.md
├── assets/
│   ├── asset_manifest.json
│   ├── ASSET_LICENSES.md
│   ├── hdr/
│   │   └── studio_small_03_1k.hdr
│   └── audio/
│       ├── highDown.ogg
│       ├── highUp.ogg
│       └── laser*.ogg
├── _smoketest_desktop.png           (Playwright screenshot, initial load)
├── _smoketest_debug_panel.png       (Playwright screenshot, debug overlay open)
└── INTEGRATION_NOTES.md             (this file)
```

## Hookpoints applied (all 5 from README)

All hooks are guarded with `try/catch` and optional chaining so the existing
app continues to work even if `CompanionCore` fails to construct/init.

| # | Location in `index.html` | What was added |
|---|---|---|
| 1 | line 438, top of `<script type="module">` after the three / VRM imports | `import { CompanionCore, CompanionState, SaveSystem } from './webxr_companion_core/CompanionCore.js';` |
| 2 | line 680, immediately after `controls.update();` | Constructs `new CompanionCore({ scene, renderer, camera, lang: currentLang, debugZones:false, showUI:false })`, calls `await CC.init()` (fire-and-forget with `.then/.catch`), exposes `window.CC`, `window.CompanionState`, `window.SaveSystem`, dispatches a `cc:ready` event. Wrapped in `try/catch`. |
| 3 | line 981, in `gltfLoader.load` success after `S.mixer = new THREE.AnimationMixer(vrm.scene);` | `window.CC?.onVRMLoaded?.(vrm, S.mixer);` (try/catch) |
| 4 | line 762, in `renderer.setAnimationLoop`, right after `if (S.mixer) S.mixer.update(dt);` | `window.CC?.update?.(dt, timestamp);` (try/catch, errors swallowed per-frame) |
| 5 | line 1261, in `window.enterVR`, right after `renderer.xr.setSession(session);` | `window.CC?.onXRSessionStart?.(session);` (try/catch) |

## Optional bridges (non-breaking)

Added at the bottom of the module script. Each bridge wraps the existing
`window.*` function so that the original behaviour runs first; the
CompanionCore call is a guarded `try/catch` after-effect.

- `selectPersonality(key)` → `CC.nudgeTrust(0.03)` + `CC.setMood(...)` mapped from `shy/playful/flirty/tsundere/cool/sweet`.
- `npcRespond()` → mirrors the resulting `#npc-speech` text into `CC.say(text, false)` (TTS off by default; the floating UI bubble updates).
- `setLang(lang)` → `CC.pipeline?.setLang(lang)`.
- `saveCharacter()` → still POSTs to `/api/entities/Character` as before; **adds** an extra local persisted copy via `CC.saveCharacter(name, S.morphState, S.vrmUrl)` (uses the SaveSystem IndexedDB).

## Desktop debug overlay (Non-XR fallback)

A small floating panel anchored bottom-right (DOM-only, will not render in
immersive XR). Toggle with the **CC** button or **Ctrl+Shift+D**.

Shows live: `state`, `sceneMode`, `relationshipStage`, `mood`, `vrm` status,
`xr` status, plus four progress bars for `trust / affection / comfort / arousal`.
Buttons: `Panel` (toggle floating-UI panel), `HUD` (toggle 3D radial HUD), `Settings` (toggle 3D settings HUD), `SFX`, `Casual / Flirt / Cuddle` (set scene mode), plus private-pack controls.

## VR HUD menu system

`VRHudMenu.js` adds a controller-first menu layer that complements `VRFloatingUI.js`.

Runtime controls:
- Left controller squeeze: toggle radial quick menu.
- Right controller squeeze: toggle settings HUD.
- Controller `select`: activate the currently pointed-at radial/settings button.
- Desktop fallback: `Ctrl+Shift+H` toggles radial HUD, `Ctrl+Shift+S` toggles settings HUD.

Radial quick menu actions:
- `Casual`, `Flirt`, `Cuddle`
- `Private` through `AdultGate.enterAdultScene()`
- `Panel` to toggle the original status/speech floating panel
- `Settings` to open the settings HUD
- `Follow` runtime flag placeholder
- `Hide`

Settings HUD controls:
- `HUD distance`
- `Interaction intensity`
- `Haptics`
- `TTS / voice`
- `Zone debug spheres`
- `Follow mode flag`

Settings are applied live:
- `ReactionPipeline.hapticsEnabled`
- `ReactionPipeline.ttsEnabled`
- `ReactionPipeline.stateDeltaScale`
- `InteractionZones.setDebugVisible()`

Private-pack controls:
- `Prime Test` sets minimum relationship QA values only (`trust 0.65`, `affection 0.50`, `comfort 0.55`, `relationshipStage close_friend`). It does **not** bypass age/consent.
- `Unlock Private` runs the AdultGateController age + consent confirmation, dynamically imports `contentpacks/privateInteractionPack.js`, registers it as SceneSystem pack `adult`, sets `adultPackUnlocked=true`, then refreshes gated zones.
- Current integration uses `contentpacks/explicitInteractionPack.js` as the direct pack URL. `privateInteractionPack.js` remains available as the softer reference pack.
- `Private Scene` enters `sceneMode='adult'` only after the pack is unlocked and registered.
- `Lock` returns private zones to the locked state and exits `adult` scene mode if active.

## Content-pack reaction schema

`contentpacks/privateInteractionPack.js` now supports declarative reaction extensions without editing the core pipeline:

- `expressionSets`: custom VRM expression presets merged into `ReactionPipeline`.
- `animationHints`: fuzzy VRMA / AnimationMixer clip-name hints for `sceneEnter`, `default`, and zone ids.
- `sceneEnterLines`: localized lines when entering the private scene.
- `idleLines`: localized ambient line banks by mood.
- `zoneReactions`: per-zone mapping for `expression`, `animation`, `haptic`, `lines`, and `stateDelta`.

Example zone entry:

```js
waist: {
  expression: 'privateClose',
  animation: 'step_closer',
  haptic: { durationMs: 85, intensity: 0.35 },
  lines: {
    de: ['*kommt etwas näher*', 'So ist die Nähe okay.'],
    en: ['*moves a little closer*', 'This closeness is okay.'],
  },
  stateDelta: { affection: 0.008, comfort: 0.006, arousal: 0.006 },
}
```

The shipped private pack remains non-explicit and consent-oriented. It provides only lighting, expression presets, animation clip hints, haptic intensity hints, localized safe lines, and state balancing.

The shipped explicit pack adds adult-only consent checks, more direct adult interaction mappings, stronger zone-specific haptics, explicit state balancing and additional animation hints. It still enforces adult-only, consent-first boundaries and does not include non-consensual, minor, or real-person content.

## Licensed MVP assets

`LicensedAssetManager.js` loads a local asset set from `assets/asset_manifest.json`.

Bundled assets:
- Poly Haven `studio_small_03_1k.hdr` as WebXR environment/background and reflection map.
- Kenney Digital Audio selected OGG files for UI confirmation, scene transitions and zone reaction SFX.

Runtime integration:
- HDRI is applied to `scene.environment` and `scene.background`.
- Renderer tone mapping is set to `ACESFilmicToneMapping`.
- Audio is unlocked only after a user gesture.
- `CC.setScene()` is wrapped to play `sceneShift`.
- `ReactionPipeline.handleZoneEnter()` is wrapped to play `zoneSoft` or `zoneIntense`.
- Debug overlay has an `assets` status row and `SFX` test button.

Licenses are documented in `assets/ASSET_LICENSES.md`.

## Static checks

- `node --check` passes for all 7 JS modules in `webxr_companion_core/`.
- `node --check` also passes for `AdultGateController.js` and `contentpacks/privateInteractionPack.js`.
- `node --check` also passes for `LicensedAssetManager.js`.
- All relative imports (`./CompanionState.js`, `./InteractionZones.js`, …) resolve to files in the same directory.
- `index.html` keeps its existing `<script type="module">` block (single, line 431) and the existing `importmap` for `three`, `three/addons/`, `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` (CDN-resolved).
- No bundler required — pure ES modules.

## Smoke test (Playwright, headless Chromium)

Server: `python3 -m http.server 5050` from the project directory.

Test 1 — initial load:
- HTTP 200, no `pageerror`, no failed requests.
- `window.CC`, `window.CompanionState`, `window.SaveSystem` all defined.
- Console shows: `[SaveSystem] IndexedDB ready.` → `[SaveSystem] Auto-save every 30s started.` → `[SceneSystem] Transitioning to "casual"` → `[CompanionCore] Init complete.` → `[App] CompanionCore ready.`
- `CompanionState.snapshot()` returns the expected default object.

Test 2 — interactive:
- Clicking the **CC** floating button opens the debug overlay (`display: block`).
- Clicking **Flirt** flips `CompanionState.sceneMode` to `"flirt"` and the panel reflects it.

Both screenshots saved into the project directory:
- `_smoketest_desktop.png`
- `_smoketest_debug_panel.png`

Test 3 — private gate:
- Initial state: `AdultGateController` exists, status `locked`, `adultPackUnlocked=false`, blocked by relationship thresholds.
- `Prime Test`: relationship gate becomes OK while `adultPackUnlocked` remains false.
- `Unlock Private`: accepted age + consent dialogs, dynamic import succeeded, content pack `adult` registered, `adultPackUnlocked=true`.
- `Private Scene`: `CompanionState.sceneMode` becomes `adult`.
- No `pageerror`, no failed requests.

Test 4 — pack reaction pipeline:
- Confirmed `ReactionPipeline` receives the registered private pack.
- Confirmed pack contains `zoneReactions`, `expressionSets`, and `animationHints`.
- Simulated a `waist` zone event in `adult` scene mode.
- Result: state deltas applied (`affection`, `comfort`, `arousal`) and expression target changed to the custom `privateClose` preset.

Test 5 — explicit pack:
- Confirmed `explicitInteractionPack.js` dynamic import succeeds.
- Confirmed pack label is `Explizit`.
- Confirmed `safety.adultsOnly` and `safety.consentRequired` are present.
- Confirmed explicit pack zone reactions for `breast` and `groin`.
- Simulated `breast` zone event in adult scene; state deltas applied and no page errors occurred.

Test 6 — licensed asset manager:
- Confirmed `assets/asset_manifest.json` loads.
- Confirmed Poly Haven HDRI is loaded and assigned to `scene.environment`.
- Confirmed Web Audio unlock works after clicking debug `SFX`.
- Confirmed `uiConfirm` sound loads and decodes.
- No `pageerror`, no failed requests.

Test 7 — VR HUD menu:
- Confirmed `window.CC.hudMenu` exists.
- Confirmed debug `HUD` button opens the radial 3D menu.
- Confirmed debug `Settings` button opens the settings HUD.
- Confirmed HUD runtime settings apply to `ReactionPipeline.hapticsEnabled`, `ReactionPipeline.ttsEnabled`, and `ReactionPipeline.stateDeltaScale`.
- No `pageerror`, no failed requests.

Screenshot saved:
- `_smoketest_adult_gate.png`
- `_smoketest_pack_reactions.png`
- `_smoketest_explicit_pack.png`
- `_smoketest_assets.png`
- `_smoketest_vr_hud.png`

## Known limitations / caveats

1. **WebXR not exercised.** Headless Chromium has no WebXR device. Hook 5 (`onXRSessionStart`) is reachable via try/catch but not run end-to-end; it must be validated on a Quest 2/3 or a desktop Chromium with a connected headset.
2. **CDN dependency.** The importmap pulls Three.js r0.180 and `@pixiv/three-vrm@3.5.2` from `cdn.jsdelivr.net`. Offline use needs vendoring; currently online is required at first load.
3. **SaveSystem uses IndexedDB + localStorage.** Both are sandboxed per-origin. If the page is later embedded in a strict iframe sandbox they may be blocked; the SaveSystem code should be re-checked in that environment.
4. **Adult/private content.** `CompanionState.adultPackUnlocked` defaults to `false`. This integration now includes `AdultGateController.js`, a soft `contentpacks/privateInteractionPack.js`, and a direct `contentpacks/explicitInteractionPack.js`. Unlock requires explicit age + consent confirmation and relationship thresholds.
5. **`saveCharacter` bridge** runs alongside the existing `/api/entities/Character` POST — it does not replace it. If that endpoint is unavailable the original toast still surfaces the failure; the CC local copy still succeeds independently.
6. **`ccKeys` returned by `Object.keys(CC)`** does not list prototype methods (e.g. `update`, `onVRMLoaded`) — those exist on the class prototype and are exercised through `window.CC?.method?.()` calls; the smoke test confirmed this works at runtime.
7. The existing `S.animFn(dt, timestamp)` and other in-loop logic still run before/after the CC update call; nothing in the original render loop was removed.

## How to run locally

```bash
cd /home/user/workspace/webxr_companion_app_integrated
python3 -m http.server 5050
# open http://localhost:5050/ in Chrome 120+
# Press Ctrl+Shift+D for the CompanionCore debug overlay.
```
