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

Kompaktierung und Branch-Zusammenfassungen sind die beiden Mechanismen, die lange Sitzungen nutzbar halten, ohne den Kontext vorheriger Arbeit zu verlieren.

- **Kompaktierung** schreibt alten Verlauf in eine Zusammenfassung auf dem aktuellen Branch um.
- **Branch-Zusammenfassung** erfasst den Kontext verlassener Branches während der `/tree`-Navigation.

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

## Sitzungseintrags-Modell

Kompaktierung und Branch-Zusammenfassungen sind erstklassige Sitzungseinträge, keine gewöhnlichen Assistenten-/Benutzer-Nachrichten.

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
2. Behaltene Einträge von `firstKeptEntryId` bis zum Kompaktierungspunkt werden wieder einbezogen.
3. Spätere Einträge auf dem Pfad werden angehängt.
4. `branch_summary`-Einträge werden in `branchSummary`-Nachrichten konvertiert.
5. `custom_message`-Einträge werden in `custom`-Nachrichten konvertiert.

Diese benutzerdefinierten Rollen werden dann in `convertToLlm()` unter Verwendung der statischen Vorlagen in LLM-gerichtete Benutzer-Nachrichten umgewandelt:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Kompaktierungs-Pipeline

### Auslöser

Die Kompaktierung kann auf drei Arten ausgeführt werden:

1. **Manuell**: `/compact [Anweisungen]` ruft `AgentSession.compact(...)` auf.
2. **Automatische Überlauf-Wiederherstellung**: nach einem Assistenten-Fehler, der als Kontextüberlauf erkannt wird.
3. **Automatische Schwellenwert-Kompaktierung**: nach einem erfolgreichen Zug, wenn der Kontext den Schwellenwert überschreitet.

### Kompaktierungsform (visuell)

```text
Vor der Kompaktierung:

  Eintrag:  0     1     2     3      4     5     6      7      8     9
          ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
          │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
          └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                  └────────┬───────┘ └──────────────┬──────────────┘
                 messagesToSummarize            behaltene Nachrichten
                                     ↑
                            firstKeptEntryId (Eintrag 4)

Nach der Kompaktierung (neuer Eintrag angehängt):

  Eintrag:  0     1     2     3      4     5     6      7      8     9      10
          ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
          │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
          └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
                 └──────────┬──────┘ └──────────────────────┬───────────────────┘
                   nicht an LLM gesendet              an LLM gesendet
                                                           ↑
                                                startet ab firstKeptEntryId

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
  - Auslöser: Der Assistenten-Fehler des aktuellen Modells wird als Kontextüberlauf erkannt.
  - Die fehlgeschlagene Assistenten-Fehlernachricht wird vor der Wiederholung aus dem aktiven Agenten-Zustand entfernt.
  - Die automatische Kompaktierung läuft mit `reason: "overflow"` und `willRetry: true`.
  - Bei Erfolg setzt der Agent automatisch fort (`agent.continue()`) nach der Kompaktierung.

- **Schwellenwert-Kompaktierung**
  - Auslöser: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Läuft mit `reason: "threshold"` und `willRetry: false`.
  - Bei Erfolg wird, wenn `compaction.autoContinue !== false`, ein synthetischer Prompt eingefügt:
    - `"Continue if you have next steps."`

### Bereinigung vor der Kompaktierung

Vor den Kompaktierungsprüfungen kann die Tool-Ergebnis-Bereinigung ausgeführt werden (`pruneToolOutputs`).

Standard-Bereinigungsrichtlinie:

- Die neuesten `40_000` Tool-Ausgabe-Token schützen.
- Mindestens `20_000` geschätzte Gesamteinsparungen erfordern.
- Niemals Tool-Ergebnisse von `skill` oder `read` bereinigen.

Bereinigte Tool-Ergebnisse werden ersetzt durch:

- `[Output truncated - N tokens]`

Wenn die Bereinigung Einträge ändert, wird der Sitzungsspeicher neu geschrieben und der Agenten-Nachrichtenstatus vor den Kompaktierungsentscheidungen aktualisiert.

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

Wenn sich nicht-nachrichtenbezogene Metadaten-Einträge direkt vor dem Schnittpunkt befinden (`model_change`, `thinking_level_change`, Labels usw.), werden sie in den behaltenen Bereich gezogen, indem der Schnittindex rückwärts verschoben wird, bis eine Nachricht oder Kompaktierungsgrenze erreicht ist.

### Aufgeteilte-Runde-Behandlung

Wenn der Schnittpunkt nicht am Anfang einer Benutzer-Runde liegt, behandelt die Kompaktierung dies als aufgeteilte Runde.

Die Rundenstartserkennung behandelt diese als Benutzer-Rundengrenzen:

- `message.role === "user"`
- `message.role === "bashExecution"`
- `custom_message`-Eintrag
- `branch_summary`-Eintrag

Die Kompaktierung aufgeteilter Runden generiert zwei Zusammenfassungen:

1. Verlaufszusammenfassung (`messagesToSummarize`)
2. Runden-Präfix-Zusammenfassung (`turnPrefixMessages`)

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
3. In `<conversation>...</conversation>` einschließen.
4. Optional `<previous-summary>...</previous-summary>` einfügen.
5. Optional Hook-Kontext als `<additional-context>`-Liste einfügen.
6. Zusammenfassungs-Prompt mit `SUMMARIZATION_SYSTEM_PROMPT` ausführen.

Prompt-Auswahl:

- Erste Kompaktierung: `compaction-summary.md`
- Iterative Kompaktierung mit vorheriger Zusammenfassung: `compaction-update-summary.md`
- Zweiter Durchgang für aufgeteilte Runden: `compaction-turn-prefix.md`
- Kurze UI-Zusammenfassung: `compaction-short-summary.md`

Remote-Zusammenfassungsmodus:

- Wenn `compaction.remoteEndpoint` gesetzt ist, sendet die Kompaktierung per POST:
  - `{ systemPrompt, prompt }`
- Erwartet JSON mit mindestens `{ summary }`.

### Dateioperations-Kontext in Zusammenfassungen

Die Kompaktierung verfolgt kumulative Dateiaktivität anhand von Assistenten-Tool-Aufrufen:

- `read(path)` → Lese-Menge
- `write(path)` → Modifiziert-Menge
- `edit(path)` → Modifiziert-Menge

Kumulatives Verhalten:

- Enthält vorherige Kompaktierungsdetails nur, wenn der vorherige Eintrag pi-generiert ist (`fromExtension !== true`).
- Bei aufgeteilten Runden werden auch Runden-Präfix-Dateioperationen einbezogen.
- `readFiles` schließt auch modifizierte Dateien aus.

Der Zusammenfassungstext erhält über die Prompt-Vorlage angehängte Datei-Tags:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistierung und Neuladen

Nach der Zusammenfassungsgenerierung (oder der durch Hooks bereitgestellten Zusammenfassung) führt die Agenten-Sitzung folgende Schritte aus:

1. `CompactionEntry` mit `appendCompaction(...)` anhängen.
2. Kontext über `buildSessionContext()` neu aufbauen.
3. Live-Agenten-Nachrichten durch den neu aufgebauten Kontext ersetzen.
4. `session_compact`-Hook-Event auslösen.

## Branch-Zusammenfassungs-Pipeline

Die Branch-Zusammenfassung ist an die Baum-Navigation gebunden, nicht an den Token-Überlauf.

### Auslöser

Während `navigateTree(...)`:

1. Verlassene Einträge vom alten Blatt zum gemeinsamen Vorfahren mithilfe von `collectEntriesForBranchSummary(...)` berechnen.
2. Wenn der Aufrufer eine Zusammenfassung angefordert hat (`options.summarize`), vor dem Blattwechsel eine Zusammenfassung generieren.
3. Wenn eine Zusammenfassung vorhanden ist, diese am Navigationsziel mit `branchWithSummary(...)` anhängen.

Operativ wird dies üblicherweise durch den `/tree`-Ablauf gesteuert, wenn `branchSummary.enabled` aktiviert ist.

### Branch-Wechselform (visuell)

```text
Baum vor der Navigation:

         ┌─ B ─ C ─ D (altes Blatt, wird verlassen)
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

`prepareBranchEntries(...)` führt dann Folgendes aus:

1. Erster Durchgang: Kumulative Dateioperationen aus allen zusammengefassten Einträgen sammeln, einschließlich vorheriger pi-generierter `branch_summary`-Details.
2. Zweiter Durchgang: Von neuesten zu ältesten gehen, Nachrichten hinzufügen, bis das Token-Budget erreicht ist.
3. Bevorzugt den jüngsten Kontext behalten.
4. Kann dennoch große Zusammenfassungseinträge nahe der Budgetgrenze für Kontinuität einschließen.

Kompaktierungseinträge werden während der Branch-Zusammenfassungseingabe als Nachrichten (`compactionSummary`) einbezogen.

### Zusammenfassungsgenerierung und Persistierung

Branch-Zusammenfassung:

1. Ausgewählte Nachrichten konvertieren und serialisieren.
2. In `<conversation>` einschließen.
3. Benutzerdefinierte Anweisungen verwenden, falls angegeben, andernfalls `branch-summary.md`.
4. Zusammenfassungsmodell mit `SUMMARIZATION_SYSTEM_PROMPT` aufrufen.
5. `branch-summary-preamble.md` voranstellen.
6. Dateioperations-Tags anhängen.

Das Ergebnis wird als `BranchSummaryEntry` mit optionalen Details (`readFiles`, `modifiedFiles`) gespeichert.

## Erweiterungs- und Hook-Berührungspunkte

### `session_before_compact`

Vor-Kompaktierungs-Hook.

Kann:

- Die Kompaktierung abbrechen (`{ cancel: true }`)
- Eine vollständig benutzerdefinierte Kompaktierungs-Nutzlast bereitstellen (`{ compaction: CompactionResult }`)

### `session.compacting`

Prompt-/Kontext-Anpassungs-Hook für die Standard-Kompaktierung.

Kann zurückgeben:

- `prompt` (überschreibt den Basis-Zusammenfassungs-Prompt)
- `context` (zusätzliche Kontextzeilen, die in `<additional-context>` eingefügt werden)
- `preserveData` (wird im Kompaktierungseintrag gespeichert)

### `session_compact`

Nach-Kompaktierungs-Benachrichtigung mit gespeichertem `compactionEntry` und `fromExtension`-Flag.

### `session_before_tree`

Läuft bei der Baum-Navigation vor der Standard-Branch-Zusammenfassungsgenerierung.

Kann:

- Die Navigation abbrechen
- Eine benutzerdefinierte `{ summary: { summary, details } }` bereitstellen, die verwendet wird, wenn der Benutzer eine Zusammenfassung angefordert hat

### `session_tree`

Nach-Navigations-Event, das das neue/alte Blatt und den optionalen Zusammenfassungseintrag offenlegt.

## Laufzeitverhalten und Fehlersemantik

- Manuelle Kompaktierung bricht zuerst die aktuelle Agentenoperation ab.
- `abortCompaction()` bricht sowohl manuelle als auch automatische Kompaktierungs-Controller ab.
- Automatische Kompaktierung sendet Start-/End-Sitzungsereignisse für UI-/Zustandsaktualisierungen.
- Automatische Kompaktierung kann mehrere Modellkandidaten versuchen und vorübergehende Fehler wiederholen.
- Überlauffehler werden vom generischen Wiederholungspfad ausgeschlossen, da sie durch die Kompaktierung behandelt werden.
- Wenn die automatische Kompaktierung fehlschlägt:
  - Überlaufpfad gibt aus: `Context overflow recovery failed: ...`
  - Schwellenwertpfad gibt aus: `Auto-compaction failed: ...`
- Die Branch-Zusammenfassung kann über ein Abbruchsignal (z. B. Escape) abgebrochen werden und gibt ein abgebrochenes Navigationsergebnis zurück.

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
