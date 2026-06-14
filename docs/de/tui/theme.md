---
title: Theming-Referenz
description: >-
  TUI-Theming-Referenz mit Farb-Tokens, Schriftarteinstellungen und
  Theme-Anpassung.
sidebar:
  order: 3
  label: Theming
i18n:
  sourceHash: 1f5d0f83a7f4
  translator: machine
---

# Theming-Referenz

Dieses Dokument beschreibt, wie das Theming im Coding-Agent funktioniert: Schema, Laden, Laufzeitverhalten und Fehlermodi.

## Was das Theme-System steuert

Das Theme-System steuert:

- Vordergrund-/Hintergrund-Farb-Tokens, die im gesamten TUI verwendet werden
- Markdown-Styling-Adapter (`getMarkdownTheme()`)
- Selektor-/Editor-/Einstellungslisten-Adapter (`getSelectListTheme()`, `getEditorTheme()`, `getSettingsListTheme()`)
- Symbol-Voreinstellung + Symbol-Überschreibungen (`unicode`, `nerd`, `ascii`)
- Syntaxhervorhebungsfarben des nativen Highlighters (`@f5xc-salesdemos/pi-natives`)
- Farben der Statuszeilensegmente

Primäre Implementierung: `src/modes/theme/theme.ts`.

## JSON-Struktur des Themes

Theme-Dateien sind JSON-Objekte, die gegen das Laufzeitschema in `theme.ts` (`ThemeJsonSchema`) validiert werden und durch `src/modes/theme/theme-schema.json` gespiegelt werden.

Felder der obersten Ebene:

- `name` (erforderlich)
- `colors` (erforderlich; alle Farb-Tokens erforderlich)
- `vars` (optional; wiederverwendbare Farbvariablen)
- `export` (optional; HTML-Export-Farben)
- `symbols` (optional)
  - `preset` (optional: `unicode | nerd | ascii`)
  - `overrides` (optional: Schlüssel/Wert-Überschreibungen für `SymbolKey`)

Farbwerte akzeptieren:

- Hex-Zeichenkette (`"#RRGGBB"`)
- 256-Farb-Index (`0..255`)
- Variablenreferenz-Zeichenkette (wird durch `vars` aufgelöst)
- Leere Zeichenkette (`""`) bedeutet Terminal-Standard (`\x1b[39m` fg, `\x1b[49m` bg)

## Erforderliche Farb-Tokens (aktuell)

Alle nachfolgenden Tokens sind in `colors` erforderlich.

### Kerntexte und Rahmen (11)

`accent`, `border`, `borderAccent`, `borderMuted`, `success`, `error`, `warning`, `muted`, `dim`, `text`, `thinkingText`

### Hintergrundblöcke (7)

`selectedBg`, `userMessageBg`, `customMessageBg`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `statusLineBg`

### Nachrichten-/Werkzeugtext (5)

`userMessageText`, `customMessageText`, `customMessageLabel`, `toolTitle`, `toolOutput`

### Markdown (10)

`mdHeading`, `mdLink`, `mdLinkUrl`, `mdCode`, `mdCodeBlock`, `mdCodeBlockBorder`, `mdQuote`, `mdQuoteBorder`, `mdHr`, `mdListBullet`

### Werkzeug-Diff + Syntaxhervorhebung (12)

`toolDiffAdded`, `toolDiffRemoved`, `toolDiffContext`,
`syntaxComment`, `syntaxKeyword`, `syntaxFunction`, `syntaxVariable`, `syntaxString`, `syntaxNumber`, `syntaxType`, `syntaxOperator`, `syntaxPunctuation`

### Modus-/Denkrahmen (8)

`thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, `thinkingXhigh`, `bashMode`, `pythonMode`

### Statuszeilensegment-Farben (14)

`statusLineSep`, `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`, `statusLineContext`, `statusLineSpend`, `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`, `statusLineOutput`, `statusLineCost`, `statusLineSubagents`

## Optionale Tokens

### Abschnitt `export` (optional)

Wird für HTML-Export-Theming-Hilfsfunktionen verwendet:

- `export.pageBg`
- `export.cardBg`
- `export.infoBg`

Wenn weggelassen, leitet der Export-Code Standardwerte aus den aufgelösten Theme-Farben ab.

### Abschnitt `symbols` (optional)

- `symbols.preset` legt einen Standard-Symbolsatz auf Theme-Ebene fest.
- `symbols.overrides` kann einzelne `SymbolKey`-Werte überschreiben.

Laufzeit-Rangfolge:

1. Einstellungs-`symbolPreset`-Überschreibung (falls gesetzt)
2. Theme-JSON `symbols.preset`
3. Fallback `"unicode"`

Ungültige Überschreibungsschlüssel werden ignoriert und protokolliert (`logger.debug`).

## Eingebaute vs. benutzerdefinierte Theme-Quellen

Reihenfolge der Theme-Suche (`loadThemeJson`):

1. Eingebaute, eingebettete Themes (`defaults/xcsh-dark.json` und `defaults/xcsh-light.json`, kompiliert in `defaultThemes`)
2. Benutzerdefinierte Theme-Datei: `<customThemesDir>/<name>.json`

Das Verzeichnis für benutzerdefinierte Themes stammt von `getCustomThemesDir()`:

- Standard: `~/.xcsh/agent/themes`
- Überschrieben durch `PI_CODING_AGENT_DIR` (`$PI_CODING_AGENT_DIR/themes`)

`getAvailableThemes()` gibt zusammengeführte eingebaute + benutzerdefinierte Namen zurück, sortiert, wobei eingebaute Themes bei Namenskollisionen Vorrang haben.

## Laden, Validierung und Auflösung

Für benutzerdefinierte Theme-Dateien:

1. JSON lesen
2. JSON parsen
3. Gegen `ThemeJsonSchema` validieren
4. `vars`-Referenzen rekursiv auflösen
5. Aufgelöste Werte nach ANSI gemäß Terminal-Fähigkeitsmodus konvertieren

Validierungsverhalten:

- Fehlende erforderliche Farb-Tokens: explizite gruppierte Fehlermeldung
- Falsche Token-Typen/-Werte: Validierungsfehler mit JSON-Pfad
- Unbekannte Theme-Datei: `Theme not found: <name>`

Verhalten von Variablenreferenzen:

- Unterstützt verschachtelte Referenzen
- Löst Ausnahme bei fehlender Variablenreferenz aus
- Löst Ausnahme bei Zirkularreferenzen aus

## Verhalten des Terminal-Farbmodus

Farbmoduserkennung (`detectColorMode`):

- `COLORTERM=truecolor|24bit` => Truecolor
- `WT_SESSION` => Truecolor
- `TERM` in `dumb`, `linux` oder leer => 256-Farben
- andernfalls => Truecolor

Konvertierungsverhalten:

- Hex -> `Bun.color(..., "ansi-16m" | "ansi-256")`
- Numerisch -> `38;5` / `48;5` ANSI
- `""` -> Standard fg/bg-Reset

## Laufzeit-Wechselverhalten

### Initiales Theme (`initTheme`)

`main.ts` initialisiert das Theme mit Einstellungen:

- `symbolPreset`
- `colorBlindMode`
- `theme.dark`
- `theme.light`

Die automatische Theme-Slot-Auswahl verwendet `COLORFGBG`-Hintergrunderkennung:

- Hintergrundindex aus `COLORFGBG` parsen
- `< 8` => Dunkel-Slot (`theme.dark`)
- `>= 8` => Hell-Slot (`theme.light`)
- Parse-Fehler => Dunkel-Slot

Aktuelle Standardwerte aus dem Einstellungsschema:

- `theme.dark = "xcsh-dark"`
- `theme.light = "xcsh-light"`
- `symbolPreset = "unicode"`
- `colorBlindMode = false`

### Expliziter Wechsel (`setTheme`)

- Lädt ausgewähltes Theme
- Aktualisiert globales `theme`-Singleton
- Startet optional einen Watcher
- Löst `onThemeChange`-Callback aus

Bei Fehler:

- Fällt auf eingebautes `dark` zurück
- Gibt `{ success: false, error }` zurück

### Vorschau-Wechsel (`previewTheme`)

- Wendet temporäres Vorschau-Theme auf globales `theme` an
- Ändert **nicht** die persistierten Einstellungen
- Gibt Erfolg/Fehler ohne Fallback-Ersatz zurück

Die Einstellungs-UI nutzt dies für die Live-Vorschau und stellt beim Abbrechen das vorherige Theme wieder her.

## Watcher und Live-Reload

Wenn der Watcher aktiviert ist (`setTheme(..., true)` / interaktive Initialisierung):

- Überwacht nur den benutzerdefinierten Dateipfad `<customThemesDir>/<currentTheme>.json`
- Eingebaute Themes werden effektiv nicht überwacht
- Datei `change`: Versucht Neuladen (entprellt)
- Datei `rename`/Löschen: Fällt auf `dark` zurück, schließt Watcher

Der Auto-Modus installiert außerdem einen `SIGWINCH`-Listener und kann die Dunkel-/Hell-Slot-Zuordnung neu auswerten, wenn sich der Terminal-Status ändert.

## Verhalten des Farbenblind-Modus

`colorBlindMode` ändert zur Laufzeit nur ein Token:

- `toolDiffAdded` wird per HSV angepasst (Grün in Richtung Blau verschoben)
- Die Anpassung wird nur angewendet, wenn der aufgelöste Wert eine Hex-Zeichenkette ist

Alle anderen Tokens bleiben unverändert.

## Wo Theme-Einstellungen gespeichert werden

Theme-bezogene Einstellungen werden von `Settings` in der globalen Konfigurations-YAML gespeichert:

- Pfad: `<agentDir>/config.yml`
- Standard-Agent-Verzeichnis: `~/.xcsh/agent`
- Effektive Standarddatei: `~/.xcsh/agent/config.yml`

Gespeicherte Schlüssel:

- `theme.dark`
- `theme.light`
- `symbolPreset`
- `colorBlindMode`

Eine Legacy-Migration existiert: Das alte flache `theme: "name"` wird basierend auf der Luminanz-Erkennung zu verschachteltem `theme.dark` oder `theme.light` migriert.

## Erstellen eines benutzerdefinierten Themes (praktisch)

1. Erstellen Sie eine Datei im Verzeichnis für benutzerdefinierte Themes, z. B. `~/.xcsh/agent/themes/my-theme.json`.
2. Geben Sie `name`, optionale `vars` und **alle erforderlichen** `colors`-Tokens an.
3. Fügen Sie optional `symbols` und `export` hinzu.
4. Wählen Sie das Theme in den Einstellungen (`Anzeige -> Dunkles Theme` oder `Anzeige -> Helles Theme`) aus, je nachdem, welchen Auto-Slot Sie möchten.

Minimales Grundgerüst. Jeder Schlüssel in `colors` ist erforderlich — der Laufzeit-Validator
(`additionalProperties: false`) weist sowohl fehlende als auch unbekannte Schlüssel zurück.
Als mitgelieferte Referenzimplementierungen siehe
[`packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json)
und [`xcsh-light.json`](../../packages/coding-agent/src/modes/theme/defaults/xcsh-light.json).

Die Statuszeile verfügt über zwei parallele Farbsysteme, die in Issue #242 dokumentiert sind:

- Hex-Textfarben (`statusLinePath`, `statusLineGitClean`, `statusLineGitDirty`,
  `statusLineStaged`, `statusLineDirty`, `statusLineUntracked`) steuern das Nicht-Powerline-
  Rendering.
- 256-Farb-Palettenindizes (`statusLine<Segment>Bg` / `statusLine<Segment>Fg`)
  steuern Powerline-Segment-Füllungen. Sie sind unabhängig von den Hex-Schlüsseln oben —
  beide müssen gesetzt werden.

```json
{
  "name": "my-theme",
  "vars": {
    "accent": "#7aa2f7",
    "muted": 244
  },
  "colors": {
    "accent": "accent",
    "chromeAccent": "accent",
    "spinnerAccent": "accent",
    "contentAccent": "muted",
    "border": "#4c566a",
    "borderAccent": "accent",
    "borderMuted": "muted",
    "success": "#9ece6a",
    "error": "#f7768e",
    "warning": "#e0af68",
    "muted": "muted",
    "dim": 240,
    "gutterSuccess": "#7dcfff",
    "gutterWarning": "#e0af68",
    "text": "",
    "thinkingText": "muted",

    "selectedBg": "#2a2f45",
    "userMessageBg": "#1f2335",
    "userMessageText": "",
    "customMessageBg": "#24283b",
    "customMessageText": "",
    "customMessageLabel": "accent",
    "toolPendingBg": "#1f2335",
    "toolSuccessBg": "#1f2d2a",
    "toolErrorBg": "#2d1f2a",
    "toolTitle": "",
    "toolOutput": "muted",

    "mdHeading": "accent",
    "mdLink": "accent",
    "mdLinkUrl": "muted",
    "mdCode": "#c0caf5",
    "mdCodeBlock": "#c0caf5",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "muted",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "accent",

    "toolDiffAdded": "#9ece6a",
    "toolDiffRemoved": "#f7768e",
    "toolDiffContext": "muted",

    "syntaxComment": "#565f89",
    "syntaxKeyword": "#bb9af7",
    "syntaxFunction": "#7aa2f7",
    "syntaxVariable": "#c0caf5",
    "syntaxString": "#9ece6a",
    "syntaxNumber": "#ff9e64",
    "syntaxType": "#2ac3de",
    "syntaxOperator": "#89ddff",
    "syntaxPunctuation": "#9aa5ce",
    "syntaxControl": "#bb9af7",

    "thinkingOff": 240,
    "thinkingMinimal": 244,
    "thinkingLow": "#7aa2f7",
    "thinkingMedium": "#2ac3de",
    "thinkingHigh": "#bb9af7",
    "thinkingXhigh": "#f7768e",

    "bashMode": "#2ac3de",
    "pythonMode": "#bb9af7",

    "statusLineBg": "#16161e",
    "statusLineSep": 240,
    "statusLineModel": "#bb9af7",
    "statusLinePath": "#7aa2f7",
    "statusLineGitClean": "#9ece6a",
    "statusLineGitDirty": "#e0af68",
    "statusLineContext": "#2ac3de",
    "statusLineSpend": "#7dcfff",
    "statusLineStaged": "#9ece6a",
    "statusLineDirty": "#e0af68",
    "statusLineUntracked": "#f7768e",
    "statusLineOutput": "#c0caf5",
    "statusLineCost": "#ff9e64",
    "statusLineSubagents": "#bb9af7",

    "statusLineOsIconBg": 7,
    "statusLineOsIconFg": 232,
    "statusLinePathBg": 4,
    "statusLinePathFg": 254,
    "statusLineGitCleanBg": 2,
    "statusLineGitCleanFg": 0,
    "statusLineGitDirtyBg": 3,
    "statusLineGitDirtyFg": 0,
    "statusLineGitStagedBg": 64,
    "statusLineGitStagedFg": 0,
    "statusLineGitUntrackedBg": 39,
    "statusLineGitUntrackedFg": 0,
    "statusLineGitConflictBg": 1,
    "statusLineGitConflictFg": 7,
    "statusLinePlanModeBg": 236,
    "statusLinePlanModeFg": 117,
    "statusLineProfileF5xcBg": "accent",
    "statusLineProfileF5xcFg": 231
  }
}
```

## Benutzerdefinierte Themes testen

Verwenden Sie diesen Workflow:

1. Starten Sie den interaktiven Modus (Watcher wird beim Start aktiviert).
2. Öffnen Sie die Einstellungen und zeigen Sie Theme-Werte in der Vorschau an (Live-`previewTheme`).
3. Bearbeiten Sie bei benutzerdefinierten Theme-Dateien das JSON während der Laufzeit und bestätigen Sie das automatische Neuladen beim Speichern.
4. Testen Sie kritische Oberflächen:
   - Markdown-Rendering
   - Werkzeugblöcke (ausstehend/erfolgreich/fehlerhaft)
   - Diff-Rendering (hinzugefügt/entfernt/Kontext)
   - Lesbarkeit der Statuszeile
   - Rahmenänderungen bei Denkstufen
   - Rahmenfarben für Bash-/Python-Modus
5. Validieren Sie beide Symbol-Voreinstellungen, wenn Ihr Theme von der Glyphenbreite/-darstellung abhängt.

## Reale Einschränkungen und Vorbehalte

- Alle `colors`-Tokens sind für benutzerdefinierte Themes erforderlich.
- `export` und `symbols` sind optional.
- `$schema` in Theme-JSON ist informativ; die Laufzeitvalidierung wird durch das kompilierte TypeBox-Schema im Code erzwungen.
- `setTheme`-Fehler fallen auf `dark` zurück; `previewTheme`-Fehler ersetzen das aktuelle Theme nicht.
- Watcher-Reload-Fehler behalten das aktuell geladene Theme bei, bis ein erfolgreiches Neuladen oder ein Fallback-Pfad ausgelöst wird.
