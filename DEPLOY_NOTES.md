# DEPLOY_NOTES.md
# WebXR Companion — Patch Release 2026-05-08b

## Deployment

1. Bisherigen shared-Ordner vollständig leeren.
2. Diese ZIP direkt entpacken. Keine zusätzliche Root-Ebene.
3. Alle Dateien landen als index.html, webxr_companion_core/, assets/ direkt im shared-Ordner.

## Neue Bedienungshinweise für Quest

### Adult-Pack Unlock im XR (gelöster BUG6)

window.confirm() ist im Meta Quest Browser während einer aktiven XR-Session geblockt.
Neuer Workflow:

1. Debug-Panel öffnen (Ctrl+D auf Desktop, oder "CC"-Button vor VR-Start)
2. "Prime Test" drücken (setzt Relationship-Werte für Test)
3. "Prime Consent" drücken (pre-confirms consent, gültig 30 Sekunden)
4. Sofort "Unlock Private" drücken
5. Danach "Private Scene" für den Szenenwechsel

Alternativ: Unlock vor dem Starten der XR-Session aus dem Desktop-Panel durchführen.
Der Unlock-Status wird durch SaveSystem persistiert.

### Controller-Bedienung VR-UI (gelöste BUGS 1/2/9)

- Controller-Strahlen sind nun sichtbar (lila) wenn sie auf ein UI-Panel zeigen
- Select-Button (Trigger) aktiviert jetzt auch die Scene-Mode-Pills im Hauptpanel
- Linker Squeeze: Radialmenü öffnen/schließen
- Rechter Squeeze: Animations-Cycle (vorher: BEIDE Controller, jetzt nur rechts)
- Rechter Squeeze in onXRSessionStart: Settings-HUD (wird von CC gehandelt)

### Debug-Panel im Passthrough-Modus (gelöster BUG7)

- beforexrselect auf Panel und Toggle-Button: verhindert Doppel-Auslösung
- Neue Zeile "ctrl": zeigt erkannte InputSources (Handedness + Profil)
- Neue Zeile "pack": zeigt registered-Status + consent-Flag

## XR-Session Fallback-Kette

enterVR() versucht 3 Konfigurationen in Reihenfolge:
1. Full (dom-overlay / hand-tracking / bounded-floor)
2. Ohne dom-overlay/hand-tracking
3. Minimal (local only)

## Bekannte Restrisiken

1. window.confirm() auf Desktop weiterhin nutzbar (kein XR aktiv), Quest-Pfad via primeConsent().
2. IndexedDB auf Quest kann bei Cache-Leerung verloren gehen (SaveSystem localStorage-Fallback aktiv).
3. VRM-Modelle von externen URLs müssen CORS-kompatibel sein.

## Schnelltests nach Deployment

1. Desktop: Seite laden, Ctrl+Shift+D, Status "live" sichtbar
2. Quest VR: Badge "VR + Passthrough AR bereit", VR-Start ohne Fehler
3. Controller-Ray: Auf VR-Floating-UI zeigen -> lila Strahl wird sichtbar
4. Panel-Click: Trigger auf Scene-Mode-Pill -> Szene wechselt
5. Radialmenü: Linker Squeeze -> Radialmenü öffnet
6. Adult Gate Desktop: Prime Test -> Prime Consent -> Unlock Private -> Private Scene
7. Adult Gate Quest: Erst Prime Consent (30s Fenster), dann Unlock Private
