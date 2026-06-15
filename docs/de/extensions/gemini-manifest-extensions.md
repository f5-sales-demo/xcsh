---
title: Gemini Manifest-Erweiterungen
description: >-
  Gemini-Manifest-Erweiterungsformat für plattformübergreifende Skill- und
  Agent-Kompatibilität.
sidebar:
  order: 7
  label: Gemini-Manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini Manifest-Erweiterungen (`gemini-extension.json`)

Dieses Dokument beschreibt, wie der Coding-Agent Gemini-artige Manifest-Erweiterungen (`gemini-extension.json`) erkennt und in die Fähigkeit `extensions` einliest.

Es behandelt **nicht** das Laden von TypeScript/JavaScript-Erweiterungsmodulen (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), das in `extension-loading.md` dokumentiert ist.

## Implementierungsdateien

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Was erkannt wird

Der Gemini-Provider (`id: gemini`, Priorität `60`) registriert einen `extensions`-Loader, der zwei feste Wurzelpfade durchsucht:

- Benutzer: `~/.gemini/extensions`
- Projekt: `<cwd>/.gemini/extensions`

Die Pfadauflösung erfolgt direkt über `ctx.home` und `ctx.cwd` mittels `getUserPath()` / `getProjectPath()`.

Wichtige Bereichsregel: Die Projektsuche ist auf **cwd-only** beschränkt. Übergeordnete Verzeichnisse werden nicht durchsucht.

---

## Regeln für das Verzeichnis-Scanning

Für jeden Wurzelpfad (`~/.gemini/extensions` und `<cwd>/.gemini/extensions`) führt die Erkennung folgende Schritte aus:

1. `readDirEntries(root)`
2. Nur direkte untergeordnete Verzeichnisse behalten (`entry.isDirectory()`)
3. Für jedes untergeordnete Element `<name>` wird genau folgendes versucht zu lesen:
   - `<root>/<name>/gemini-extension.json`

Es erfolgt keine rekursive Suche über eine Verzeichnisebene hinaus.

### Versteckte Verzeichnisse

Die Gemini-Manifest-Erkennung filtert Verzeichnisnamen mit Punkt-Präfix **nicht** heraus. Wenn ein verstecktes untergeordnetes Verzeichnis existiert und `gemini-extension.json` enthält, wird es berücksichtigt.

### Fehlende/nicht lesbare Dateien

Wenn `gemini-extension.json` fehlt oder nicht lesbar ist, wird das Verzeichnis stillschweigend übersprungen (keine Warnung).

---

## Manifest-Struktur (gemäß Implementierung)

Der Fähigkeitstyp definiert folgende Manifest-Struktur:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Das Verhalten zur Erkennungszeit ist absichtlich locker:

- Eine erfolgreiche JSON-Analyse wird vorausgesetzt.
- Es findet keine Laufzeit-Schemavalidierung für Feldtypen/-inhalte über die JSON-Syntax hinaus statt.
- Das geparste Objekt wird als `manifest` im Fähigkeitselement gespeichert.

### Namens-Normalisierung

`Extension.name` wird wie folgt gesetzt:

1. `manifest.name`, sofern nicht `null`/`undefined`
2. andernfalls der Name des Erweiterungsverzeichnisses

Hier wird keine Überprüfung des String-Typs durchgeführt.

---

## Materialisierung in Fähigkeitselemente

Ein gültig geparste Manifest erzeugt ein `Extension`-Fähigkeitselement:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // attached by capability registry
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Hinweise:

- `_source.path` wird durch `createSourceMeta()` auf einen absoluten Pfad normalisiert.
- Die Fähigkeitsvalidierung auf Registry-Ebene für `extensions` prüft nur das Vorhandensein von `name` und `path`.
- Manifest-Inhalte (`mcpServers`, `tools`, `context`) werden bei der Erkennung nicht validiert.

---

## Fehlerbehandlung und Warnungssemantik

### Mit Warnung

- Ungültiges JSON in einer Manifest-Datei:
  - Warnungsformat: `Invalid JSON in <manifestPath>`

### Ohne Warnung (stilles Überspringen)

- `extensions`-Verzeichnis fehlt
- Untergeordnetes Verzeichnis enthält kein `gemini-extension.json`
- Manifest-Datei nicht lesbar
- Manifest-JSON ist syntaktisch gültig, aber semantisch unvollständig/ungewöhnlich

Das bedeutet, dass teilweise Gültigkeit akzeptiert wird: Nur syntaktische JSON-Fehler lösen eine Warnung aus.

---

## Vorrang und Deduplizierung mit anderen Quellen

Die Fähigkeit `extensions` wird durch die Fähigkeits-Registry über alle Provider hinweg aggregiert.

Aktuelle Provider für diese Fähigkeit:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) Priorität `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) Priorität `60`

Der Deduplizierungsschlüssel ist `ext.name` (`extensionCapability.key = ext => ext.name`).

### Providerübergreifender Vorrang

Der Provider mit höherer Priorität gewinnt bei doppelten Erweiterungsnamen.

- Wenn `native` und `gemini` beide den Erweiterungsnamen `foo` ausgeben, wird das native Element behalten.
- Das Duplikat mit niedrigerer Priorität verbleibt nur in `result.all` mit `_shadowed = true`.

### Reihenfolgeeffekte innerhalb eines Providers

Da die Deduplizierung nach dem Prinzip „zuerst gesehen gewinnt" funktioniert, ist die Reihenfolge der Elemente innerhalb eines Providers relevant.

- Der Gemini-Loader fügt **Benutzer zuerst**, dann **Projekt** hinzu.
- Daher werden bei doppelten Namen zwischen `~/.gemini/extensions` und `<cwd>/.gemini/extensions` der Benutzereintrag behalten und der Projekteintrag zurückgestellt.

Im Gegensatz dazu erstellt der native Provider die Konfigurationsverzeichnisreihenfolge anders (`project` dann `user` in `getConfigDirs()`), sodass die interne Zurückstellung beim nativen Provider in entgegengesetzter Richtung erfolgt.

---

## Zusammenfassung des Verhaltens für Benutzer vs. Projekt

Speziell für Gemini-Manifeste gilt:

- Sowohl der Benutzer- als auch der Projektwurzelpfad werden bei jedem Ladevorgang durchsucht.
- Der Projektwurzelpfad ist auf `<cwd>/.gemini/extensions` festgelegt (keine Suche in übergeordneten Verzeichnissen).
- Doppelte Namen innerhalb der Gemini-Quelle werden zugunsten des Benutzers aufgelöst.
- Doppelte Namen gegenüber Providern mit höherer Priorität (insbesondere native) verlieren aufgrund der Priorität.

---

## Grenze: Erkennungsmetadaten vs. Laufzeit-Erweiterungsladung

Die Erkennung von `gemini-extension.json` liefert derzeit Fähigkeitsmetadaten (`Extension`-Elemente). Ausführbare TS/JS-Erweiterungsmodule werden dabei **nicht** direkt geladen.

Das Laden von Laufzeitmodulen (`discoverAndLoadExtensions()` / `loadExtensions()`) verwendet `extension-modules` und explizite Pfade und filtert automatisch erkannte Module derzeit ausschließlich auf den Provider `native`.

Praktische Auswirkung:

- Gemini-Manifest-Erweiterungen sind als Fähigkeitsdatensätze auffindbar.
- Sie werden vom Erweiterungs-Loader-Pipeline nicht von sich aus als ausführbare Laufzeiterweiterungsmodule ausgeführt.

Diese Grenze ist in der aktuellen Implementierung beabsichtigt und erklärt, warum Manifest-Erkennung und die Ladung ausführbarer Module auseinanderfallen können.
