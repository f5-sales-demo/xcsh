---
title: Rulebook-Matching-Pipeline
description: >-
  Rulebook-Matching-Pipeline zur Auswahl und Anwendung kontextspezifischer
  Anweisungssätze auf Agent-Sitzungen.
sidebar:
  order: 6
  label: Rulebook-Matching
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Rulebook-Matching-Pipeline

Dieses Dokument beschreibt, wie der Coding-Agent Regeln aus unterstützten Konfigurationsformaten erkennt, sie in eine einheitliche `Rule`-Struktur normalisiert, Vorrangkonflikte auflöst und das Ergebnis aufteilt in:

- **Rulebook-Regeln** (dem Modell über System-Prompt + `rule://`-URLs verfügbar)
- **TTSR-Regeln** (Time-Travel-Stream-Interruption-Regeln)

Es spiegelt die aktuelle Implementierung wider, einschließlich partieller Semantik und Metadaten, die zwar geparst, aber nicht erzwungen werden.

## Implementierungsdateien

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. Kanonische Regelstruktur

Alle Provider normalisieren Quelldateien in `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

Die Capability-Identität ist `rule.name` (`ruleCapability.key = rule => rule.name`).

Konsequenz: Vorrang und Deduplizierung sind **ausschließlich namensbasiert**. Zwei verschiedene Dateien mit demselben `name` werden als dieselbe logische Regel betrachtet.

## 2. Discovery-Quellen und Normalisierung

`src/discovery/index.ts` registriert Provider automatisch. Für `rules` sind die aktuellen Provider:

- `native` (Priorität `100`)
- `cursor` (Priorität `50`)
- `windsurf` (Priorität `50`)
- `cline` (Priorität `40`)

### Native Provider (`builtin.ts`)

Lädt `.xcsh`-Regeln aus:

- Projekt: `<cwd>/.xcsh/rules/*.{md,mdc}`
- Benutzer: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalisierung:

- `name` = Dateiname ohne `.md`/`.mdc`
- Frontmatter wird über `parseFrontmatter` geparst
- `content` = Body (Frontmatter entfernt)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` werden direkt zugeordnet

Wichtiger Hinweis: `globs` wird als `string[] | undefined` gecastet, ohne Elementfilterung in diesem Provider.

### Cursor Provider (`cursor.ts`)

Lädt aus:

- Benutzer: `~/.cursor/rules/*.{mdc,md}`
- Projekt: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalisierung (`transformMDCRule`):

- `description`: wird nur beibehalten, wenn es ein String ist
- `alwaysApply`: nur `true` wird übernommen (`false` wird zu `undefined`)
- `globs`: akzeptiert Array (nur String-Elemente) oder einzelnen String
- `ttsr_trigger`: nur String
- `name` aus Dateiname ohne Erweiterung

### Windsurf Provider (`windsurf.ts`)

Lädt aus:

- Benutzer: `~/.codeium/windsurf/memories/global_rules.md` (fester Regelname `global_rules`)
- Projekt: `<cwd>/.windsurf/rules/*.md`

Normalisierung:

- `globs`: Array aus Strings oder einzelner String
- `alwaysApply`, `description` aus Frontmatter gecastet
- `ttsr_trigger`: nur String
- `name` aus Dateiname für Projektregeln

### Cline Provider (`cline.ts`)

Sucht aufwärts ab `cwd` nach dem nächsten `.clinerules`:

- falls Verzeichnis: lädt `*.md` darin
- falls Datei: lädt einzelne Datei als Regel mit dem Namen `clinerules`

Normalisierung:

- `globs`: Array aus Strings oder einzelner String
- `alwaysApply`: nur wenn Boolean
- `description`: nur String
- `ttsr_trigger`: nur String

## 3. Frontmatter-Parsing-Verhalten und Mehrdeutigkeiten

Alle Provider verwenden `parseFrontmatter` (`utils/frontmatter.ts`) mit folgender Semantik:

1. Frontmatter wird nur geparst, wenn der Inhalt mit `---` beginnt und ein abschließendes `\n---` vorhanden ist.
2. Der Body wird nach der Frontmatter-Extraktion getrimmt.
3. Wenn das YAML-Parsing fehlschlägt:
   - Eine Warnung wird protokolliert,
   - Der Parser fällt auf einfaches `key: value`-Zeilenparsen zurück (`^(\w+):\s*(.*)$`).

Konsequenzen der Mehrdeutigkeit:

- Der Fallback-Parser unterstützt keine Arrays, verschachtelten Objekte, Quotierungsregeln oder Schlüssel mit Bindestrichen.
- Fallback-Werte werden zu Strings (zum Beispiel wird `alwaysApply: true` zum String `"true"`), sodass Provider, die Boolean-/String-Typen erfordern, Metadaten verwerfen können.
- `ttsr_trigger` funktioniert im Fallback (Unterstrich-Schlüssel); Schlüssel wie `thinking-level` hingegen nicht.
- Dateien ohne gültiges Frontmatter werden trotzdem als Regeln mit leeren Metadaten und vollständigem Inhalt als Body geladen.

## 4. Provider-Vorrang und Deduplizierung

`loadCapability("rules")` (`capability/index.ts`) führt Provider-Ausgaben zusammen und dedupliziert dann nach `rule.name`.

### Vorrangmodell

- Provider werden nach Priorität absteigend geordnet.
- Bei gleicher Priorität gilt die Registrierungsreihenfolge (`cursor` vor `windsurf` aus `discovery/index.ts`).
- Die Deduplizierung erfolgt nach dem First-Wins-Prinzip: Der zuerst gefundene Regelname wird beibehalten; spätere Einträge mit demselben Namen werden in `all` als `_shadowed` markiert und aus `items` ausgeschlossen.

Die effektive Reihenfolge der Regel-Provider ist derzeit:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Hinweis zur Reihenfolge innerhalb eines Providers

Innerhalb eines Providers ergibt sich die Elementreihenfolge aus der Glob-Ergebnisreihenfolge von `loadFilesFromDir` plus der expliziten Push-Reihenfolge. Dies ist für den normalen Gebrauch hinreichend deterministisch, wird im Code jedoch nicht explizit sortiert.

Bemerkenswerte Unterschiede in der Quellenreihenfolge:

- `native` fügt zuerst Projekt-, dann Benutzerkonfigurationsverzeichnisse an.
- `cursor` fügt zuerst Benutzer-, dann Projektergebnisse an.
- `windsurf` fügt zuerst die Benutzer-`global_rules` an, dann die Projektregeln.
- `cline` lädt nur die nächstgelegene `.clinerules`-Quelle.

## 5. Aufteilung in Rulebook-, Always-Apply- und TTSR-Buckets

Nach der Regelerkennung in `createAgentSession` (`sdk.ts`):

1. Alle erkannten Regeln werden durchsucht.
2. Regeln mit `condition` (Frontmatter-Schlüssel; `ttsr_trigger` / `ttsrTrigger` als Fallback akzeptiert) werden im `TtsrManager` registriert.
3. Eine separate `rulebookRules`-Liste wird mit diesem Prädikat erstellt:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Eine `alwaysApplyRules`-Liste wird erstellt:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Bucket-Verhalten

- **TTSR-Bucket**: jede Regel mit `condition` (Beschreibung nicht erforderlich). Hat Vorrang vor anderen Buckets.
- **Always-Apply-Bucket**: `alwaysApply === true`, kein TTSR. Vollständiger Inhalt wird in den System-Prompt injiziert. Über `rule://` auflösbar.
- **Rulebook-Bucket**: muss eine Beschreibung haben, darf kein TTSR sein, darf nicht `alwaysApply` sein. Im System-Prompt nach Name+Beschreibung aufgelistet; Inhalt wird bei Bedarf über `rule://` gelesen.
- Eine Regel mit sowohl `condition` als auch `alwaysApply` geht nur in TTSR (TTSR hat Vorrang).
- Eine Regel mit sowohl `alwaysApply` als auch `description` geht nur in Always-Apply (nicht ins Rulebook).

## 6. Wie Metadaten Laufzeitoberflächen beeinflussen

### `description`

- Erforderlich für die Aufnahme ins Rulebook.
- Wird im `<rules>`-Block des System-Prompts gerendert.
- Fehlende Beschreibung bedeutet, dass die Regel nicht über `rule://` verfügbar ist und nicht in den System-Prompt-Regeln aufgeführt wird.

### `globs`

- Wird in `Rule` mitgeführt.
- Wird als `<glob>...</glob>`-Einträge im Rules-Block des System-Prompts gerendert.
- Wird im Rules-UI-Status angezeigt (Modusliste in `extensions`).
- **Wird in dieser Pipeline nicht für automatisches Matching erzwungen.** Es gibt keinen Laufzeit-Glob-Matcher, der Regeln anhand der aktuellen Datei/des Tool-Ziels auswählt.

### `alwaysApply`

- Wird von Providern geparst und beibehalten.
- Wird in der UI-Anzeige verwendet (`"always"`-Trigger-Label im Extensions-State-Manager).
- Wird als Ausschlussbedingung für `rulebookRules` verwendet.
- **Der vollständige Regelinhalt wird automatisch in den System-Prompt injiziert** (vor dem Rulebook-Regeln-Abschnitt).
- Die Regel ist auch über `rule://<name>` zum erneuten Lesen adressierbar.

### `ttsr_trigger`

- Wird auf `rule.ttsrTrigger` abgebildet.
- Falls vorhanden, wird die Regel an den TTSR-Manager weitergeleitet, nicht ans Rulebook.

## 7. Einbindungspfad im System-Prompt

`buildSystemPromptInternal` erhält sowohl `rules` (Rulebook) als auch `alwaysApplyRules`.

Always-Apply-Regeln werden zuerst gerendert, wobei ihr Rohinhalt direkt in den Prompt injiziert wird.

Rulebook-Regeln werden in einem `# Rules`-Abschnitt gerendert mit:

- `Read rule://<name> when working in matching domain`
- Name, `description` und optionale `<glob>`-Liste jeder Regel

Dies ist beratend/kontextuell: Der Prompt-Text fordert das Modell auf, anwendbare Regeln zu lesen, aber der Code erzwingt keine Glob-Anwendbarkeit.

## 8. `rule://`-Internes-URL-Verhalten

`RuleProtocolHandler` wird registriert mit:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implikationen:

- `rule://<name>` löst sowohl gegen **rulebookRules** als auch gegen **alwaysApplyRules** auf.
- Reine TTSR-Regeln und Regeln ohne Beschreibung und ohne `alwaysApply` sind nicht über `rule://` adressierbar.
- Die Auflösung erfolgt über exakte Namensübereinstimmung.
- Unbekannte Namen geben einen Fehler mit der Liste verfügbarer Regelnamen zurück.
- Der zurückgegebene Inhalt ist der rohe `rule.content` (Frontmatter entfernt), Content-Type `text/markdown`.

## 9. Bekannte partielle / nicht erzwungene Semantiken

1. Provider-Beschreibungen erwähnen Legacy-Dateien (`.cursorrules`, `.windsurfrules`), aber die aktuellen Loader-Codepfade lesen diese Dateien tatsächlich nicht.
2. `globs`-Metadaten werden im Prompt/UI angezeigt, aber nicht durch die Regelauswahllogik erzwungen.
3. Die Regelauswahl für `rule://` umfasst Rulebook- und Always-Apply-Regeln, aber keine reinen TTSR-Regeln.
4. Discovery-Warnungen (`loadCapability("rules").warnings`) werden erzeugt, aber `createAgentSession` gibt sie in diesem Pfad derzeit nicht aus/protokolliert sie nicht.
