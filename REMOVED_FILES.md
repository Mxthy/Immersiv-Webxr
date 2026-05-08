# REMOVED_FILES.md
# WebXR Companion — Patch Release 2026-05-08b

## Nicht übernommene Dateien (identisch mit vorheriger Release)

### _smoketest_*.png (7 Dateien)
Playwright-Testscreenshots. Kein Laufzeit-Asset. Entfernt.

### INTEGRATION_NOTES.md (root)
Inhalt in webxr_companion_core/README.md konsolidiert.

### assets/audio/Preview.ogg
Nicht in asset_manifest.json referenziert, nicht geladen. Entfernt.

---

## Geänderte Dateien in diesem Patch (vs. ZIP-Snapshot)

| Datei | Bugs | Beschreibung |
|---|---|---|
| index.html | BUG7, BUG8 | enterVR 3-stufige Fallback-Kette; xr-active class; onSqueeze auf rechten Controller beschränkt; Debug-Panel: beforexrselect, Prime-Consent-Button, Controller-Diagnostics-Zeile, Pack-Status-Zeile; checkVR verbessert |
| VRFloatingUI.js | BUG1, BUG2, BUG9 | _onControllerSelect dispatcht jetzt Panel-Click; _buildControllerRays heftet Strahlen an Controller; _testControllerRays nutzt transformDirection + updateMatrixWorld; _lastPanelHover tracking; activateControllerRays() API; Hover-Highlight implementiert |
| VRHudMenu.js | BUG3, BUG4 | _testControllerRays early-return wenn kein Panel sichtbar; updateMatrixWorld(true) + transformDirection für korrekte Pose; _updateHover null-safe |
| AdultGateController.js | BUG6 | primeConsent() Methode für XR-kompatibles Consent-Flow; _confirmAgeAndConsent prüft xr-active class; requestUnlock prüft mod.explicitInteractionPack (named export); _loadInProgress Guard gegen Race Conditions; einmalige Pack-Registration |
| CompanionCore.js | BUG2 | onXRSessionStart ruft floatUI.activateControllerRays() |
| webxr_companion_core/README.md | — | Konsolidierte Dokumentation |

---

## Unveränderte Dateien (REUSE)

CompanionState.js, InteractionZones.js, ReactionPipeline.js, SaveSystem.js,
SceneSystem.js, LicensedAssetManager.js, contentpacks/privateInteractionPack.js,
contentpacks/explicitInteractionPack.js, alle Assets
