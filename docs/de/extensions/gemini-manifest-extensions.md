---
title: Gemini-Manifest-Erweiterungen
description: >-
  Gemini-Manifest-Erweiterungsformat für plattformübergreifende Skill- und
  Agenten-Kompatibilität.
sidebar:
  order: 7
  label: Gemini-Manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Gemini-Manifest-Erweiterungen (`gemini-extension.json`)

Dieses Dokument behandelt, wie der Coding-Agent Gemini-Style-Manifest-Erweiterungen (`gemini-extension.json`) entdeckt und in die `extensions`-Capability parst.

Es behandelt **nicht** das Laden von TypeScript/JavaScript-Erweiterungsmodulen (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), welches in `extension-loading.md` dokumentiert ist.

## Implementierungsdateien

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Was entdeckt wird

Der Gemini-Provider (`id: gemini`, Priorität `60`) registriert einen `extensions`-Loader, der zwei feste Wurzelverzeichnisse durchsucht:

- Benutzer: `~/.gemini/extensions`
- Projekt: `<cwd>/.gemini/extensions`

Die Pfadauflösung erfolgt direkt aus `ctx.home` und `ctx.cwd` über `getUserPath()` / `getProjectPath()`.

Wichtige Geltungsbereichsregel: Die Projektsuche beschränkt sich **nur auf cwd**. Es werden keine übergeordneten Verzeichnisse durchlaufen.

---

## Regeln für die Verzeichnissuche

Für jedes Wurzelverzeichnis (`~/.gemini/extensions` und `<cwd>/.gemini/extensions`) führt die Entdeckung folgendes durch:

1. `readDirEntries(root)`
2. Nur direkte Unterverzeichnisse beibehalten (`entry.isDirectory()`)
3. Für jedes Unterverzeichnis `<name>` wird versucht, genau folgendes zu lesen:
   - `<root>/<name>/gemini-extension.json`

Es gibt keine rekursive Suche über eine Verzeichnisebene hinaus.

### Versteckte Verzeichnisse

Die Gemini-Manifest-Entdeckung filtert **keine** Verzeichnisnamen mit Punkt-Präfix heraus. Wenn ein verstecktes Unterverzeichnis existiert und eine `gemini-extension.json` enthält, wird es berücksichtigt.

### Fehlende/nicht lesbare Dateien

Wenn `gemini-extension.json` fehlt oder nicht lesbar ist, wird dieses Verzeichnis stillschweigend übersprungen (keine Warnung).

---

## Manifest-Struktur (wie implementiert)

Der Capability-Typ definiert diese Manifest-Struktur:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

Das Verhalten zur Entdeckungszeit ist absichtlich locker:

- Erfolgreiches JSON-Parsing ist erforderlich.
- Es gibt keine Laufzeit-Schema-Validierung für Feldtypen/Inhalte über die JSON-Syntax hinaus.
- Das geparste Objekt wird als `manifest` auf dem Capability-Element gespeichert.

### Namens-Normalisierung

`Extension.name` wird gesetzt auf:

1. `manifest.name`, wenn es nicht `null`/`undefined` ist
2. andernfalls den Verzeichnisnamen der Erweiterung

Es wird hier keine Zeichenkettentyp-Durchsetzung angewendet.

---

## Materialisierung in Capability-Elemente

Ein gültig geparstes Manifest erzeugt ein `Extension`-Capability-Element:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // wird vom Capability-Registry angehängt
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Hinweise:

- `_source.path` wird durch `createSourceMeta()` zu einem absoluten Pfad normalisiert.
- Die Capability-Validierung auf Registry-Ebene für `extensions` prüft nur das Vorhandensein von `name` und `path`.
- Manifest-Interna (`mcpServers`, `tools`, `context`) werden während der Entdeckung nicht validiert.

---

## Fehlerbehandlung und Warnungs-Semantik

### Mit Warnung

- Ungültiges JSON in einer Manifest-Datei:
  - Warnungsformat: `Invalid JSON in <manifestPath>`

### Ohne Warnung (stillschweigendes Überspringen)

- `extensions`-Verzeichnis fehlt
- Unterverzeichnis hat keine `gemini-extension.json`
- Nicht lesbare Manifest-Datei
- Manifest-JSON ist syntaktisch gültig, aber semantisch ungewöhnlich/unvollständig

Das bedeutet, dass partielle Gültigkeit akzeptiert wird: Nur ein syntaktischer JSON-Fehler erzeugt eine Warnung.

---

## Vorrang und Deduplizierung mit anderen Quellen

Die `extensions`-Capability wird über Provider hinweg vom Capability-Registry aggregiert.

Aktuelle Provider für diese Capability:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) Priorität `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) Priorität `60`

Deduplizierungsschlüssel ist `ext.name` (`extensionCapability.key = ext => ext.name`).

### Provider-übergreifender Vorrang

Der Provider mit höherer Priorität gewinnt bei doppelten Erweiterungsnamen.

- Wenn `native` und `gemini` beide den Erweiterungsnamen `foo` ausgeben, wird das native Element beibehalten.
- Das Duplikat mit niedrigerer Priorität wird nur in `result.all` mit `_shadowed = true` aufbewahrt.

### Auswirkungen der Reihenfolge innerhalb eines Providers

Da die Deduplizierung nach dem "Zuerst gesehen gewinnt"-Prinzip funktioniert, ist die lokale Elementreihenfolge des Providers relevant.

- Der Gemini-Loader fügt **zuerst Benutzer**, dann **Projekt** an.
- Daher behalten doppelte Namen zwischen `~/.gemini/extensions` und `<cwd>/.gemini/extensions` den Benutzereintrag bei und verdecken den Projekteintrag.

Im Gegensatz dazu baut der native Provider die Konfigurationsverzeichnis-Reihenfolge anders auf (`project` dann `user` in `getConfigDirs()`), sodass die providerinterne Verdeckung beim nativen Provider in die entgegengesetzte Richtung erfolgt.

---

## Zusammenfassung des Benutzer- vs. Projektverhaltens

Speziell für Gemini-Manifeste gilt:

- Sowohl Benutzer- als auch Projektwurzelverzeichnisse werden bei jedem Laden durchsucht.
- Das Projektwurzelverzeichnis ist auf `<cwd>/.gemini/extensions` festgelegt (kein Durchlaufen übergeordneter Verzeichnisse).
- Doppelte Namen innerhalb der Gemini-Quelle werden zugunsten des Benutzers aufgelöst.
- Doppelte Namen gegenüber Providern mit höherer Priorität (insbesondere native) verlieren durch Priorität.

---

## Grenze: Entdeckungsmetadaten vs. Laufzeit-Erweiterungsladen

Die `gemini-extension.json`-Entdeckung speist derzeit Capability-Metadaten (`Extension`-Elemente). Sie lädt **nicht** direkt ausführbare TS/JS-Erweiterungsmodule.

Das Laden von Laufzeitmodulen (`discoverAndLoadExtensions()` / `loadExtensions()`) verwendet `extension-modules` und explizite Pfade und filtert automatisch entdeckte Module derzeit nur auf den Provider `native`.

Praktische Auswirkung:

- Gemini-Manifest-Erweiterungen sind als Capability-Datensätze entdeckbar.
- Sie werden nicht von sich aus als Laufzeit-Erweiterungsmodule durch die Erweiterungslader-Pipeline ausgeführt.

Diese Grenze ist in der aktuellen Implementierung beabsichtigt und erklärt, warum Manifest-Entdeckung und das Laden ausführbarer Module voneinander abweichen können.
