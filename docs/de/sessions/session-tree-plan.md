---
title: Session-Baumarchitektur
description: >-
  Session-Baumarchitektur mit Verzweigung, Navigation und
  Eltern-Kind-Konversationsbeziehungen.
sidebar:
  order: 2
  label: Baumarchitektur
i18n:
  sourceHash: bd8b78d6c33a
  translator: machine
---

# Session-Baumarchitektur (aktuell)

Referenz: [session.md](./session.md)

Dieses Dokument beschreibt, wie die Session-Baumnavigation heute funktioniert: In-Memory-Baummodell, Blattbewegungsregeln, Verzweigungsverhalten und Extension-/Event-Integration.

## Was dieses Subsystem ist

Die Session wird als Append-Only-Eintragslog gespeichert, aber das Laufzeitverhalten ist baumbasiert:

- Jeder Nicht-Header-Eintrag hat `id` und `parentId`.
- Die aktive Position ist `leafId` im `SessionManager`.
- Das Anhängen eines Eintrags erstellt immer ein Kind des aktuellen Blattes.
- Verzweigung schreibt die Historie **nicht** um; sie ändert nur, wohin das Blatt vor dem nächsten Anhängen zeigt.

Wichtige Dateien:

- `src/session/session-manager.ts` — Baumdatenmodell, Traversierung, Blattbewegung, Branch-/Session-Extraktion
- `src/session/agent-session.ts` — `/tree`-Navigationsfluss, Zusammenfassung, Hook-/Event-Emission
- `src/modes/components/tree-selector.ts` — Interaktives Baum-UI-Verhalten und Filterung
- `src/modes/controllers/selector-controller.ts` — Selektor-Orchestrierung für `/tree` und `/branch`
- `src/modes/controllers/input-controller.ts` — Befehlsrouting (`/tree`, `/branch`, Doppel-Escape-Verhalten)
- `src/session/messages.ts` — Konvertierung von `branch_summary`-, `compaction`- und `custom_message`-Einträgen in LLM-Kontextnachrichten

## Baumdatenmodell im `SessionManager`

Laufzeit-Indizes:

- `#byId: Map<string, SessionEntry>` — schnelles Nachschlagen für jeden Eintrag
- `#leafId: string | null` — aktuelle Position im Baum
- `#labelsById: Map<string, string>` — aufgelöste Labels nach Zieleintrag-ID

Baum-APIs:

- `getBranch(fromId?)` folgt den Elternverknüpfungen bis zur Wurzel und gibt den Wurzel→Knoten-Pfad zurück
- `getTree()` gibt `SessionTreeNode[]` zurück (`entry`, `children`, `label`)
  - Elternverknüpfungen werden zu Kinder-Arrays
  - Einträge mit fehlenden Eltern werden als Wurzeln behandelt
  - Kinder werden nach Zeitstempel älteste→neueste sortiert
- `getChildren(parentId)` gibt direkte Kinder zurück
- `getLabel(id)` löst das aktuelle Label aus `labelsById` auf

`getTree()` ist eine Laufzeitprojektion; die Persistenz bleibt bei Append-Only-JSONL-Einträgen.

## Blattbewegungssemantik

Es gibt drei Blattbewegungs-Primitive:

1. `branch(entryId)`
   - Validiert, dass der Eintrag existiert
   - Setzt `leafId = entryId`
   - Es wird kein neuer Eintrag geschrieben

2. `resetLeaf()`
   - Setzt `leafId = null`
   - Der nächste Anhängevorgang erstellt einen neuen Wurzeleintrag (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Akzeptiert `branchFromId: string | null`
   - Setzt `leafId = branchFromId`
   - Hängt einen `branch_summary`-Eintrag als Kind dieses Blattes an
   - Wenn `branchFromId` `null` ist, wird `fromId` als `"root"` persistiert

## `/tree`-Navigationsverhalten (gleiche Session-Datei)

`AgentSession.navigateTree()` ist Navigation, kein Datei-Forking.

Ablauf:

1. Ziel validieren und verlassenen Pfad berechnen (`collectEntriesForBranchSummary`)
2. `session_before_tree` mit `TreePreparation` emittieren
3. Optional verlassene Einträge zusammenfassen (Hook-bereitgestellte Zusammenfassung oder eingebauter Summarizer)
4. Neues Blattziel berechnen:
   - Auswahl einer **user**-Nachricht: Blatt bewegt sich zum Elternteil, und der Nachrichtentext wird für die Editor-Vorbefüllung zurückgegeben
   - Auswahl einer **custom_message**: gleiche Regel wie bei User-Nachrichten (Blatt = Elternteil, Text befüllt Editor vor)
   - Auswahl eines anderen Eintrags: Blatt = ausgewählte Eintrags-ID
5. Blattbewegung anwenden:
   - mit Zusammenfassung: `branchWithSummary(newLeafId, ...)`
   - ohne Zusammenfassung und `newLeafId === null`: `resetLeaf()`
   - andernfalls: `branch(newLeafId)`
6. Agentenkontext vom neuen Blatt neu aufbauen und `session_tree` emittieren

Wichtig: Zusammenfassungseinträge werden an der **neuen Navigationsposition** angehängt, nicht am Ende des verlassenen Zweigs.

## `/branch`-Verhalten (neue Session-Datei)

`/branch` und `/tree` sind absichtlich unterschiedlich:

- `/tree` navigiert innerhalb der aktuellen Session-Datei.
- `/branch` erstellt eine neue Session-Branch-Datei (oder einen In-Memory-Ersatz im nicht-persistenten Modus).

Benutzerorientierter `/branch`-Ablauf (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- Die Branch-Quelle muss eine **User-Nachricht** sein.
- Der ausgewählte Benutzertext wird für die Editor-Vorbefüllung extrahiert.
- Wenn die ausgewählte User-Nachricht die Wurzel ist (`parentId === null`): Eine neue Session über `newSession({ parentSession: previousSessionFile })` starten.
- Andernfalls: `createBranchedSession(selectedEntry.parentId)` um die Historie bis zur ausgewählten Prompt-Grenze zu forken.

`SessionManager.createBranchedSession(leafId)` Spezifika:

- Baut den Wurzel→Blatt-Pfad über `getBranch(leafId)` auf; wirft einen Fehler, wenn nicht vorhanden.
- Schließt bestehende `label`-Einträge vom kopierten Pfad aus.
- Baut frische Label-Einträge aus aufgelösten `labelsById` für Einträge neu auf, die im Pfad verbleiben.
- Persistenter Modus: schreibt eine neue JSONL-Datei und wechselt den Manager dorthin; gibt den neuen Dateipfad zurück.
- In-Memory-Modus: ersetzt In-Memory-Einträge; gibt `undefined` zurück.

## Kontextrekonstruktion und Summary-/Custom-Integration

`buildSessionContext()` (in `session-manager.ts`) löst den aktiven Wurzel→Blatt-Pfad auf und baut den effektiven LLM-Kontextzustand auf:

- Verfolgt den neuesten Thinking-/Modell-/Modus-/TTSR-Zustand auf dem Pfad.
- Behandelt die neueste Kompaktierung auf dem Pfad:
  - gibt zuerst die Kompaktierungszusammenfassung aus
  - spielt behaltene Nachrichten von `firstKeptEntryId` bis zum Kompaktierungspunkt ab
  - spielt dann Post-Kompaktierungs-Nachrichten ab
- Inkludiert `branch_summary`- und `custom_message`-Einträge als `AgentMessage`-Objekte.

`session/messages.ts` mappt dann diese Nachrichtentypen für die Modelleingabe:

- `branchSummary` und `compactionSummary` werden zu User-Rolle-Template-Kontextnachrichten
- `custom`/`hookMessage` werden zu User-Rolle-Inhaltsnachrichten

Baumbewegung ändert also den Kontext, indem sie den aktiven Blattpfad ändert, nicht durch Mutation alter Einträge.

## Labels und Baum-UI-Verhalten

Label-Persistenz:

- `appendLabelChange(targetId, label?)` schreibt `label`-Einträge auf der aktuellen Blattkette.
- `labelsById` wird sofort aktualisiert (setzen oder löschen).
- `getTree()` löst das aktuelle Label auf jedem zurückgegebenen Knoten auf.

Baum-Selektor-Verhalten (`tree-selector.ts`):

- Flacht den Baum für die Navigation ab, behält die Hervorhebung des aktiven Pfads bei und priorisiert die Anzeige des aktiven Zweigs zuerst.
- Unterstützt Filtermodi: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Unterstützt Freitext-Suche über gerenderten semantischen Inhalt.
- `Shift+L` öffnet die Inline-Label-Bearbeitung und schreibt über `appendLabelChange`.

Befehlsrouting:

- `/tree` öffnet immer den Baum-Selektor.
- `/branch` öffnet den User-Nachrichten-Selektor, es sei denn `doubleEscapeAction=tree`, in diesem Fall wird auch die Baum-Selektor-UX verwendet.

## Extension- und Hook-Berührungspunkte für Baumoperationen

Befehlszeit-Extension-API (`ExtensionCommandContext`):

- `branch(entryId)` — verzweigte Session-Datei erstellen
- `navigateTree(targetId, { summarize? })` — innerhalb des aktuellen Baums/der Datei bewegen

Events rund um die Baumnavigation:

- `session_before_tree`
  - empfängt `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - kann die Navigation abbrechen
  - kann eine Zusammenfassungs-Payload bereitstellen, die anstelle des eingebauten Summarizers verwendet wird
  - empfängt Abbruch-`signal` (Escape-Abbruchpfad)
- `session_tree`
  - emittiert `newLeafId`, `oldLeafId`
  - enthält `summaryEntry`, wenn eine Zusammenfassung erstellt wurde
  - `fromExtension` gibt den Zusammenfassungsursprung an

Angrenzende, aber verwandte Lebenszyklus-Hooks:

- `session_before_branch` / `session_branch` für den `/branch`-Ablauf
- `session_before_compact`, `session.compacting`, `session_compact` für Kompaktierungseinträge, die später die Baum-Kontextrekonstruktion beeinflussen

## Reale Einschränkungen und Randbedingungen

- `branch()` kann nicht `null` als Ziel haben; verwenden Sie `resetLeaf()` für den Zustand vor dem ersten Eintrag an der Wurzel.
- `branchWithSummary()` unterstützt `null` als Ziel und zeichnet `fromId: "root"` auf.
- Die Auswahl des aktuellen Blattes im Baum-Selektor ist ein No-Op.
- Zusammenfassung erfordert ein aktives Modell; falls keines vorhanden, schlägt die Zusammenfassungsnavigation sofort fehl.
- Wenn die Zusammenfassung abgebrochen wird, wird die Navigation abgebrochen und das Blatt bleibt unverändert.
- In-Memory-Sessions geben niemals einen Branch-Dateipfad von `createBranchedSession` zurück.

## Noch vorhandene Legacy-Kompatibilität

Session-Migrationen werden beim Laden noch ausgeführt:

- v1→v2 fügt `id`/`parentId` hinzu und konvertiert den Kompaktierungsindex-Anker in einen ID-Anker
- v2→v3 migriert die Legacy-`hookMessage`-Rolle zu `custom`

Das aktuelle Laufzeitverhalten ist Version-3-Baumsemantik nach der Migration.
