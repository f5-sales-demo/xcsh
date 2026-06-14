---
title: Plugin-Manager und Installer-Interna
description: >-
  Plugin-Manager-Interna zur Installation, Validierung, Abhängigkeitsauflösung
  und Lebenszyklusverwaltung.
sidebar:
  order: 5
  label: Plugin-Manager
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Plugin-Manager und Installer-Interna

Dieses Dokument beschreibt, wie `xcsh plugin`-Operationen den Plugin-Zustand auf der Festplatte verändern und wie installierte Plugins zu Laufzeitfähigkeiten werden (heute Werkzeuge, Hooks/Befehle-Pfadauflösung verfügbar).

## Umfang und Architektur

Es gibt zwei Plugin-Verwaltungsimplementierungen in der Codebasis:

1. **Aktiver Pfad für CLI-Befehle**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Veraltetes Hilfsmodul**: Installer-Funktionen (`src/extensibility/plugins/installer.ts`)

Die Ausführung von `xcsh plugin ...`-Befehlen erfolgt über `PluginManager`.

`installer.ts` dokumentiert weiterhin wichtige Sicherheitsprüfungen und Dateisystemverhalten, ist jedoch nicht der Pfad, der von `src/commands/plugin.ts` + `src/cli/plugin-cli.ts` verwendet wird.

## Lebenszyklus: Von der CLI-Aufrufung bis zur Laufzeitverfügbarkeit

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
- `src/cli/plugin-cli.ts` ordnet Unterbefehle `PluginManager`-Methoden zu:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- Es gibt keine explizite `update`-Aktion; die Aktualisierung erfolgt durch erneutes Ausführen von `install` mit einer neuen Paket-/Versionsspezifikation.

## Modell auf der Festplatte

Der globale Plugin-Zustand befindet sich unter `~/.xcsh/plugins`:

- `package.json` — Abhängigkeitsmanifest, das von `bun install`/`bun uninstall` verwendet wird
- `node_modules/` — installierte Plugin-Pakete oder Symlinks
- `xcsh-plugins.lock.json` — Laufzeitzustand:
  - aktiviert/deaktiviert pro Plugin
  - ausgewählter Feature-Satz pro Plugin
  - persistierte Plugin-Einstellungen

Projektspezifische Überschreibungen befinden sich unter:

- `<cwd>/.xcsh/plugin-overrides.json`

Überschreibungen sind aus der Manager-/Loader-Perspektive schreibgeschützt (kein Schreibpfad hier) und können Plugins deaktivieren oder Features/Einstellungen für dieses Projekt überschreiben.

## Plugin-Spezifikationsanalyse und Metadateninterpretation

## Grammatik der Installationsspezifikation

`parsePluginSpec` (`parser.ts`) unterstützt:

- `pkg` -> `features: null` (Standardverhalten)
- `pkg[*]` -> alle Manifest-Features aktivieren
- `pkg[]` -> keine optionalen Features aktivieren
- `pkg[a,b]` -> benannte Features aktivieren
- `@scope/pkg@1.2.3[feat]` -> Scoped + versioniertes Paket mit expliziter Feature-Auswahl

`extractPackageName` entfernt das Versionssuffix für die Pfadsuche auf der Festplatte nach der Installation.

## Manifestquelle und erforderliche Felder

Das Manifest wird folgendermaßen aufgelöst:

1. `package.json.xcsh`
2. Fallback `package.json.pi`
3. Fallback `{ version: package.version }`

Implikationen:

- Es gibt keine strikte Schemavalidierung im Manager/Loader.
- Ein Paket ohne `xcsh`/`pi` ist dennoch installierbar und auflistbar.
- Das Laden von Laufzeit-Plugins (`getEnabledPlugins`) überspringt Pakete ohne `xcsh`/`pi`-Manifest.
- `manifest.version` wird stets aus der Paket-`version` überschrieben.

Fehlerhaftes `package.json`-JSON ist ein schwerwiegender Fehler zum Lesezeitpunkt; eine fehlerhafte Manifestform kann erst später scheitern, wenn bestimmte Felder verwendet werden.

## Installations-/Aktualisierungsablauf (`PluginManager.install`)

1. Feature-Klammernsyntax aus der Installationsspezifikation analysieren.
2. Paketnamen gegen Regex + Shell-Metazeichen-Sperrliste validieren.
3. Sicherstellen, dass `package.json` des Plugins vorhanden ist (`xcsh-plugins`, private Abhängigkeitszuordnung).
4. `bun install <packageSpec>` in `~/.xcsh/plugins` ausführen.
5. Installiertes Paket `node_modules/<name>/package.json` lesen.
6. Manifest auflösen und `enabledFeatures` berechnen:
   - `[*]`: alle deklarierten Features (oder `null`, wenn keine Feature-Zuordnung vorhanden)
   - `[a,b]`: jedes Feature in der Manifest-Feature-Zuordnung validieren
   - `[]`: leere Feature-Liste
   - Bare-Spezifikation: `null` (später im Loader Standardrichtlinie verwenden)
7. Lockfile-Laufzeitzustand upserten: `{ version, enabledFeatures, enabled: true }`.

### Aktualisierungssemantik

Da die Aktualisierung installationsgesteuert ist:

- `xcsh plugin install pkg@newVersion` aktualisiert die Abhängigkeit und die Lockfile-Version.
- Bestehende Einstellungen bleiben erhalten; der Zustandseintrag wird für Version/Features/Aktiviert überschrieben.
- Es gibt keine separate Logik für „Updates prüfen" oder transaktionale Migration.

## Entfernungsablauf (`PluginManager.uninstall`)

1. Paketnamen validieren.
2. `bun uninstall <name>` im Plugin-Verzeichnis ausführen.
3. Plugin-Laufzeitzustand aus der Lockfile entfernen:
   - `config.plugins[name]`
   - `config.settings[name]`

Wenn der Deinstallationsbefehl fehlschlägt, wird der Laufzeitzustand nicht geändert.

## Auflistungsablauf (`PluginManager.list`)

1. Plugin-Abhängigkeitszuordnung aus `~/.xcsh/plugins/package.json` lesen.
2. Lockfile-Laufzeitkonfiguration laden (fehlende Datei -> leere Standardwerte).
3. Projektüberschreibungen laden (`<cwd>/.xcsh/plugin-overrides.json`, Analyse-/Lesefehler -> leeres Objekt mit Warnung).
4. Für jede Abhängigkeit mit einer auflösbaren package.json:
   - `InstalledPlugin`-Datensatz erstellen
   - Feature-/Aktivierungszustand zusammenführen:
     - Basis aus Lockfile (oder Standardwerte)
     - Projektüberschreibungen können die Feature-Auswahl ersetzen
     - Projektliste `disabled` maskiert Plugin als deaktiviert

Dies ist der effektive Zustand, der von der CLI-Statusausgabe und den Einstellungs-/Feature-Operationen verwendet wird.

## Link-Ablauf (`PluginManager.link`)

`link` unterstützt die lokale Plugin-Entwicklung durch Symlinks eines lokalen Pakets in `~/.xcsh/plugins/node_modules/<pkg.name>`.

Verhalten:

1. `localPath` gegen Manager-cwd auflösen.
2. Lokale `package.json` und das Feld `name` erfordern.
3. Sicherstellen, dass Plugin-Verzeichnisse vorhanden sind.
4. Für Scoped-Namen das Scope-Verzeichnis erstellen.
5. Vorhandenen Pfad am Ziel-Link-Speicherort entfernen.
6. Symlink erstellen.
7. Lockfile-Laufzeiteintrag aktiviert mit Standard-Features hinzufügen (`null`).

Hinweis: Das aktuelle `PluginManager.link` erzwingt nicht die `cwd`-Pfadgrenzüberprüfung aus dem Legacy-`installer.ts` (`normalizedPath.startsWith(normalizedCwd)`), daher liegt das Vertrauen in der Verantwortung des Aufrufers.

## Laufzeit-Laden: Vom installierten Plugin zu aufrufbaren Fähigkeiten

## Discovery-Gate

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) liest:

- Plugin-Abhängigkeitsmanifest (`package.json`)
- Lockfile-Laufzeitzustand
- Projektüberschreibungen über `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filterung:

- überspringen, wenn kein Plugin-package.json vorhanden
- überspringen, wenn Manifest (`xcsh`/`pi`) fehlt
- überspringen, wenn global in der Lockfile deaktiviert
- überspringen, wenn projektspezifisch deaktiviert

## Fähigkeitspfadauflösung

Für jedes aktivierte Plugin:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Jeder Resolver enthält Basiseinträge plus Feature-Einträge:

- explizite Feature-Liste -> nur ausgewählte Features
- `enabledFeatures === null` -> Features aktivieren, die mit `default: true` markiert sind

Fehlende Dateien werden stillschweigend übersprungen (`existsSync`-Guard).

## Aktuelle Laufzeit-Verkabelungsunterschiede

- **Werkzeuge sind heute in die Laufzeit integriert** über `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), das `getAllPluginToolPaths(cwd)` aufruft.
- Pfade werden bei der Entdeckung benutzerdefinierter Werkzeuge durch aufgelösten absoluten Pfad dedupliziert (`seen`-Menge, erster Pfad gewinnt).
- **Hooks-/Befehls-Resolver existieren** und werden exportiert, aber dieser Codepfad verbindet sie derzeit nicht auf dieselbe Weise wie Werkzeuge in eine Laufzeitregistrierung.

## Details zur Sperr-/Zustandsverwaltung

`PluginManager` speichert die Laufzeitkonfiguration pro Instanz im Arbeitsspeicher (`#runtimeConfig`) und lädt sie lazy einmalig.

Ladeverhalten:

- Lockfile fehlt -> `{ plugins: {}, settings: {} }`
- Lockfile-Lese-/Analysefehler -> Warnung + dieselben leeren Standardwerte

Speicherverhalten:

- schreibt bei jeder Mutation die vollständige Lockfile-JSON hübsch formatiert

Es gibt keine prozessübergreifende Sperrung oder Zusammenführungsstrategie; gleichzeitige Schreiber können sich gegenseitig überschreiben.

## Sicherheitsprüfungen und Vertrauensgrenzen

## Eingabe-/Paketvalidierung

Der aktive Managerpfad erzwingt die Paketnamensvalidierung:

- Regex für Scoped-/Unscoped-Paketspezifikationen (optional mit Version)
- explizite Shell-Metazeichen-Sperrliste (`[;&|`$(){}[]<>\\]`)

Dies begrenzt das Risiko von Befehlseinschleusung beim Aufrufen von `bun install/uninstall`.

## Vertrauensgrenze des Dateisystems

- Plugin-Code wird in-process ausgeführt, wenn benutzerdefinierte Werkzeugmodule importiert werden; kein Sandboxing.
- Relative Manifest-Pfade werden gegen das Plugin-Paketverzeichnis verbunden und nur auf Existenz geprüft.
- Das Plugin-Paket selbst ist nach der Installation vertrauenswürdiger Code.

## Nur im Legacy-Installer vorhandene Prüfungen

`installer.ts` enthält zusätzliche Link-Zeitprüfungen, die nicht in `PluginManager.link` gespiegelt werden:

- Lokaler Pfad muss innerhalb des Projekt-cwd auflösen
- Zusätzliche Paketname-/Pfadtraversierungsschutzmaßnahmen für Symlink-Zielbenennung

Da die CLI `PluginManager` verwendet, befinden sich diese strengeren Link-Guards derzeit nicht auf dem Hauptpfad.

## Fehlverhalten, teilweiser Erfolg und Rollback-Verhalten

Der Plugin-Manager ist nicht transaktional.

| Operationsphase | Fehlerverhalten | Rollback |
| --- | --- | --- |
| `bun install` schlägt fehl | Installation bricht mit stderr ab | N/A (noch keine Zustandsschreibvorgänge) |
| Installation erfolgreich, dann schlägt Manifest-/Feature-Validierung fehl | Befehl schlägt fehl | Kein Deinstallations-Rollback; Abhängigkeit kann in `node_modules`/`package.json` verbleiben |
| Installation erfolgreich, dann schlägt Lockfile-Schreibvorgang fehl | Befehl schlägt fehl | Kein Rollback des installierten Pakets |
| `bun uninstall` erfolgreich, Lockfile-Schreibvorgang schlägt fehl | Befehl schlägt fehl | Paket entfernt, veralteter Laufzeitzustand kann verbleiben |
| `link` entfernt altes Ziel, dann schlägt Symlink-Erstellung fehl | Befehl schlägt fehl | Keine Wiederherstellung des vorherigen Links/Verzeichnisses |

Operativ kann `doctor --fix` einige Abweichungen reparieren (`bun install`, verwaiste Konfigurationsbereinigung, Bereinigung ungültiger Features), ist aber ein Best-Effort-Ansatz.

## Zusammenfassung des Verhaltens bei fehlerhaftem/fehlendem Manifest

- Fehlendes `xcsh`/`pi`-Feld:
  - Installation/Auflistung: toleriert (minimales Manifest)
  - Laufzeit-Aktiviert-Plugin-Entdeckung: als Nicht-Plugin übersprungen
- Fehlendes Feature, das durch Installationsspezifikation oder `features --set/--enable` referenziert wird: schwerwiegender Fehler mit verfügbarer Feature-Liste
- Ungültige `plugin-overrides.json`: ignoriert mit Fallback auf `{}` in Manager- und Loader-Pfaden
- Fehlende Werkzeug-/Hook-/Befehlsdateipfade, die durch Manifest referenziert werden: während der Resolver-Erweiterung stillschweigend ignoriert; nur von `doctor` als Fehler markiert

## Modusunterschiede und Vorrang

- `--dry-run` (Installation): gibt synthetisches Installationsergebnis zurück, keine Dateisystem-/Netzwerk-/Zustandsschreibvorgänge.
- `--json`: nur Ausgabeformatierung, keine Verhaltensänderung.
- Projektüberschreibungen haben stets Vorrang vor globalem Lockfile für Feature-/Einstellungsansicht.
- Effektive Aktivierung ist `runtimeEnabled && !projectDisabled`.

## Implementierungsdateien

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — CLI-Befehlsdeklaration und Flag-Zuordnung
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — Aktionsverteilung, benutzerseitige Befehlshandler
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — aktive Implementations für Installation/Entfernung/Auflistung/Link/Zustand/Doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — veraltete Installer-Hilfsfunktionen und zusätzliche Link-Sicherheitsprüfungen
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — Aktiviert-Plugin-Entdeckung und Werkzeug-/Hook-/Befehlspfadauflösung
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — Installationsspezifikation und Paketname-Analysehilfsfunktionen
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — Manifest-/Laufzeit-/Überschreibungstypenverträge
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — Laufzeit-Verkabelung für plugin-bereitgestellte Werkzeugmodule
