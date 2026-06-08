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

Kompaktierung und Branch-Zusammenfassungen sind die beiden Mechanismen, die lange Sitzungen nutzbar halten, ohne den bisherigen Arbeitskontext zu verlieren.

- **Kompaktierung** schreibt alten Verlauf in eine Zusammenfassung auf dem aktuellen Branch um.
- **Branch-Zusammenfassung** erfasst den Kontext aufgegebener Branches während der `/tree`-Navigation.

Beide werden als Sitzungseinträge persistiert und beim Neuaufbau der LLM-Eingabe in User-Kontext-Nachrichten zurückkonvertiert.

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

## Sitzungseintragsmodell

Kompaktierung und Branch-Zusammenfassungen sind erstklassige Sitzungseinträge, keine einfachen Assistant-/User-Nachrichten.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, optionales `shortSummary`
  - `firstKeptEntryId` (Kompaktierungsgrenze)
  - `tokensBefore`
  - optionale `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - optionale `details`, `fromExtension`

Wenn der Kontext neu aufgebaut wird (`buildSessionContext`):

1. Die neueste Kompaktierung auf dem aktiven Pfad wird in eine `compactionSummary`-Nachricht konvertiert.
2. Beibehaltene Einträge von `firstKeptEntryId` bis zum Kompaktierungspunkt werden erneut einbezogen.
3. Spätere Einträge auf dem Pfad werden angehängt.
4. `branch_summary`-Einträge werden in `branchSummary`-Nachrichten konvertiert.
5. `custom_message`-Einträge werden in `custom`-Nachrichten konvertiert.

Diese benutzerdefinierten Rollen werden dann in `convertToLlm()` unter Verwendung der statischen Vorlagen in LLM-seitige User-Nachrichten umgewandelt:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Kompaktierungspipeline

### Auslöser

Die Kompaktierung kann auf drei Arten ausgeführt werden:

1. **Manuell**: `/compact [anweisungen]` ruft `AgentSession.compact(...)` auf.
2. **Automatische Überlauf-Wiederherstellung**: nach einem Assistant-Fehler, der als Kontextüberlauf erkannt wird.
3. **Automatische Schwellenwert-Kompaktierung**: nach einem erfolgreichen Turn, wenn der Kontext den Schwellenwert überschreitet.

### Kompaktierungsform (visuell)

```text
Vor der Kompaktierung:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Nach der Kompaktierung (neuer Eintrag angehängt):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 nicht an LLM gesendet               an LLM gesendet
                                                         ↑
                                              beginnt ab firstKeptEntryId

Was das LLM sieht:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   von cmp          Nachrichten ab firstKeptEntryId
```

### Überlauf-Wiederholung vs. Schwellenwert-Kompaktierung

Die beiden automatischen Pfade sind absichtlich unterschiedlich:

- **Überlauf-Wiederholungs-Kompaktierung**
  - Auslöser: Ein Assistant-Fehler des aktuellen Modells wird als Kontextüberlauf erkannt.
  - Die fehlgeschlagene Assistant-Fehlernachricht wird vor der Wiederholung aus dem aktiven Agentenstatus entfernt.
  - Die automatische Kompaktierung läuft mit `reason: "overflow"` und `willRetry: true`.
  - Bei Erfolg setzt der Agent automatisch fort (`agent.continue()`) nach der Kompaktierung.

- **Schwellenwert-Kompaktierung**
  - Auslöser: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Läuft mit `reason: "threshold"` und `willRetry: false`.
  - Bei Erfolg, wenn `compaction.autoContinue !== false`, wird ein synthetischer Prompt injiziert:
    - `"Continue if you have next steps."`

### Bereinigung vor der Kompaktierung

Vor den Kompaktierungsprüfungen kann eine Tool-Ergebnis-Bereinigung ausgeführt werden (`pruneToolOutputs`).

Standard-Bereinigungsrichtlinie:

- Schütze die neuesten `40_000` Tool-Output-Token.
- Erfordere mindestens `20_000` geschätzte Gesamteinsparungen.
- Bereinige niemals Tool-Ergebnisse von `skill` oder `read`.

Bereinigte Tool-Ergebnisse werden ersetzt durch:

- `[Output truncated - N tokens]`

Wenn die Bereinigung Einträge ändert, wird der Sitzungsspeicher neu geschrieben und der Agent-Nachrichtenstatus vor den Kompaktierungsentscheidungen aktualisiert.

### Grenz- und Schnittpunktlogik

`prepareCompaction()` berücksichtigt nur Einträge seit dem letzten Kompaktierungseintrag (falls vorhanden).

1. Vorherigen Kompaktierungsindex finden.
2. `boundaryStart = prevCompactionIndex + 1` berechnen.
3. `keepRecentTokens` anhand des gemessenen Nutzungsverhältnisses anpassen, wenn verfügbar.
4. `findCutPoint()` über das Grenzfenster ausführen.

Gültige Schnittpunkte umfassen:

- Nachrichteneinträge mit den Rollen: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- `custom_message`-Einträge
- `branch_summary`-Einträge

Harte Regel: Niemals bei `toolResult` schneiden.

Wenn sich unmittelbar vor dem Schnittpunkt Nicht-Nachrichten-Metadateneinträge befinden (`model_change`, `thinking_level_change`, Labels usw.), werden diese in den beibehaltenen Bereich gezogen, indem der Schnittindex rückwärts verschoben wird, bis eine Nachricht oder Kompaktierungsgrenze erreicht ist.

### Behandlung geteilter Turns

Wenn der Schnittpunkt nicht am Beginn eines User-Turns liegt, behandelt die Kompaktierung dies als geteilten Turn.

Die Turn-Start-Erkennung behandelt folgende als User-Turn-Grenzen:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message`-Eintrag
- `branch_summary`-Eintrag

Die Kompaktierung geteilter Turns generiert zwei Zusammenfassungen:

1. Verlaufszusammenfassung (`messagesToSummarize`)
2. Turn-Präfix-Zusammenfassung (`turnPrefixMessages`)

Die endgültig gespeicherte Zusammenfassung wird zusammengeführt als:

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
3. In `<conversation>...</conversation>` einbetten.
4. Optional `<previous-summary>...</previous-summary>` einbeziehen.
5. Optional Hook-Kontext als `<additional-context>`-Liste injizieren.
6. Zusammenfassungs-Prompt mit `SUMMARIZATION_SYSTEM_PROMPT` ausführen.

Prompt-Auswahl:

- Erste Kompaktierung: `compaction-summary.md`
- Iterative Kompaktierung mit vorheriger Zusammenfassung: `compaction-update-summary.md`
- Zweiter Durchlauf bei geteiltem Turn: `compaction-turn-prefix.md`
- Kurze UI-Zusammenfassung: `compaction-short-summary.md`

Remote-Zusammenfassungsmodus:

- Wenn `compaction.remoteEndpoint` gesetzt ist, sendet die Kompaktierung per POST:
  - `{ systemPrompt, prompt }`
- Erwartet JSON mit mindestens `{ summary }`.

### Dateioperationskontext in Zusammenfassungen

Die Kompaktierung verfolgt kumulative Dateiaktivität anhand von Assistant-Tool-Aufrufen:

- `read(path)` → Lese-Set
- `write(path)` → Modifiziert-Set
- `edit(path)` → Modifiziert-Set

Kumulatives Verhalten:

- Bezieht vorherige Kompaktierungsdetails nur ein, wenn der vorherige Eintrag pi-generiert ist (`fromExtension !== true`).
- Bei geteilten Turns werden auch Turn-Präfix-Dateioperationen einbezogen.
- `readFiles` schließt ebenfalls modifizierte Dateien aus.

Der Zusammenfassungstext erhält Datei-Tags, die über die Prompt-Vorlage angehängt werden:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistierung und Neuladen

Nach der Zusammenfassungsgenerierung (oder einer hook-bereitgestellten Zusammenfassung) führt die Agent-Sitzung folgendes aus:

1. `CompactionEntry` mit `appendCompaction(...)` anhängen.
2. Kontext über `buildSessionContext()` neu aufbauen.
3. Live-Agent-Nachrichten durch den neu aufgebauten Kontext ersetzen.
4. `session_compact`-Hook-Event auslösen.

## Branch-Zusammenfassungspipeline

Die Branch-Zusammenfassung ist an die Baumnavigation gebunden, nicht an den Tokenüberlauf.

### Auslöser

Während `navigateTree(...)`:

1. Aufgegebene Einträge vom alten Blatt zum gemeinsamen Vorfahren mit `collectEntriesForBranchSummary(...)` ermitteln.
2. Wenn der Aufrufer eine Zusammenfassung angefordert hat (`options.summarize`), Zusammenfassung vor dem Blattwechsel generieren.
3. Wenn eine Zusammenfassung existiert, diese am Navigationsziel mit `branchWithSummary(...)` anhängen.

Operativ wird dies üblicherweise durch den `/tree`-Ablauf gesteuert, wenn `branchSummary.enabled` aktiviert ist.

### Branch-Wechselform (visuell)

```text
Baum vor der Navigation:

         ┌─ B ─ C ─ D (altes Blatt, wird aufgegeben)
    A ───┤
         └─ E ─ F (Ziel)

Gemeinsamer Vorfahre: A
Zu zusammenfassende Einträge: B, C, D

Nach der Navigation mit Zusammenfassung:

         ┌─ B ─ C ─ D ─ [Zusammenfassung von B,C,D]
    A ───┤
         └─ E ─ F (neues Blatt)
```

### Vorbereitung und Token-Budget

`generateBranchSummary(...)` berechnet das Budget als:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` führt dann aus:

1. Erster Durchlauf: Kumulative Dateioperationen aus allen zusammenzufassenden Einträgen sammeln, einschließlich vorheriger pi-generierter `branch_summary`-Details.
2. Zweiter Durchlauf: Von neuesten zu ältesten durchgehen, Nachrichten hinzufügen bis das Token-Budget erreicht ist.
3. Bevorzugt die Beibehaltung von aktuellem Kontext.
4. Kann dennoch große Zusammenfassungseinträge nahe der Budgetgrenze für Kontinuität einbeziehen.

Kompaktierungseinträge werden während der Branch-Zusammenfassungseingabe als Nachrichten (`compactionSummary`) einbezogen.

### Zusammenfassungsgenerierung und Persistierung

Branch-Zusammenfassung:

1. Konvertiert und serialisiert ausgewählte Nachrichten.
2. Bettet diese in `<conversation>` ein.
3. Verwendet benutzerdefinierte Anweisungen falls angegeben, andernfalls `branch-summary.md`.
4. Ruft das Zusammenfassungsmodell mit `SUMMARIZATION_SYSTEM_PROMPT` auf.
5. Stellt `branch-summary-preamble.md` voran.
6. Hängt Dateioperations-Tags an.

Das Ergebnis wird als `BranchSummaryEntry` mit optionalen Details (`readFiles`, `modifiedFiles`) gespeichert.

## Erweiterungs- und Hook-Berührungspunkte

### `session_before_compact`

Vor-Kompaktierungs-Hook.

Kann:

- Kompaktierung abbrechen (`{ cancel: true }`)
- vollständige benutzerdefinierte Kompaktierungsnutzlast bereitstellen (`{ compaction: CompactionResult }`)

### `session.compacting`

Prompt-/Kontext-Anpassungs-Hook für die Standard-Kompaktierung.

Kann zurückgeben:

- `prompt` (überschreibt den Basis-Zusammenfassungs-Prompt)
- `context` (zusätzliche Kontextzeilen, die in `<additional-context>` injiziert werden)
- `preserveData` (wird im Kompaktierungseintrag gespeichert)

### `session_compact`

Nach-Kompaktierungs-Benachrichtigung mit gespeichertem `compactionEntry` und `fromExtension`-Flag.

### `session_before_tree`

Wird bei der Baumnavigation vor der Standard-Branch-Zusammenfassungsgenerierung ausgeführt.

Kann:

- Navigation abbrechen
- benutzerdefinierte `{ summary: { summary, details } }` bereitstellen, die verwendet werden, wenn der Benutzer eine Zusammenfassung angefordert hat

### `session_tree`

Nach-Navigations-Event, das neues/altes Blatt und optionalen Zusammenfassungseintrag exponiert.

## Laufzeitverhalten und Fehlersemantik

- Manuelle Kompaktierung bricht zuerst die aktuelle Agentenoperation ab.
- `abortCompaction()` bricht sowohl manuelle als auch automatische Kompaktierungs-Controller ab.
- Automatische Kompaktierung sendet Start-/End-Sitzungsevents für UI-/Statusaktualisierungen.
- Automatische Kompaktierung kann mehrere Modellkandidaten ausprobieren und vorübergehende Fehler wiederholen.
- Überlauffehler werden vom generischen Wiederholungspfad ausgeschlossen, da sie durch die Kompaktierung behandelt werden.
- Wenn die automatische Kompaktierung fehlschlägt:
  - Überlaufpfad gibt aus: `Context overflow recovery failed: ...`
  - Schwellenwertpfad gibt aus: `Auto-compaction failed: ...`
- Branch-Zusammenfassung kann über ein Abbruchsignal abgebrochen werden (z.B. Escape), was ein abgebrochenes Navigationsergebnis zurückgibt.

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
