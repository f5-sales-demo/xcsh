---
title: Kompaktierung und Branch-Zusammenfassungen
description: >-
  Kontextfenster-Kompaktierung und Branch-Zusammenfassungsgenerierung für
  langlebige Sitzungen.
sidebar:
  order: 5
  label: Kompaktierung
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Kompaktierung und Branch-Zusammenfassungen

Kompaktierung und Branch-Zusammenfassungen sind die beiden Mechanismen, die lange Sitzungen nutzbar halten, ohne den Kontext früherer Arbeit zu verlieren.

- **Kompaktierung** schreibt alte Historie in eine Zusammenfassung auf dem aktuellen Branch um.
- **Branch-Zusammenfassung** erfasst den Kontext verlassener Branches während der `/tree`-Navigation.

Beide werden als Sitzungseinträge persistiert und beim Neuaufbau der LLM-Eingabe wieder in Benutzer-Kontextnachrichten umgewandelt.

## Wichtige Implementierungsdateien

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Sitzungseintrags-Modell

Kompaktierung und Branch-Zusammenfassungen sind erstklassige Sitzungseinträge, keine einfachen Assistant/User-Nachrichten.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, optionale `shortSummary`
  - `firstKeptEntryId` (Kompaktierungsgrenze)
  - `tokensBefore`
  - optionale `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - optionale `details`, `fromExtension`

Wenn der Kontext neu aufgebaut wird (`buildSessionContext`):

1. Die neueste Kompaktierung auf dem aktiven Pfad wird in eine `compactionSummary`-Nachricht umgewandelt.
2. Behaltene Einträge von `firstKeptEntryId` bis zum Kompaktierungspunkt werden wieder eingefügt.
3. Spätere Einträge auf dem Pfad werden angehängt.
4. `branch_summary`-Einträge werden in `branchSummary`-Nachrichten umgewandelt.
5. `custom_message`-Einträge werden in `custom`-Nachrichten umgewandelt.

Diese benutzerdefinierten Rollen werden dann in `convertToLlm()` unter Verwendung der statischen Vorlagen in LLM-seitige Benutzernachrichten transformiert:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Kompaktierungs-Pipeline

### Auslöser

Die Kompaktierung kann auf drei Arten ausgeführt werden:

1. **Manuell**: `/compact [instructions]` ruft `AgentSession.compact(...)` auf.
2. **Automatische Überlauf-Wiederherstellung**: nach einem Assistant-Fehler, der als Kontextüberlauf erkannt wird.
3. **Automatische Schwellenwert-Kompaktierung**: nach einem erfolgreichen Zug, wenn der Kontext den Schwellenwert überschreitet.

### Kompaktierungsform (visuell)

```text
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

### Überlauf-Wiederholung vs. Schwellenwert-Kompaktierung

Die beiden automatischen Pfade sind absichtlich unterschiedlich:

- **Überlauf-Wiederholungs-Kompaktierung**
  - Auslöser: Ein Assistant-Fehler des aktuellen Modells wird als Kontextüberlauf erkannt.
  - Die fehlgeschlagene Assistant-Fehlernachricht wird vor der Wiederholung aus dem aktiven Agent-Zustand entfernt.
  - Die automatische Kompaktierung wird mit `reason: "overflow"` und `willRetry: true` ausgeführt.
  - Bei Erfolg setzt der Agent automatisch fort (`agent.continue()`) nach der Kompaktierung.

- **Schwellenwert-Kompaktierung**
  - Auslöser: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Wird mit `reason: "threshold"` und `willRetry: false` ausgeführt.
  - Bei Erfolg wird, wenn `compaction.autoContinue !== false`, ein synthetischer Prompt injiziert:
    - `"Continue if you have next steps."`

### Vor-Kompaktierungs-Bereinigung

Vor den Kompaktierungsprüfungen kann eine Tool-Ergebnis-Bereinigung ausgeführt werden (`pruneToolOutputs`).

Standard-Bereinigungsrichtlinie:

- Die neuesten `40_000` Tool-Ausgabe-Token schützen.
- Mindestens `20_000` geschätzte Gesamteinsparungen an Token erfordern.
- Niemals Tool-Ergebnisse von `skill` oder `read` bereinigen.

Bereinigte Tool-Ergebnisse werden ersetzt durch:

- `[Output truncated - N tokens]`

Wenn die Bereinigung Einträge ändert, wird der Sitzungsspeicher neu geschrieben und der Agent-Nachrichtenzustand vor Kompaktierungsentscheidungen aktualisiert.

### Grenz- und Schnittpunkt-Logik

`prepareCompaction()` berücksichtigt nur Einträge seit dem letzten Kompaktierungseintrag (falls vorhanden).

1. Vorherigen Kompaktierungsindex finden.
2. `boundaryStart = prevCompactionIndex + 1` berechnen.
3. `keepRecentTokens` unter Verwendung des gemessenen Nutzungsverhältnisses anpassen, wenn verfügbar.
4. `findCutPoint()` über das Grenzfenster ausführen.

Gültige Schnittpunkte umfassen:

- Nachrichteneinträge mit Rollen: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message`-Einträge
- `branch_summary`-Einträge

Harte Regel: Niemals bei `toolResult` schneiden.

Wenn sich nicht-Nachrichten-Metadateneinträge unmittelbar vor dem Schnittpunkt befinden (`model_change`, `thinking_level_change`, Labels usw.), werden diese in den behaltenen Bereich gezogen, indem der Schnittindex rückwärts verschoben wird, bis eine Nachricht oder Kompaktierungsgrenze erreicht ist.

### Geteilte-Runde-Behandlung

Wenn der Schnittpunkt nicht am Beginn einer Benutzerrunde liegt, behandelt die Kompaktierung dies als geteilte Runde.

Die Rundenbeginn-Erkennung behandelt folgende als Benutzerrunden-Grenzen:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message`-Eintrag
- `branch_summary`-Eintrag

Die Kompaktierung bei geteilten Runden erzeugt zwei Zusammenfassungen:

1. Historie-Zusammenfassung (`messagesToSummarize`)
2. Runden-Präfix-Zusammenfassung (`turnPrefixMessages`)

Die endgültige gespeicherte Zusammenfassung wird zusammengeführt als:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Zusammenfassungsgenerierung

`compact(...)` erstellt Zusammenfassungen aus serialisiertem Konversationstext:

1. Nachrichten über `convertToLlm()` konvertieren.
2. Mit `serializeConversation()` serialisieren.
3. In `<conversation>...</conversation>` einwickeln.
4. Optional `<previous-summary>...</previous-summary>` einschließen.
5. Optional Hook-Kontext als `<additional-context>`-Liste injizieren.
6. Zusammenfassungs-Prompt mit `SUMMARIZATION_SYSTEM_PROMPT` ausführen.

Prompt-Auswahl:

- Erste Kompaktierung: `compaction-summary.md`
- Iterative Kompaktierung mit vorheriger Zusammenfassung: `compaction-update-summary.md`
- Geteilte-Runde zweiter Durchlauf: `compaction-turn-prefix.md`
- Kurze UI-Zusammenfassung: `compaction-short-summary.md`

Remote-Zusammenfassungsmodus:

- Wenn `compaction.remoteEndpoint` gesetzt ist, sendet die Kompaktierung einen POST:
  - `{ systemPrompt, prompt }`
- Erwartet JSON, das mindestens `{ summary }` enthält.

### Dateioperations-Kontext in Zusammenfassungen

Die Kompaktierung verfolgt kumulative Dateiaktivitäten anhand von Assistant-Tool-Aufrufen:

- `read(path)` → Lese-Menge
- `write(path)` → Geändert-Menge
- `edit(path)` → Geändert-Menge

Kumulatives Verhalten:

- Vorherige Kompaktierungsdetails werden nur einbezogen, wenn der vorherige Eintrag pi-generiert ist (`fromExtension !== true`).
- Bei geteilten Runden werden auch Runden-Präfix-Dateioperationen einbezogen.
- `readFiles` schließt Dateien aus, die auch geändert wurden.

Der Zusammenfassungstext erhält Datei-Tags, die über die Prompt-Vorlage angehängt werden:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistierung und Neuladung

Nach der Zusammenfassungsgenerierung (oder einer vom Hook bereitgestellten Zusammenfassung) führt die Agent-Sitzung folgendes aus:

1. `CompactionEntry` mit `appendCompaction(...)` anhängen.
2. Kontext über `buildSessionContext()` neu aufbauen.
3. Live-Agent-Nachrichten durch den neu aufgebauten Kontext ersetzen.
4. `session_compact`-Hook-Ereignis auslösen.

## Branch-Zusammenfassungs-Pipeline

Die Branch-Zusammenfassung ist an die Baumnavigation gebunden, nicht an den Token-Überlauf.

### Auslöser

Während `navigateTree(...)`:

1. Verlassene Einträge vom alten Blatt zum gemeinsamen Vorfahren mittels `collectEntriesForBranchSummary(...)` berechnen.
2. Wenn der Aufrufer eine Zusammenfassung angefordert hat (`options.summarize`), Zusammenfassung vor dem Blattwechsel generieren.
3. Wenn eine Zusammenfassung existiert, diese am Navigationsziel mittels `branchWithSummary(...)` anhängen.

Operativ wird dies üblicherweise durch den `/tree`-Ablauf gesteuert, wenn `branchSummary.enabled` aktiviert ist.

### Branch-Wechsel-Form (visuell)

```text
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D ─ [summary of B,C,D]
    A ───┤
         └─ E ─ F (new leaf)
```

### Vorbereitung und Token-Budget

`generateBranchSummary(...)` berechnet das Budget als:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` führt dann folgendes aus:

1. Erster Durchlauf: Kumulative Dateioperationen aus allen zusammenzufassenden Einträgen sammeln, einschließlich vorheriger pi-generierter `branch_summary`-Details.
2. Zweiter Durchlauf: Von neuest nach ältestgehend Nachrichten hinzufügen, bis das Token-Budget erreicht ist.
3. Bevorzugt die Beibehaltung des jüngsten Kontexts.
4. Kann dennoch große Zusammenfassungseinträge nahe der Budgetgrenze für Kontinuität einschließen.

Kompaktierungseinträge werden während der Branch-Zusammenfassungseingabe als Nachrichten (`compactionSummary`) einbezogen.

### Zusammenfassungsgenerierung und Persistierung

Branch-Zusammenfassung:

1. Konvertiert und serialisiert ausgewählte Nachrichten.
2. Wickelt sie in `<conversation>` ein.
3. Verwendet benutzerdefinierte Anweisungen, falls bereitgestellt, ansonsten `branch-summary.md`.
4. Ruft das Zusammenfassungsmodell mit `SUMMARIZATION_SYSTEM_PROMPT` auf.
5. Stellt `branch-summary-preamble.md` voran.
6. Hängt Dateioperations-Tags an.

Das Ergebnis wird als `BranchSummaryEntry` mit optionalen Details (`readFiles`, `modifiedFiles`) gespeichert.

## Erweiterungs- und Hook-Berührungspunkte

### `session_before_compact`

Vor-Kompaktierungs-Hook.

Kann:

- Kompaktierung abbrechen (`{ cancel: true }`)
- Vollständige benutzerdefinierte Kompaktierungs-Nutzlast bereitstellen (`{ compaction: CompactionResult }`)

### `session.compacting`

Prompt/Kontext-Anpassungs-Hook für die Standard-Kompaktierung.

Kann zurückgeben:

- `prompt` (Basis-Zusammenfassungs-Prompt überschreiben)
- `context` (zusätzliche Kontextzeilen, die in `<additional-context>` injiziert werden)
- `preserveData` (wird im Kompaktierungseintrag gespeichert)

### `session_compact`

Nach-Kompaktierungs-Benachrichtigung mit gespeichertem `compactionEntry` und `fromExtension`-Flag.

### `session_before_tree`

Wird bei der Baumnavigation vor der Standard-Branch-Zusammenfassungsgenerierung ausgeführt.

Kann:

- Navigation abbrechen
- Benutzerdefinierte `{ summary: { summary, details } }` bereitstellen, die verwendet wird, wenn der Benutzer eine Zusammenfassung angefordert hat

### `session_tree`

Nach-Navigations-Ereignis, das neues/altes Blatt und optionalen Zusammenfassungseintrag bereitstellt.

## Laufzeitverhalten und Fehler-Semantik

- Manuelle Kompaktierung bricht zuerst die aktuelle Agent-Operation ab.
- `abortCompaction()` bricht sowohl manuelle als auch automatische Kompaktierungs-Controller ab.
- Automatische Kompaktierung löst Start-/End-Sitzungsereignisse für UI-/Zustandsaktualisierungen aus.
- Automatische Kompaktierung kann mehrere Modellkandidaten ausprobieren und transiente Fehler wiederholen.
- Überlauffehler werden vom generischen Wiederholungspfad ausgeschlossen, da sie durch die Kompaktierung behandelt werden.
- Wenn die automatische Kompaktierung fehlschlägt:
  - Überlaufpfad gibt aus: `Context overflow recovery failed: ...`
  - Schwellenwertpfad gibt aus: `Auto-compaction failed: ...`
- Branch-Zusammenfassung kann über ein Abbruchsignal (z.B. Escape) abgebrochen werden und gibt ein abgebrochenes Navigationsergebnis zurück.

## Einstellungen und Standardwerte

Aus `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Diese Werte werden zur Laufzeit von `AgentSession` und den Kompaktierungs-/Branch-Zusammenfassungsmodulen verwendet.
