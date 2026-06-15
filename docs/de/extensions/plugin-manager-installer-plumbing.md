---
title: Plugin-Manager und Installer-Mechanismen
description: >-
  Interna des Plugin-Managers zu Installation, Validierung,
  Abhängigkeitsauflösung und Lebenszyklusverwaltung.
sidebar:
  order: 5
  label: Plugin-Manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin-Manager und Installer-Mechanismen

Dieses Dokument beschreibt, wie `xcsh plugin`-Operationen den Plugin-Zustand auf der Festplatte verändern und wie installierte Plugins zu Laufzeitfähigkeiten werden (heute Werkzeuge, Hooks/Commands-Pfadauflösung verfügbar).

## Umfang und Architektur

Es gibt zwei Plugin-Management-Implementierungen im Codebase:

1. **Aktiver Pfad für CLI-Befehle**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Veraltetes Hilfsmodul**: Installer-Funktionen (`src/extensibility/plugins/installer.ts`)

Die Ausführung von `xcsh plugin ...`-Befehlen erfolgt über `PluginManager`.

`installer.ts` dokumentiert weiterhin wichtige Sicherheitsprüfungen und Dateisystemverhalten, ist jedoch nicht der Pfad, der von `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` verwendet wird.

## Lebenszyklus: von der CLI-Aufrufung bis zur Laufzeitverfügbarkeit

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### Befehls-Einstiegspunkte

- `src/commands/plugin.ts` definiert Befehle/Flags und leitet an `runPluginCommand` weiter.
- `src/cli/plugin-cli.ts` ordnet Unterbefehle den `PluginManager`-Methoden zu:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Es existiert keine explizite `update`-Aktion; eine Aktualisierung erfolgt durch erneutes Ausführen von `install` mit einem neuen Paket-/Versionsspezifikation.

## Modell auf der Festplatte

Der globale Plugin-Zustand liegt unter `~/.xcsh/plugins`:

- `package.json` — Abhängigkeitsmanifest, das von `bun install`/`bun uninstall` verwendet wird
- `node_modules/` — installierte Plugin-Pakete oder Symlinks
- `xcsh-plugins.lock.json` — Laufzeitzustand:
  - pro Plugin aktiviert/deaktiviert
  - ausgewählte Feature-Menge pro Plugin
  - persistente Plugin-Einstellungen

Projektlokale Überschreibungen befinden sich unter:

- `<cwd>/.xcsh/plugin-overrides.json`

Überschreibungen sind aus der Perspektive von Manager/Loader schreibgeschützt (kein Schreibpfad vorhanden) und können Plugins deaktivieren oder Features/Einstellungen für dieses Projekt überschreiben.

## Analyse der Plugin-Spezifikation und Interpretation von Metadaten

## Grammatik der Install-Spezifikation

`parsePluginSpec` (`parser.ts`) unterstützt:

- `pkg` -> `features: null` (Standardverhalten)
- `pkg[*]` -> alle Manifest-Features aktivieren
- `pkg[]` -> keine optionalen Features aktivieren
- `pkg[a,b]` -> benannte Features aktivieren
- `@scope/pkg@1.2.3[feat]` -> Scoped + versioniertes Paket mit expliziter Feature-Auswahl

`extractPackageName` entfernt das Versionssuffix für die Pfadsuche auf der Festplatte nach der Installation.

## Manifestquelle und erforderliche Felder

Das Manifest wird wie folgt aufgelöst:

1. `package.json.xcsh`
2. Fallback `package.json.pi`
3. Fallback `{ version: package.version }`

Implikationen:

- Es gibt keine strikte Schemavalidierung im Manager/Loader.
- Ein Paket ohne `xcsh`/`pi` ist weiterhin installierbar und auflistbar.
- Das Laden von Laufzeit-Plugins (`getEnabledPlugins`) überspringt Pakete ohne `xcsh`/`pi`-Manifest.
- `manifest.version` wird immer aus der Paket-`version` überschrieben.

Ein fehlerhaftes `package.json`-JSON ist ein harter Fehler beim Lesen; eine fehlerhafte Manifeststruktur kann später erst dann fehlschlagen, wenn bestimmte Felder verwendet werden.

## Installations-/Aktualisierungsablauf (`PluginManager.install`)

1. Feature-Klammernsyntax aus der Install-Spezifikation analysieren.
2. Paketnamen gegen Regex + Denylist für Shell-Metazeichen validieren.
3. Sicherstellen, dass `package.json` des Plugins vorhanden ist (`xcsh-plugins`, private Abhängigkeitszuordnung).
4. `bun install <packageSpec>` in `~/.xcsh/plugins` ausführen.
5. `node_modules/<name>/package.json` des installierten Pakets lesen.
6. Manifest auflösen und `enabledFeatures` berechnen:
   - `[*]`: alle deklarierten Features (oder `null`, wenn keine Feature-Zuordnung vorhanden)
   - `[a,b]`: validiert, ob jedes Feature in der Manifest-Feature-Zuordnung existiert
   - `[]`: leere Feature-Liste
   - bare Spezifikation: `null` (Standardrichtlinie später im Loader verwenden)
7. Laufzeitzustand der Lockdatei aktualisieren (Upsert): `{ version, enabledFeatures, enabled: true }`.

### Aktualisierungssemantik

Da die Aktualisierung installationsgesteuert ist:

- `xcsh plugin install pkg@newVersion` aktualisiert die Abhängigkeit und die Lockdatei-Version.
- Bestehende Einstellungen bleiben erhalten; der Zustandseintrag wird für Version/Features/Aktiviert überschrieben.
- Es gibt keine separate Logik zum „Prüfen auf Updates" oder zur transaktionalen Migration.

## Entfernungsablauf (`PluginManager.uninstall`)

1. Paketnamen validieren.
2. `bun uninstall <name>` im Plugin-Verzeichnis ausführen.
3. Plugin-Laufzeitzustand aus der Lockdatei entfernen:
   - `config.plugins[name]`
   - `config.settings[name]`

Schlägt der Uninstall-Befehl fehl, wird der Laufzeitzustand nicht geändert.

## Auflistungsablauf (`PluginManager.list`)

1. Plugin-Abhängigkeitszuordnung aus `~/.xcsh/plugins/package.json` lesen.
2. Laufzeit-Konfiguration der Lockdatei laden (fehlende Datei -> leere Standards).
3. Projektüberschreibungen laden (`<cwd>/.xcsh/plugin-overrides.json`, Parse-/Lesefehler -> leeres Objekt mit Warnung).
4. Für jede Abhängigkeit mit einer auflösbaren `package.json`:
   - `InstalledPlugin`-Datensatz erstellen
   - Feature-/Aktivierungszustand zusammenführen:
     - Basis aus Lockdatei (oder Standards)
     - Projektüberschreibungen können die Feature-Auswahl ersetzen
     - Projektliste `disabled` markiert Plugin als deaktiviert

Dies ist der effektive Zustand, der von der CLI-Statusausgabe und den Einstellungs-/Feature-Operationen verwendet wird.

## Link-Ablauf (`PluginManager.link`)

`link` unterstützt die lokale Plugin-Entwicklung, indem ein lokales Paket als Symlink in `~/.xcsh/plugins/node_modules/<pkg.name>` eingebunden wird.

Verhalten:

1. `localPath` gegen Manager-cwd auflösen.
2. Lokale `package.json` und `name`-Feld voraussetzen.
3. Sicherstellen, dass Plugin-Verzeichnisse vorhanden sind.
4. Bei scoped Namen das Scope-Verzeichnis erstellen.
5. Vorhandenen Pfad am Ziel-Link-Ort entfernen.
6. Symlink erstellen.
7. Laufzeit-Lockdatei-Eintrag als aktiviert mit Standard-Features hinzufügen (`null`).

Hinweis: Das aktuelle `PluginManager.link` erzwingt nicht die im alten `installer.ts` vorhandene Cwd-Pfadgrenzenprüfung (`normalizedPath.startsWith(normalizedCwd)`), daher liegt die Vertrauensverantwortung beim Aufrufer.

## Laufzeit-Laden: vom installierten Plugin zu aufrufbaren Fähigkeiten

## Erkennungsfilter

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) liest:

- Plugin-Abhängigkeitsmanifest (`package.json`)
- Laufzeitzustand der Lockdatei
- Projektüberschreibungen über `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filterung:

- überspringen, wenn kein Plugin-`package.json` vorhanden
- überspringen, wenn Manifest (`xcsh`/`pi`) fehlt
- überspringen, wenn in Lockdatei global deaktiviert
- überspringen, wenn im Projekt deaktiviert

## Fähigkeits-Pfadauflösung

Für jedes aktivierte Plugin:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Jeder Resolver enthält Basiseinträge sowie Feature-Einträge:

- explizite Feature-Liste -> nur ausgewählte Features
- `enabledFeatures === null` -> Features aktivieren, die mit `default: true` markiert sind

Fehlende Dateien werden stillschweigend übersprungen (`existsSync`-Prüfung).

## Aktuelle Unterschiede bei der Laufzeit-Verkabelung

- **Werkzeuge sind heute in die Laufzeit eingebunden** über `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), das `getAllPluginToolPaths(cwd)` aufruft.
- Pfade werden bei der Erkennung benutzerdefinierter Werkzeuge anhand des aufgelösten absoluten Pfads dedupliziert (`seen`-Menge, erster Pfad gewinnt).
- **Hooks/Commands-Resolver existieren** und werden exportiert, aber dieser Codepfad verdrahtet sie derzeit nicht auf dieselbe Weise in eine Laufzeit-Registry wie Werkzeuge.

## Details zur Sperr-/Zustandsverwaltung

`PluginManager` speichert die Laufzeit-Konfiguration pro Instanz im Speicher (`#runtimeConfig`) und lädt sie verzögert einmalig.

Ladeverhalten:

- Lockdatei fehlt -> `{ plugins: {}, settings: {} }`
- Lockdatei-Lese-/Parse-Fehler -> Warnung + dieselben leeren Standards

Speicherverhalten:

- schreibt bei jeder Mutation die vollständige Lockdatei-JSON mit Einrückung

Es gibt keine prozessübergreifende Sperrung oder Zusammenführungsstrategie; gleichzeitige Schreiber können sich gegenseitig überschreiben.

## Sicherheitsprüfungen und Vertrauensgrenzen

## Eingabe-/Paketvalidierung

Der aktive Manager-Pfad erzwingt die Paketnamen-Validierung:

- Regex für scoped/unscoped Paketspezifikationen (optional mit Version)
- explizite Denylist für Shell-Metazeichen (`[;&|`$(){}[]<>\\]`)

Dies begrenzt das Risiko von Command-Injection beim Aufrufen von `bun install/uninstall`.

## Dateisystem-Vertrauensgrenze

- Plugin-Code wird in-process ausgeführt, wenn benutzerdefinierte Werkzeug-Module importiert werden; keine Sandbox.
- Relative Pfade im Manifest werden gegen das Plugin-Paketverzeichnis verknüpft und nur auf Existenz geprüft.
- Das Plugin-Paket selbst ist nach der Installation vertrauenswürdiger Code.

## Nur im alten Installer vorhandene Prüfungen

`installer.ts` enthält zusätzliche Link-Zeitprüfungen, die nicht im `PluginManager.link` gespiegelt sind:

- Lokaler Pfad muss innerhalb des Projekt-Cwd aufgelöst werden
- Zusätzliche Paketnamen-/Pfaddurchquerungsschutzmaßnahmen für die Benennung von Symlink-Zielen

Da die CLI `PluginManager` verwendet, sind diese strengeren Link-Prüfungen derzeit nicht auf dem Hauptpfad.

## Fehler-, Teilerfolgs- und Rollback-Verhalten

Der Plugin-Manager ist nicht transaktional.

| Operationsphase | Fehlerverhalten | Rollback |
| --- | --- | --- |
| `bun install` schlägt fehl | Installation bricht mit stderr ab | N/A (noch keine Zustandsschreibvorgänge) |
| Installation erfolgreich, dann Manifest-/Feature-Validierung schlägt fehl | Befehl schlägt fehl | Kein Uninstall-Rollback; Abhängigkeit kann in `node_modules`/`package.json` verbleiben |
| Installation erfolgreich, dann Schreiben der Lockdatei schlägt fehl | Befehl schlägt fehl | Kein Rollback des installierten Pakets |
| `bun uninstall` erfolgreich, Schreiben der Lockdatei schlägt fehl | Befehl schlägt fehl | Paket entfernt, veralteter Laufzeitzustand kann verbleiben |
| `link` entfernt altes Ziel, dann schlägt Symlink-Erstellung fehl | Befehl schlägt fehl | Keine Wiederherstellung des vorherigen Links/Verzeichnisses |

In der Praxis kann `doctor --fix` einige Abweichungen beheben (`bun install`, Bereinigung verwaister Konfigurationen, Bereinigung ungültiger Features), dies geschieht jedoch nach bestem Bemühen.

## Zusammenfassung des Verhaltens bei fehlerhaftem/fehlendem Manifest

- Fehlendes `xcsh`/`pi`-Feld:
  - Installieren/Auflisten: toleriert (minimales Manifest)
  - Laufzeit-Erkennung aktivierter Plugins: als Nicht-Plugin übersprungen
- Fehlendes Feature, das durch Install-Spezifikation oder `features --set/--enable` referenziert wird: harter Fehler mit Liste verfügbarer Features
- Ungültige `plugin-overrides.json`: ignoriert mit Fallback auf `{}` in Manager- und Loader-Pfaden
- Fehlende Werkzeug-/Hook-/Befehlsdatei-Pfade, die durch das Manifest referenziert werden: während der Resolver-Expansion stillschweigend ignoriert; nur von `doctor` als Fehler markiert

## Modusunterschiede und Vorrang

- `--dry-run` (install): gibt synthetisches Installationsergebnis zurück, keine Dateisystem-/Netzwerk-/Zustandsschreibvorgänge.
- `--json`: nur Ausgabeformatierung, keine Verhaltensänderung.
- Projektüberschreibungen haben immer Vorrang vor der globalen Lockdatei für die Feature-/Einstellungsansicht.
- Effektive Aktivierung ist `runtimeEnabled && !projectDisabled`.

## Implementierungsdateien

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI-Befehlsdeklaration und Flag-Zuordnung
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Aktionsverteilung, benutzerseitige Befehlshandler
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — aktive Implementierung von Installieren/Entfernen/Auflisten/Verknüpfen/Zustand/Doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — veraltete Installer-Hilfsfunktionen und zusätzliche Link-Sicherheitsprüfungen
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Erkennung aktivierter Plugins und Pfadauflösung für Werkzeuge/Hooks/Befehle
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Hilfsfunktionen zur Analyse von Install-Spezifikationen und Paketnamen
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Typverträge für Manifest/Laufzeit/Überschreibungen
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Laufzeit-Verkabelung für von Plugins bereitgestellte Werkzeug-Module
