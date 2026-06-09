---
title: Plugin-Manager und Installer-Interna
description: >-
  Interne Funktionsweise des Plugin-Managers einschließlich Installation,
  Validierung, Abhängigkeitsauflösung und Lebenszyklusverwaltung.
sidebar:
  order: 5
  label: Plugin-Manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin-Manager und Installer-Interna

Dieses Dokument beschreibt, wie `xcsh plugin`-Operationen den Plugin-Zustand auf der Festplatte verändern und wie installierte Plugins zu Laufzeitfähigkeiten werden (heute Tools, Hooks/Commands-Pfadauflösung verfügbar).

## Umfang und Architektur

Es gibt zwei Plugin-Management-Implementierungen in der Codebasis:

1. **Aktiver Pfad, verwendet von CLI-Befehlen**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Legacy-Hilfsmodul**: Installer-Funktionen (`src/extensibility/plugins/installer.ts`)

Die Ausführung von `xcsh plugin ...`-Befehlen erfolgt über `PluginManager`.

`installer.ts` dokumentiert weiterhin wichtige Sicherheitsprüfungen und Dateisystemverhalten, ist jedoch nicht der Pfad, der von `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` verwendet wird.

## Lebenszyklus: Von der CLI-Ausführung zur Laufzeitverfügbarkeit

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
- Es existiert keine explizite `update`-Aktion; ein Update wird durch erneutes Ausführen von `install` mit einer neuen Paket-/Versionsspezifikation durchgeführt.

## Festplattenmodell

Der globale Plugin-Zustand befindet sich unter `~/.xcsh/plugins`:

- `package.json` — Abhängigkeitsmanifest, verwendet von `bun install`/`bun uninstall`
- `node_modules/` — installierte Plugin-Pakete oder Symlinks
- `xcsh-plugins.lock.json` — Laufzeitzustand:
  - aktiviert/deaktiviert pro Plugin
  - ausgewählte Feature-Menge pro Plugin
  - persistierte Plugin-Einstellungen

Projektlokale Überschreibungen befinden sich unter:

- `<cwd>/.xcsh/plugin-overrides.json`

Überschreibungen sind aus Sicht des Managers/Loaders schreibgeschützt (kein Schreibpfad hier) und können Plugins deaktivieren oder Features/Einstellungen für dieses Projekt überschreiben.

## Plugin-Spezifikationsparsing und Metadateninterpretation

## Installationsspezifikations-Grammatik

`parsePluginSpec` (`parser.ts`) unterstützt:

- `pkg` -> `features: null` (Standardverhalten)
- `pkg[*]` -> alle Manifest-Features aktivieren
- `pkg[]` -> keine optionalen Features aktivieren
- `pkg[a,b]` -> benannte Features aktivieren
- `@scope/pkg@1.2.3[feat]` -> Scoped + versioniertes Paket mit expliziter Feature-Auswahl

`extractPackageName` entfernt das Versionssuffix für die Festplattenpfad-Suche nach der Installation.

## Manifestquelle und erforderliche Felder

Das Manifest wird wie folgt aufgelöst:

1. `package.json.xcsh`
2. Fallback `package.json.pi`
3. Fallback `{ version: package.version }`

Auswirkungen:

- Es gibt keine strikte Schemavalidierung im Manager/Loader.
- Ein Paket ohne `xcsh`/`pi` ist dennoch installierbar und auflistbar.
- Das Laufzeit-Plugin-Laden (`getEnabledPlugins`) überspringt Pakete ohne `xcsh`/`pi`-Manifest.
- `manifest.version` wird immer von der Paket-`version` überschrieben.

Fehlerhaftes `package.json`-JSON führt zum harten Fehler beim Lesen; eine fehlerhafte Manifeststruktur kann erst später fehlschlagen, wenn bestimmte Felder konsumiert werden.

## Installations-/Update-Ablauf (`PluginManager.install`)

1. Feature-Klammer-Syntax aus der Installationsspezifikation parsen.
2. Paketnamen gegen Regex + Shell-Metazeichen-Sperrliste validieren.
3. Sicherstellen, dass die Plugin-`package.json` existiert (`xcsh-plugins`, private Abhängigkeitszuordnung).
4. `bun install <packageSpec>` in `~/.xcsh/plugins` ausführen.
5. Installierte Paket-`node_modules/<name>/package.json` lesen.
6. Manifest auflösen und `enabledFeatures` berechnen:
   - `[*]`: alle deklarierten Features (oder `null`, wenn keine Feature-Map vorhanden)
   - `[a,b]`: validiert, dass jedes Feature in der Manifest-Feature-Map existiert
   - `[]`: leere Feature-Liste
   - einfache Spezifikation: `null` (verwendet Standard-Richtlinie später im Loader)
7. Lockfile-Laufzeitzustand aktualisieren/einfügen: `{ version, enabledFeatures, enabled: true }`.

### Update-Semantik

Da Updates installationsgesteuert sind:

- `xcsh plugin install pkg@newVersion` aktualisiert Abhängigkeit und Lockfile-Version.
- Bestehende Einstellungen bleiben erhalten; der Zustandseintrag wird für Version/Features/Aktivierung überschrieben.
- Es existiert keine separate "Updates prüfen"- oder transaktionale Migrationslogik.

## Entfernungsablauf (`PluginManager.uninstall`)

1. Paketnamen validieren.
2. `bun uninstall <name>` im Plugin-Verzeichnis ausführen.
3. Plugin-Laufzeitzustand aus dem Lockfile entfernen:
   - `config.plugins[name]`
   - `config.settings[name]`

Wenn der Deinstallationsbefehl fehlschlägt, wird der Laufzeitzustand nicht geändert.

## Auflistungsablauf (`PluginManager.list`)

1. Plugin-Abhängigkeitszuordnung aus `~/.xcsh/plugins/package.json` lesen.
2. Lockfile-Laufzeitkonfiguration laden (fehlende Datei -> leere Standardwerte).
3. Projektüberschreibungen laden (`<cwd>/.xcsh/plugin-overrides.json`, Parse-/Lesefehler -> leeres Objekt mit Warnung).
4. Für jede Abhängigkeit mit auflösbarer package.json:
   - `InstalledPlugin`-Datensatz erstellen
   - Feature-/Aktivierungszustand zusammenführen:
     - Basis aus Lockfile (oder Standardwerte)
     - Projektüberschreibungen können Feature-Auswahl ersetzen
     - Projekt-`disabled`-Liste maskiert Plugin als deaktiviert

Dies ist der effektive Zustand, der für die CLI-Statusausgabe und Einstellungs-/Feature-Operationen verwendet wird.

## Link-Ablauf (`PluginManager.link`)

`link` unterstützt lokale Plugin-Entwicklung durch Erstellen eines Symlinks eines lokalen Pakets in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Verhalten:

1. `localPath` gegen Manager-cwd auflösen.
2. Lokale `package.json` und `name`-Feld erfordern.
3. Sicherstellen, dass Plugin-Verzeichnisse existieren.
4. Bei Scoped-Namen das Scope-Verzeichnis erstellen.
5. Vorhandenen Pfad am Ziel-Link-Speicherort entfernen.
6. Symlink erstellen.
7. Lockfile-Laufzeiteintrag als aktiviert mit Standard-Features (`null`) hinzufügen.

Einschränkung: Der aktuelle `PluginManager.link` erzwingt nicht die `cwd`-Pfadgrenzenprüfung, die im Legacy-`installer.ts` vorhanden ist (`normalizedPath.startsWith(normalizedCwd)`), sodass die Vertrauenswürdigkeit in der Verantwortung des Aufrufers liegt.

## Laufzeitladen: Vom installierten Plugin zu aufrufbaren Fähigkeiten

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

## Fähigkeitspfad-Auflösung

Für jedes aktivierte Plugin:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Jeder Resolver enthält Basiseinträge plus Feature-Einträge:

- explizite Feature-Liste -> nur ausgewählte Features
- `enabledFeatures === null` -> Features aktivieren, die als `default: true` markiert sind

Fehlende Dateien werden stillschweigend übersprungen (`existsSync`-Prüfung).

## Aktuelle Unterschiede in der Laufzeitverdrahtung

- **Tools sind heute in die Laufzeit eingebunden** über `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), das `getAllPluginToolPaths(cwd)` aufruft.
- Pfade werden bei der Custom-Tool-Erkennung durch aufgelösten absoluten Pfad dedupliziert (`seen`-Set, erster Pfad gewinnt).
- **Hooks/Commands-Resolver existieren** und sind exportiert, aber dieser Codepfad bindet sie derzeit nicht in eine Laufzeitregistrierung ein, wie es bei Tools der Fall ist.

## Lock-/Zustandsverwaltungsdetails

`PluginManager` speichert die Laufzeitkonfiguration pro Instanz im Speicher (`#runtimeConfig`) und lädt sie verzögert einmalig.

Ladeverhalten:

- Lockfile fehlt -> `{ plugins: {}, settings: {} }`
- Lockfile-Lese-/Parsefehler -> Warnung + gleiche leere Standardwerte

Speicherverhalten:

- schreibt bei jeder Mutation das vollständige Lockfile-JSON formatiert

Es existiert keine prozessübergreifende Sperrung oder Zusammenführungsstrategie; gleichzeitige Schreiber können sich gegenseitig überschreiben.

## Sicherheitsprüfungen und Vertrauensgrenzen

## Eingabe-/Paketvalidierung

Der aktive Manager-Pfad erzwingt Paketnamensvalidierung:

- Regex für Scoped/Unscoped-Paketspezifikationen (optional mit Version)
- explizite Shell-Metazeichen-Sperrliste (`[;&|`$(){}[]<>\\]`)

Dies begrenzt das Risiko von Command-Injection beim Aufrufen von `bun install/uninstall`.

## Dateisystem-Vertrauensgrenze

- Plugin-Code wird prozessintern ausgeführt, wenn Custom-Tool-Module importiert werden; keine Sandboxing-Mechanismen.
- Relative Manifest-Pfade werden mit dem Plugin-Paketverzeichnis verbunden und nur auf Existenz geprüft.
- Das Plugin-Paket selbst ist vertrauenswürdiger Code, sobald es installiert ist.

## Nur-Legacy-Installer-Prüfungen

`installer.ts` enthält zusätzliche Link-Zeit-Prüfungen, die in `PluginManager.link` nicht gespiegelt sind:

- lokaler Pfad muss innerhalb des Projekt-cwd aufgelöst werden
- zusätzliche Paketnamen-/Pfadtraversierungsschutzmaßnahmen für Symlink-Zielbenennung

Da die CLI `PluginManager` verwendet, befinden sich diese strengeren Link-Schutzmaßnahmen derzeit nicht auf dem Hauptpfad.

## Fehler-, Teilerfolgs- und Rollback-Verhalten

Der Plugin-Manager ist nicht transaktional.

| Operationsphase | Fehlerverhalten | Rollback |
| --- | --- | --- |
| `bun install` schlägt fehl | Installation bricht mit stderr ab | N/A (noch keine Zustandsschreibvorgänge) |
| Installation erfolgreich, dann schlägt Manifest-/Feature-Validierung fehl | Befehl schlägt fehl | Kein Deinstallations-Rollback; Abhängigkeit kann in `node_modules`/`package.json` verbleiben |
| Installation erfolgreich, dann schlägt Lockfile-Schreibvorgang fehl | Befehl schlägt fehl | Kein Rollback des installierten Pakets |
| `bun uninstall` erfolgreich, Lockfile-Schreibvorgang schlägt fehl | Befehl schlägt fehl | Paket entfernt, veralteter Laufzeitzustand kann verbleiben |
| `link` entfernt altes Ziel, dann schlägt Symlink-Erstellung fehl | Befehl schlägt fehl | Keine Wiederherstellung des vorherigen Links/Verzeichnisses |

Operativ kann `doctor --fix` einige Abweichungen reparieren (`bun install`, verwaiste Konfigurationsbereinigung, ungültige-Feature-Bereinigung), aber es arbeitet nach dem Best-Effort-Prinzip.

## Zusammenfassung des Verhaltens bei fehlerhaftem/fehlendem Manifest

- Fehlendes `xcsh`/`pi`-Feld:
  - install/list: toleriert (minimales Manifest)
  - Laufzeit-Erkennung aktivierter Plugins: als Nicht-Plugin übersprungen
- Fehlendes Feature, referenziert durch Installationsspezifikation oder `features --set/--enable`: harter Fehler mit verfügbarer Feature-Liste
- Ungültige `plugin-overrides.json`: ignoriert mit Fallback auf `{}` sowohl im Manager- als auch im Loader-Pfad
- Fehlende Tool-/Hook-/Command-Dateipfade, referenziert durch Manifest: stillschweigend ignoriert während der Resolver-Erweiterung; nur von `doctor` als Fehler markiert

## Modusunterschiede und Vorrangregeln

- `--dry-run` (install): gibt synthetisches Installationsergebnis zurück, keine Dateisystem-/Netzwerk-/Zustandsschreibvorgänge.
- `--json`: nur Ausgabeformatierung, keine Verhaltensänderung.
- Projektüberschreibungen haben immer Vorrang vor dem globalen Lockfile für die Feature-/Einstellungsansicht.
- Effektive Aktivierung ist `runtimeEnabled && !projectDisabled`.

## Implementierungsdateien

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI-Befehlsdeklaration und Flag-Zuordnung
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Aktionsdispatch, benutzerseitige Befehlshandler
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — aktive Install/Remove/List/Link/State/Doctor-Implementierung
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — Legacy-Installer-Hilfsfunktionen und zusätzliche Link-Sicherheitsprüfungen
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Erkennung aktivierter Plugins und Tool-/Hook-/Command-Pfadauflösung
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Installationsspezifikations- und Paketnamen-Parsing-Hilfsfunktionen
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Manifest-/Laufzeit-/Überschreibungs-Typverträge
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Laufzeitverdrahtung für Plugin-bereitgestellte Tool-Module
