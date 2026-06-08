---
title: Plugin Manager and Installer Plumbing
description: >-
  Interne Funktionsweise des Plugin-Managers einschließlich Installation,
  Validierung, Abhängigkeitsauflösung und Lifecycle-Management.
sidebar:
  order: 5
  label: Plugin-Manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin-Manager und Installer-Infrastruktur

Dieses Dokument beschreibt, wie `xcsh plugin`-Operationen den Plugin-Zustand auf der Festplatte verändern und wie installierte Plugins zu Laufzeitfähigkeiten werden (aktuell Tools, Hooks/Commands-Pfadauflösung verfügbar).

## Umfang und Architektur

Es gibt zwei Plugin-Management-Implementierungen in der Codebasis:

1. **Aktiver Pfad, der von CLI-Befehlen verwendet wird**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Legacy-Hilfsmodul**: Installer-Funktionen (`src/extensibility/plugins/installer.ts`)

Die Ausführung von `xcsh plugin ...`-Befehlen erfolgt über den `PluginManager`.

`installer.ts` dokumentiert weiterhin wichtige Sicherheitsprüfungen und Dateisystemverhalten, ist jedoch nicht der Pfad, der von `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` verwendet wird.

## Lifecycle: Von der CLI-Ausführung zur Laufzeitverfügbarkeit

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

### Befehlseinstiegspunkte

- `src/commands/plugin.ts` definiert Befehle/Flags und leitet an `runPluginCommand` weiter.
- `src/cli/plugin-cli.ts` ordnet Unterbefehle den `PluginManager`-Methoden zu:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Es gibt keine explizite `update`-Aktion; ein Update erfolgt durch erneutes Ausführen von `install` mit einer neuen Paket-/Versionsspezifikation.

## On-Disk-Modell

Der globale Plugin-Zustand befindet sich unter `~/.xcsh/plugins`:

- `package.json` — Abhängigkeitsmanifest, das von `bun install`/`bun uninstall` verwendet wird
- `node_modules/` — installierte Plugin-Pakete oder Symlinks
- `xcsh-plugins.lock.json` — Laufzeitzustand:
  - aktiviert/deaktiviert pro Plugin
  - ausgewählte Feature-Menge pro Plugin
  - persistierte Plugin-Einstellungen

Projektlokale Überschreibungen befinden sich unter:

- `<cwd>/.xcsh/plugin-overrides.json`

Überschreibungen sind aus Manager-/Loader-Perspektive schreibgeschützt (kein Schreibpfad hier) und können Plugins deaktivieren oder Features/Einstellungen für dieses Projekt überschreiben.

## Plugin-Spezifikations-Parsing und Metadateninterpretation

## Installationsspezifikations-Grammatik

`parsePluginSpec` (`parser.ts`) unterstützt:

- `pkg` -> `features: null` (Standardverhalten)
- `pkg[*]` -> alle Manifest-Features aktivieren
- `pkg[]` -> keine optionalen Features aktivieren
- `pkg[a,b]` -> benannte Features aktivieren
- `@scope/pkg@1.2.3[feat]` -> Paket mit Scope + Version und expliziter Feature-Auswahl

`extractPackageName` entfernt das Versionssuffix für die On-Disk-Pfadsuche nach der Installation.

## Manifestquelle und erforderliche Felder

Das Manifest wird wie folgt aufgelöst:

1. `package.json.xcsh`
2. Fallback `package.json.pi`
3. Fallback `{ version: package.version }`

Auswirkungen:

- Es gibt keine strikte Schemavalidierung im Manager/Loader.
- Ein Paket ohne `xcsh`/`pi` ist dennoch installierbar und auflistbar.
- Das Laufzeit-Plugin-Laden (`getEnabledPlugins`) überspringt Pakete ohne `xcsh`/`pi`-Manifest.
- `manifest.version` wird immer mit der Paket-`version` überschrieben.

Fehlerhaftes `package.json`-JSON führt zu einem harten Fehler beim Lesen; eine fehlerhafte Manifeststruktur kann erst später fehlschlagen, wenn bestimmte Felder konsumiert werden.

## Installations-/Update-Ablauf (`PluginManager.install`)

1. Feature-Klammer-Syntax aus der Installationsspezifikation parsen.
2. Paketnamen gegen Regex + Shell-Metazeichen-Sperrliste validieren.
3. Sicherstellen, dass die Plugin-`package.json` existiert (`xcsh-plugins`, private Abhängigkeitsmap).
4. `bun install <packageSpec>` in `~/.xcsh/plugins` ausführen.
5. Installierte Paket-`node_modules/<name>/package.json` lesen.
6. Manifest auflösen und `enabledFeatures` berechnen:
   - `[*]`: alle deklarierten Features (oder `null`, wenn keine Feature-Map vorhanden)
   - `[a,b]`: validiert, dass jedes Feature in der Manifest-Feature-Map existiert
   - `[]`: leere Feature-Liste
   - nackte Spezifikation: `null` (Standardrichtlinie wird später im Loader verwendet)
7. Lockfile-Laufzeitzustand upserten: `{ version, enabledFeatures, enabled: true }`.

### Update-Semantik

Da das Update installationsgesteuert ist:

- `xcsh plugin install pkg@newVersion` aktualisiert Abhängigkeit und Lockfile-Version.
- Bestehende Einstellungen bleiben erhalten; der Zustandseintrag wird für Version/Features/Aktivierung überschrieben.
- Es gibt keine separate "Updates prüfen"-Logik oder transaktionale Migrationslogik.

## Entfernungs-Ablauf (`PluginManager.uninstall`)

1. Paketnamen validieren.
2. `bun uninstall <name>` im Plugin-Verzeichnis ausführen.
3. Plugin-Laufzeitzustand aus dem Lockfile entfernen:
   - `config.plugins[name]`
   - `config.settings[name]`

Wenn der Deinstallationsbefehl fehlschlägt, wird der Laufzeitzustand nicht geändert.

## Auflistungs-Ablauf (`PluginManager.list`)

1. Plugin-Abhängigkeitsmap aus `~/.xcsh/plugins/package.json` lesen.
2. Lockfile-Laufzeitkonfiguration laden (fehlende Datei -> leere Standardwerte).
3. Projektüberschreibungen laden (`<cwd>/.xcsh/plugin-overrides.json`, Parse-/Lesefehler -> leeres Objekt mit Warnung).
4. Für jede Abhängigkeit mit einer auflösbaren package.json:
   - `InstalledPlugin`-Datensatz erstellen
   - Feature-/Aktivierungszustand zusammenführen:
     - Basis aus dem Lockfile (oder Standardwerte)
     - Projektüberschreibungen können die Feature-Auswahl ersetzen
     - Projekt-`disabled`-Liste maskiert Plugin als deaktiviert

Dies ist der effektive Zustand, der für die CLI-Statusausgabe und Einstellungs-/Feature-Operationen verwendet wird.

## Link-Ablauf (`PluginManager.link`)

`link` unterstützt die lokale Plugin-Entwicklung durch Symlinking eines lokalen Pakets nach `~/.xcsh/plugins/node_modules/<pkg.name>`.

Verhalten:

1. `localPath` gegen das Manager-cwd auflösen.
2. Lokale `package.json` und `name`-Feld erfordern.
3. Sicherstellen, dass Plugin-Verzeichnisse existieren.
4. Für Scope-Namen das Scope-Verzeichnis erstellen.
5. Bestehenden Pfad am Ziel-Link-Ort entfernen.
6. Symlink erstellen.
7. Lockfile-Laufzeiteintrag als aktiviert mit Standard-Features (`null`) hinzufügen.

Einschränkung: Der aktuelle `PluginManager.link` erzwingt nicht die `cwd`-Pfadgrenzenprüfung, die im Legacy-`installer.ts` vorhanden ist (`normalizedPath.startsWith(normalizedCwd)`), daher liegt die Vertrauenswürdigkeit in der Verantwortung des Aufrufers.

## Laufzeit-Laden: Vom installierten Plugin zu aufrufbaren Fähigkeiten

## Discovery-Gate

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) liest:

- Plugin-Abhängigkeitsmanifest (`package.json`)
- Lockfile-Laufzeitzustand
- Projektüberschreibungen über `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filterung:

- überspringen, wenn keine Plugin-package.json vorhanden
- überspringen, wenn Manifest (`xcsh`/`pi`) fehlt
- überspringen, wenn global im Lockfile deaktiviert
- überspringen, wenn projektdeaktiviert

## Fähigkeits-Pfadauflösung

Für jedes aktivierte Plugin:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Jeder Resolver enthält Basiseinträge plus Feature-Einträge:

- explizite Feature-Liste -> nur ausgewählte Features
- `enabledFeatures === null` -> Features aktivieren, die mit `default: true` markiert sind

Fehlende Dateien werden stillschweigend übersprungen (`existsSync`-Prüfung).

## Aktuelle Unterschiede in der Laufzeitverdrahtung

- **Tools sind heute in die Laufzeit eingebunden** über `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), das `getAllPluginToolPaths(cwd)` aufruft.
- Pfade werden durch aufgelösten absoluten Pfad in der Custom-Tool-Discovery dedupliziert (`seen`-Set, erster Pfad gewinnt).
- **Hooks/Commands-Resolver existieren** und sind exportiert, aber dieser Codepfad verdrahtet sie derzeit nicht in eine Laufzeit-Registry auf die gleiche Weise wie Tools verdrahtet werden.

## Lock-/Zustandsverwaltungsdetails

`PluginManager` cached die Laufzeitkonfiguration pro Instanz im Speicher (`#runtimeConfig`) und lädt sie einmalig verzögert.

Ladeverhalten:

- Lockfile fehlt -> `{ plugins: {}, settings: {} }`
- Lockfile-Lese-/Parse-Fehler -> Warnung + gleiche leere Standardwerte

Speicherverhalten:

- schreibt das vollständige Lockfile-JSON bei jeder Mutation formatiert

Es gibt keine prozessübergreifende Sperrung oder Merge-Strategie; gleichzeitige Schreiber können sich gegenseitig überschreiben.

## Sicherheitsprüfungen und Vertrauensgrenzen

## Eingabe-/Paketvalidierung

Der aktive Manager-Pfad erzwingt die Paketnamen-Validierung:

- Regex für Paketspezifikationen mit und ohne Scope (optional mit Version)
- explizite Shell-Metazeichen-Sperrliste (`[;&|`$(){}[]<>\\]`)

Dies begrenzt das Risiko von Command-Injection beim Aufrufen von `bun install/uninstall`.

## Dateisystem-Vertrauensgrenze

- Plugin-Code wird im Prozess ausgeführt, wenn Custom-Tool-Module importiert werden; kein Sandboxing.
- Relative Manifest-Pfade werden mit dem Plugin-Paketverzeichnis verbunden und nur auf Existenz geprüft.
- Das Plugin-Paket selbst ist nach der Installation vertrauenswürdiger Code.

## Nur im Legacy-Installer vorhandene Prüfungen

`installer.ts` enthält zusätzliche Link-Zeit-Prüfungen, die nicht im `PluginManager.link` gespiegelt sind:

- lokaler Pfad muss innerhalb des Projekt-cwd aufgelöst werden
- zusätzliche Paketnamen-/Pfad-Traversal-Schutzmaßnahmen für Symlink-Zielbenennung

Da das CLI den `PluginManager` verwendet, befinden sich diese strengeren Link-Schutzmaßnahmen derzeit nicht auf dem Hauptpfad.

## Fehler, Teilerfolg und Rollback-Verhalten

Der Plugin-Manager ist nicht transaktional.

| Operationsphase | Fehlerverhalten | Rollback |
| --- | --- | --- |
| `bun install` schlägt fehl | Installation bricht mit stderr ab | N/A (noch keine Zustandsschreibvorgänge) |
| Installation erfolgreich, dann schlägt Manifest-/Feature-Validierung fehl | Befehl schlägt fehl | Kein Deinstallations-Rollback; Abhängigkeit kann in `node_modules`/`package.json` verbleiben |
| Installation erfolgreich, dann schlägt Lockfile-Schreibvorgang fehl | Befehl schlägt fehl | Kein Rollback des installierten Pakets |
| `bun uninstall` erfolgreich, Lockfile-Schreibvorgang schlägt fehl | Befehl schlägt fehl | Paket entfernt, veralteter Laufzeitzustand kann verbleiben |
| `link` entfernt altes Ziel, dann schlägt Symlink-Erstellung fehl | Befehl schlägt fehl | Keine Wiederherstellung des vorherigen Links/Verzeichnisses |

Operativ kann `doctor --fix` einige Abweichungen reparieren (`bun install`, verwaiste Konfigurationsbereinigung, ungültige Feature-Bereinigung), ist aber bestmöglich.

## Zusammenfassung des Verhaltens bei fehlerhaftem/fehlendem Manifest

- Fehlendes `xcsh`/`pi`-Feld:
  - install/list: toleriert (minimales Manifest)
  - Laufzeit-Enabled-Plugin-Discovery: als Nicht-Plugin übersprungen
- Fehlendes Feature, das von der Installationsspezifikation oder `features --set/--enable` referenziert wird: harter Fehler mit verfügbarer Feature-Liste
- Ungültige `plugin-overrides.json`: ignoriert mit Fallback auf `{}` sowohl im Manager- als auch im Loader-Pfad
- Fehlende Tool-/Hook-/Command-Dateipfade, die vom Manifest referenziert werden: stillschweigend ignoriert während der Resolver-Expansion; nur von `doctor` als Fehler markiert

## Modusunterschiede und Vorrang

- `--dry-run` (install): gibt ein synthetisches Installationsergebnis zurück, keine Dateisystem-/Netzwerk-/Zustandsschreibvorgänge.
- `--json`: nur Ausgabeformatierung, keine Verhaltensänderung.
- Projektüberschreibungen haben immer Vorrang vor dem globalen Lockfile für die Feature-/Einstellungsansicht.
- Die effektive Aktivierung ist `runtimeEnabled && !projectDisabled`.

## Implementierungsdateien

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI-Befehlsdeklaration und Flag-Zuordnung
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Aktionsverteilung, benutzerorientierte Befehlshandler
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — aktive Implementierung für Install/Remove/List/Link/State/Doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — Legacy-Installer-Hilfsfunktionen und zusätzliche Link-Sicherheitsprüfungen
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Enabled-Plugin-Discovery und Tool-/Hook-/Command-Pfadauflösung
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Installationsspezifikations- und Paketnamen-Parsing-Hilfsfunktionen
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Manifest-/Laufzeit-/Override-Typverträge
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Laufzeitverdrahtung für Plugin-bereitgestellte Tool-Module
