---
title: Erkennung und Auswahl von Task-Agenten
description: >-
  Logik zur Erkennung und Auswahl von Task-Agenten für die Weiterleitung von
  Arbeit an spezialisierte Subagent-Typen.
sidebar:
  order: 6
  label: Erkennung von Task-Agenten
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Erkennung und Auswahl von Task-Agenten

Dieses Dokument beschreibt, wie das Task-Subsystem Agentendefinitionen erkennt, mehrere Quellen zusammenführt und einen angeforderten Agenten zur Ausführungszeit auflöst.

Es behandelt das Laufzeitverhalten wie es heute implementiert ist, einschließlich Prioritäten, Behandlung ungültiger Definitionen und Spawn-/Tiefenbeschränkungen, die einen Agenten effektiv unerreichbar machen können.

## Implementierungsdateien

- [`src/task/discovery.ts`](../../packages/coding-agent/src/task/discovery.ts)
- [`src/task/agents.ts`](../../packages/coding-agent/src/task/agents.ts)
- [`src/task/types.ts`](../../packages/coding-agent/src/task/types.ts)
- [`src/task/index.ts`](../../packages/coding-agent/src/task/index.ts)
- [`src/task/commands.ts`](../../packages/coding-agent/src/task/commands.ts)
- [`src/prompts/agents/task.md`](../../packages/coding-agent/src/prompts/agents/task.md)
- [`src/prompts/tools/task.md`](../../packages/coding-agent/src/prompts/tools/task.md)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/config.ts`](../../packages/coding-agent/src/config.ts)
- [`src/task/executor.ts`](../../packages/coding-agent/src/task/executor.ts)

---

## Form der Agentendefinition

Task-Agenten werden in `AgentDefinition` (`src/task/types.ts`) normalisiert:

- `name`, `description`, `systemPrompt` (erforderlich für einen gültig geladenen Agenten)
- optional `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- optional `filePath`

Das Parsen erfolgt aus Frontmatter über `parseAgentFields()` (`src/discovery/helpers.ts`):

- fehlender `name` oder `description` => ungültig (`null`), Aufrufer behandelt dies als Parse-Fehler
- `tools` akzeptiert CSV oder Array; falls angegeben, wird `submit_result` automatisch hinzugefügt
- `spawns` akzeptiert `*`, CSV oder Array
- Abwärtskompatibilitätsverhalten: falls `spawns` fehlt, aber `tools` `task` enthält, wird `spawns` zu `*`
- `output` wird als opake Schema-Daten durchgereicht

## Mitgelieferte Agenten

Mitgelieferte Agenten werden zur Build-Zeit eingebettet (`src/task/agents.ts`) mittels Text-Imports.

`EMBEDDED_AGENT_DEFS` definiert:

- `explore`, `plan`, `designer`, `reviewer` aus Prompt-Dateien
- `task` und `quick_task` aus dem gemeinsamen `task.md`-Körper plus injiziertem Frontmatter

Ladepfad:

1. `loadBundledAgents()` parst eingebettetes Markdown mit `parseAgent(..., "bundled", "fatal")`
2. Ergebnisse werden im Arbeitsspeicher zwischengespeichert (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` ist ein nur für Tests vorgesehenes Cache-Reset

Da das Parsen der mitgelieferten Agenten `level: "fatal"` verwendet, wirft fehlerhaftes mitgeliefertes Frontmatter eine Exception und kann die Erkennung vollständig zum Scheitern bringen.

## Dateisystem- und Plugin-Erkennung

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) führt Agenten aus mehreren Stellen zusammen, bevor mitgelieferte Definitionen angehängt werden.

### Erkennungs-Eingaben

1. Benutzer-Konfigurationsverzeichnisse für Agenten aus `getConfigDirs("agents", { project: false })`
2. Nächstgelegene Projekt-Agentenverzeichnisse aus `findAllNearestProjectConfigDirs("agents", cwd)`
3. Claude-Plugin-Wurzelverzeichnisse (`listClaudePluginRoots(home)`) mit `agents/`-Unterverzeichnissen
4. Mitgelieferte Agenten (`loadBundledAgents()`)

### Tatsächliche Quellreihenfolge

Die Reihenfolge der Quellfamilien ergibt sich aus `getConfigDirs("", { project: false })`, das von `priorityList` in `src/config.ts` abgeleitet wird:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Für jede Quellfamilie ist die Erkennungsreihenfolge:

1. nächstgelegenes Projektverzeichnis für diese Quelle (falls gefunden)
2. Benutzerverzeichnis für diese Quelle

Nach allen Quellfamilien-Verzeichnissen werden Plugin-`agents/`-Verzeichnisse angehängt (zuerst projektbezogene Plugins, dann benutzerbezogene).

Mitgelieferte Agenten werden zuletzt angehängt.

### Wichtiger Hinweis: veraltete Kommentare vs. aktueller Code

Die Header-Kommentare in `discovery.ts` erwähnen noch `.pi` und nennen `.codex`/`.gemini` nicht. Die tatsächliche Laufzeitreihenfolge wird durch `src/config.ts` bestimmt und verwendet derzeit `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Zusammenführungs- und Kollisionsregeln

Die Erkennung verwendet First-Wins-Deduplizierung nach exaktem `agent.name`:

- Ein `Set<string>` verfolgt gesehene Namen.
- Geladene Agenten werden in Verzeichnisreihenfolge abgeflacht und nur behalten, wenn der Name noch nicht gesehen wurde.
- Mitgelieferte Agenten werden gegen dasselbe Set gefiltert und nur hinzugefügt, wenn sie noch nicht gesehen wurden.

Auswirkungen:

- Projekt überschreibt Benutzer für dieselbe Quellfamilie.
- Höher priorisierte Quellfamilie überschreibt niedrigere (`.xcsh` vor `.claude`, usw.).
- Nicht-mitgelieferte Agenten überschreiben mitgelieferte Agenten mit demselben Namen.
- Namensabgleich ist Groß-/Kleinschreibung-sensitiv (`Task` und `task` sind unterschiedlich).
- Innerhalb eines Verzeichnisses werden Markdown-Dateien vor der Deduplizierung in lexikografischer Dateinamenreihenfolge gelesen.

## Verhalten bei ungültigen/fehlenden Agentendateien

Pro Verzeichnis (`loadAgentsFromDir`):

- nicht lesbares/fehlendes Verzeichnis: wird als leer behandelt (`readdir(...).catch(() => [])`)
- Datei-Lese- oder Parse-Fehler: Warnung wird protokolliert, Datei wird übersprungen
- Parse-Pfad verwendet `parseAgent(..., level: "warn")`

Das Verhalten bei Frontmatter-Fehlern stammt von `parseFrontmatter`:

- Parse-Fehler auf `warn`-Ebene protokolliert Warnung
- Parser fällt auf einen einfachen `key: value`-Zeilenparser zurück
- wenn erforderliche Felder weiterhin fehlen, schlägt `parseAgentFields` fehl, dann wird `AgentParsingError` geworfen und vom Aufrufer abgefangen (Datei wird übersprungen)

Nettoeffekt: Eine fehlerhafte benutzerdefinierte Agentendatei bricht die Erkennung anderer Dateien nicht ab.

## Agentensuche und -auswahl

Die Suche ist eine exakte lineare Namenssuche:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Bei der Task-Ausführung (`TaskTool.execute`):

1. Agenten werden zum Aufrufzeitpunkt neu erkannt (`discoverAgents(this.session.cwd)`)
2. der angeforderte `params.agent` wird über `getAgent` aufgelöst
3. fehlender Agent gibt eine sofortige Tool-Antwort zurück:
   - `Unknown agent "...". Available: ...`
   - kein Unterprozess wird gestartet

### Beschreibung vs. Erkennung zur Ausführungszeit

`TaskTool.create()` erstellt die Tool-Beschreibung aus den Erkennungsergebnissen zum Initialisierungszeitpunkt (`buildDescription`).

`execute()` erkennt Agenten erneut. Daher kann sich die Laufzeit-Menge von dem unterscheiden, was in der früheren Tool-Beschreibung aufgelistet war, wenn sich Agentendateien während der Sitzung geändert haben.

## Strukturierte-Ausgabe-Schutzmaßnahmen und Schema-Priorität

Laufzeit-Ausgabeschema-Priorität in `TaskTool.execute`:

1. Agenten-Frontmatter `output`
2. Task-Aufruf `params.schema`
3. übergeordnete Sitzung `outputSchema`

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Schutzmaßnahmen-Text zur Prompt-Zeit in `src/prompts/tools/task.md` warnt vor Fehlanpassungsverhalten bei Agenten mit strukturierter Ausgabe (`explore`, `reviewer`): Ausgabeformat-Anweisungen im Prosatext können mit dem eingebauten Schema kollidieren und `null`-Ausgaben erzeugen.

Dies ist eine Orientierung, keine harte Laufzeit-Validierungslogik in `discoverAgents`.

## Interaktion mit der Befehlserkennung

`src/task/commands.ts` ist eine parallele Infrastruktur für Workflow-Befehle (keine Agentendefinitionen), folgt aber dem gleichen allgemeinen Muster:

- zuerst von Capability-Providern erkennen
- nach Name mit First-Wins deduplizieren
- mitgelieferte Befehle anhängen, wenn noch nicht gesehen
- exakte Namenssuche über `getCommand`

In `src/task/index.ts` werden Befehls-Hilfsfunktionen zusammen mit Agentenerkennungs-Hilfsfunktionen re-exportiert. Die Agentenerkennung selbst hängt zur Laufzeit nicht von der Befehlserkennung ab.

## Verfügbarkeitsbeschränkungen jenseits der Erkennung

Ein Agent kann erkennbar, aber dennoch nicht ausführbar sein, aufgrund von Ausführungs-Schutzmaßnahmen.

### Übergeordnete Spawn-Richtlinie

`TaskTool.execute` prüft `session.getSessionSpawns()`:

- `"*"` => alle erlauben
- `""` => alle verweigern
- CSV-Liste => nur aufgelistete Namen erlauben

Bei Verweigerung: sofortige `Cannot spawn '...'. Allowed: ...`-Antwort.

### Blockierte Selbstrekursions-Umgebungsvariable

`PI_BLOCKED_AGENT` wird bei der Tool-Konstruktion gelesen. Wenn die Anfrage übereinstimmt, wird die Ausführung mit einer Rekursionspräventionsnachricht abgelehnt.

### Rekursionstiefe-Begrenzung (Task-Tool-Verfügbarkeit in Kind-Sitzungen)

In `runSubprocess` (`src/task/executor.ts`):

- Tiefe wird aus `taskDepth` berechnet
- `task.maxRecursionDepth` steuert den Grenzwert
- bei maximaler Tiefe:
  - `task`-Tool wird aus der Kind-Tool-Liste entfernt
  - Kind-`spawns`-Umgebungsvariable wird auf leer gesetzt

So können tiefere Ebenen keine weiteren Tasks spawnen, selbst wenn die Agentendefinition `spawns` enthält.

## Planmodus-Einschränkung (aktuelle Implementierung)

`TaskTool.execute` berechnet einen `effectiveAgent` für den Planmodus (stellt Planmodus-Prompt voran, erzwingt schreibgeschützte Tool-Untermenge, löscht Spawns), aber `runSubprocess` wird mit `agent` statt `effectiveAgent` aufgerufen.

Aktuelle Auswirkung:

- Modell-Override / Denkstufe / Ausgabeschema werden von `effectiveAgent` abgeleitet
- System-Prompt und Tool-/Spawn-Einschränkungen von `effectiveAgent` werden in diesem Aufrufpfad nicht durchgereicht

Dies ist eine Implementierungseinschränkung, die beim Lesen von Planmodus-Verhaltenserwartungen wissenswert ist.
