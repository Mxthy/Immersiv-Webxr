# FILE_MANIFEST.md
# WebXR Companion — Patch Release 2026-05-08b

## Finale Struktur

```
shared-folder/
├── index.html                                    (1679 Zeilen, alle 5 CC-Hooks)
├── webxr_companion_core/
│   ├── CompanionCore.js                          Hub
│   ├── CompanionState.js                         Reaktiver State
│   ├── InteractionZones.js                       VRM-Körper-Kollisionszonen
│   ├── VRFloatingUI.js                           World-Space Panel + Controller-Rays (PATCHED)
│   ├── VRHudMenu.js                              Radialmenü + Settings-HUD (PATCHED)
│   ├── ReactionPipeline.js                       Expressions, Haptics, TTS
│   ├── SaveSystem.js                             localStorage + IndexedDB
│   ├── SceneSystem.js                            Szenen-Modi + ContentPack
│   ├── AdultGateController.js                    Age/Consent Gate (PATCHED)
│   ├── LicensedAssetManager.js                   HDRI + Audio
│   ├── README.md                                 Dokumentation
│   └── contentpacks/
│       ├── privateInteractionPack.js
│       └── explicitInteractionPack.js
├── assets/
│   ├── asset_manifest.json
│   ├── ASSET_LICENSES.md
│   ├── hdr/studio_small_03_1k.hdr
│   └── audio/ (highUp, highDown, laser1-7.ogg)
├── FILE_MANIFEST.md
├── REMOVED_FILES.md
└── DEPLOY_NOTES.md
```

## Patch-Zusammenfassung

BUG1 — VRFloatingUI._onControllerSelect(): Panel-Click fehlte → FIXED
BUG2 — VRFloatingUI._buildControllerRays(): Rays nicht an Controller → FIXED
BUG3 — VRHudMenu._testControllerRays(): kein early-return → FIXED
BUG4 — VRHudMenu matrixWorld: veraltete Pose → FIXED
BUG6 — AdultGate window.confirm() im XR geblockt → FIXED (primeConsent())
BUG7 — Debug-Panel Passthrough: beforexrselect + Quest-Toggle → FIXED
BUG8 — onSqueeze Konflikt CC-Squeeze → FIXED (rechter Controller only)
BUG9 — VRFloatingUI Rays nicht sichtbar → FIXED
