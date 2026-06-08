---
title: Task-Agent-Erkennung und -Auswahl
description: >-
  Logik zur Erkennung und Auswahl von Task-Agents für die Weiterleitung von
  Arbeit an spezialisierte Subagent-Typen.
sidebar:
  order: 6
  label: Task-Agent-Erkennung
i18n:
  sourceHash: 8cf42457c672
  translator: machine
---

# Task-Agent-Erkennung und -Auswahl

Dieses Dokument beschreibt, wie das Task-Subsystem Agent-Definitionen erkennt, mehrere Quellen zusammenführt und einen angeforderten Agent zur Ausführungszeit auflöst.

Es behandelt das Laufzeitverhalten wie es heute implementiert ist, einschließlich Prioritätenreihenfolge, Behandlung ungültiger Definitionen sowie Spawn-/Tiefenbeschränkungen, die einen Agent effektiv unverfügbar machen können.

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

## Form der Agent-Definition

Task-Agents werden in `AgentDefinition` (`src/task/types.ts`) normalisiert:

- `name`, `description`, `systemPrompt` (erforderlich für einen gültig geladenen Agent)
- optional `tools`, `spawns`, `model`, `thinkingLevel`, `output`
- `source`: `"bundled" | "user" | "project"`
- optional `filePath`

Das Parsen erfolgt aus Frontmatter über `parseAgentFields()` (`src/discovery/helpers.ts`):

- fehlender `name` oder `description` => ungültig (`null`), Aufrufer behandelt dies als Parse-Fehler
- `tools` akzeptiert CSV oder Array; falls angegeben, wird `submit_result` automatisch hinzugefügt
- `spawns` akzeptiert `*`, CSV oder Array
- Abwärtskompatibilitätsverhalten: falls `spawns` fehlt, aber `tools` `task` enthält, wird `spawns` zu `*`
- `output` wird als opake Schema-Daten durchgereicht

## Gebündelte Agents

Gebündelte Agents werden zur Build-Zeit eingebettet (`src/task/agents.ts`) mittels Text-Imports.

`EMBEDDED_AGENT_DEFS` definiert:

- `explore`, `plan`, `designer`, `reviewer` aus Prompt-Dateien
- `task` und `quick_task` aus dem gemeinsamen `task.md`-Body plus injiziertem Frontmatter

Ladepfad:

1. `loadBundledAgents()` parst eingebettetes Markdown mit `parseAgent(..., "bundled", "fatal")`
2. Ergebnisse werden im Speicher gecacht (`bundledAgentsCache`)
3. `clearBundledAgentsCache()` ist ein nur für Tests vorgesehener Cache-Reset

Da das Parsen gebündelter Agents `level: "fatal"` verwendet, wirft fehlerhaftes gebündeltes Frontmatter einen Fehler und kann die Erkennung vollständig zum Scheitern bringen.

## Dateisystem- und Plugin-Erkennung

`discoverAgents(cwd, home)` (`src/task/discovery.ts`) führt Agents aus mehreren Quellen zusammen, bevor gebündelte Definitionen angehängt werden.

### Erkennungsquellen

1. Agent-Verzeichnisse aus der Benutzerkonfiguration über `getConfigDirs("agents", { project: false })`
2. Nächstgelegene Projekt-Agent-Verzeichnisse über `findAllNearestProjectConfigDirs("agents", cwd)`
3. Claude-Plugin-Wurzeln (`listClaudePluginRoots(home)`) mit `agents/`-Unterverzeichnissen
4. Gebündelte Agents (`loadBundledAgents()`)

### Tatsächliche Quellenreihenfolge

Die Reihenfolge der Quellenfamilien ergibt sich aus `getConfigDirs("", { project: false })`, das von `priorityList` in `src/config.ts` abgeleitet wird:

1. `.xcsh`
2. `.claude`
3. `.codex`
4. `.gemini`

Für jede Quellenfamilie ist die Erkennungsreihenfolge:

1. Nächstgelegenes Projektverzeichnis für diese Quelle (falls gefunden)
2. Benutzerverzeichnis für diese Quelle

Nach allen Quellenfamilien-Verzeichnissen werden Plugin-`agents/`-Verzeichnisse angehängt (Projekt-Scope-Plugins zuerst, dann Benutzer-Scope).

Gebündelte Agents werden zuletzt angehängt.

### Wichtiger Hinweis: veraltete Kommentare vs. aktueller Code

Die Header-Kommentare in `discovery.ts` erwähnen noch `.pi` und nennen `.codex`/`.gemini` nicht. Die tatsächliche Laufzeitreihenfolge wird von `src/config.ts` gesteuert und verwendet derzeit `.xcsh`, `.claude`, `.codex`, `.gemini`.

## Zusammenführungs- und Kollisionsregeln

Die Erkennung verwendet First-Wins-Deduplizierung nach exaktem `agent.name`:

- Ein `Set<string>` verfolgt bereits gesehene Namen.
- Geladene Agents werden in Verzeichnisreihenfolge flachgelegt und nur behalten, wenn der Name noch nicht gesehen wurde.
- Gebündelte Agents werden gegen dasselbe Set gefiltert und nur hinzugefügt, wenn sie noch nicht gesehen wurden.

Auswirkungen:

- Projekt überschreibt Benutzer für dieselbe Quellenfamilie.
- Höher priorisierte Quellenfamilien überschreiben niedrigere (`.xcsh` vor `.claude`, etc.).
- Nicht-gebündelte Agents überschreiben gebündelte Agents mit demselben Namen.
- Namensabgleich ist Groß-/Kleinschreibung-sensitiv (`Task` und `task` sind unterschiedlich).
- Innerhalb eines Verzeichnisses werden Markdown-Dateien in lexikographischer Dateinamenreihenfolge gelesen, bevor die Deduplizierung erfolgt.

## Verhalten bei ungültigen/fehlenden Agent-Dateien

Pro Verzeichnis (`loadAgentsFromDir`):

- nicht lesbares/fehlendes Verzeichnis: wird als leer behandelt (`readdir(...).catch(() => [])`)
- Datei-Lese- oder Parse-Fehler: Warnung wird protokolliert, Datei wird übersprungen
- Parse-Pfad verwendet `parseAgent(..., level: "warn")`

Frontmatter-Fehlerverhalten kommt von `parseFrontmatter`:

- Parse-Fehler auf `warn`-Level protokolliert Warnung
- Parser fällt auf einen einfachen `key: value`-Zeilenparser zurück
- wenn erforderliche Felder weiterhin fehlen, schlägt `parseAgentFields` fehl, dann wird `AgentParsingError` geworfen und vom Aufrufer abgefangen (Datei wird übersprungen)

Nettoeffekt: Eine fehlerhafte benutzerdefinierte Agent-Datei bricht die Erkennung anderer Dateien nicht ab.

## Agent-Suche und -Auswahl

Die Suche ist eine exakte Namenssuche per linearer Durchsuchung:

- `getAgent(agents, name)` => `agents.find(a => a.name === name)`

Bei der Task-Ausführung (`TaskTool.execute`):

1. Agents werden zum Aufrufzeitpunkt neu erkannt (`discoverAgents(this.session.cwd)`)
2. der angeforderte `params.agent` wird über `getAgent` aufgelöst
3. fehlender Agent gibt eine sofortige Tool-Antwort zurück:
   - `Unknown agent "...". Available: ...`
   - kein Unterprozess wird ausgeführt

### Beschreibung vs. Erkennung zur Ausführungszeit

`TaskTool.create()` erstellt die Tool-Beschreibung aus den Erkennungsergebnissen zum Initialisierungszeitpunkt (`buildDescription`).

`execute()` erkennt Agents erneut. Daher kann sich die Laufzeitmenge von dem unterscheiden, was in der früheren Tool-Beschreibung aufgelistet wurde, wenn sich Agent-Dateien während der Sitzung geändert haben.

## Structured-Output-Schutzmaßnahmen und Schema-Priorität

Laufzeit-Output-Schema-Priorität in `TaskTool.execute`:

1. Agent-Frontmatter `output`
2. Task-Aufruf `params.schema`
3. Elternsitzung `outputSchema`

(`effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema`)

Prompt-seitiger Schutztext in `src/prompts/tools/task.md` warnt vor Inkompatibilitätsverhalten bei Structured-Output-Agents (`explore`, `reviewer`): Output-Format-Anweisungen im Prosatext können mit dem eingebauten Schema in Konflikt geraten und `null`-Ausgaben erzeugen.

Dies ist eine Richtlinie, keine harte Laufzeit-Validierungslogik in `discoverAgents`.

## Interaktion mit der Befehlserkennung

`src/task/commands.ts` ist eine parallele Infrastruktur für Workflow-Befehle (keine Agent-Definitionen), folgt aber dem gleichen allgemeinen Muster:

- zuerst von Capability-Providern erkennen
- nach Namen mit First-Wins deduplizieren
- gebündelte Befehle anhängen, wenn noch nicht gesehen
- exakte Namenssuche über `getCommand`

In `src/task/index.ts` werden Befehls-Hilfsfunktionen zusammen mit Agent-Erkennungs-Hilfsfunktionen re-exportiert. Die Agent-Erkennung selbst hängt zur Laufzeit nicht von der Befehlserkennung ab.

## Verfügbarkeitsbeschränkungen jenseits der Erkennung

Ein Agent kann erkennbar, aber dennoch nicht ausführbar sein, aufgrund von Ausführungs-Schutzmaßnahmen.

### Eltern-Spawn-Richtlinie

`TaskTool.execute` prüft `session.getSessionSpawns()`:

- `"*"` => alle erlauben
- `""` => alle verweigern
- CSV-Liste => nur aufgelistete Namen erlauben

Bei Verweigerung: sofortige `Cannot spawn '...'. Allowed: ...`-Antwort.

### Blockierte Selbstrekursion-Umgebungsschutz

`PI_BLOCKED_AGENT` wird bei der Tool-Konstruktion gelesen. Wenn die Anfrage übereinstimmt, wird die Ausführung mit einer Rekursionsverhütungs-Nachricht abgelehnt.

### Rekursionstiefe-Begrenzung (Task-Tool-Verfügbarkeit in Kind-Sitzungen)

In `runSubprocess` (`src/task/executor.ts`):

- Tiefe wird aus `taskDepth` berechnet
- `task.maxRecursionDepth` steuert den Grenzwert
- bei maximaler Tiefe:
  - `task`-Tool wird aus der Kind-Tool-Liste entfernt
  - Kind-`spawns`-Umgebung wird auf leer gesetzt

Tiefere Ebenen können also keine weiteren Tasks spawnen, selbst wenn die Agent-Definition `spawns` enthält.

## Plan-Modus-Einschränkung (aktuelle Implementierung)

`TaskTool.execute` berechnet einen `effectiveAgent` für den Plan-Modus (stellt Plan-Modus-Prompt voran, erzwingt schreibgeschützte Tool-Teilmenge, leert Spawns), aber `runSubprocess` wird mit `agent` statt mit `effectiveAgent` aufgerufen.

Aktuelle Auswirkung:

- Modell-Überschreibung / Thinking-Level / Output-Schema werden von `effectiveAgent` abgeleitet
- System-Prompt und Tool-/Spawn-Einschränkungen von `effectiveAgent` werden in diesem Aufrufpfad nicht durchgereicht

Dies ist eine Implementierungseinschränkung, die es wert ist, bekannt zu sein, wenn man die Verhaltenserwartungen im Plan-Modus liest.
