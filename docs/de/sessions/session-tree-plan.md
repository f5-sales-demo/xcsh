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

Die Session wird als Append-only-Eintragsprotokoll gespeichert, aber das Laufzeitverhalten ist baumbasiert:

- Jeder Nicht-Header-Eintrag hat `id` und `parentId`.
- Die aktive Position ist `leafId` im `SessionManager`.
- Das Anhängen eines Eintrags erzeugt immer ein Kind des aktuellen Blatts.
- Verzweigung schreibt die Historie **nicht** um; sie ändert nur, wohin das Blatt vor dem nächsten Anhängen zeigt.

Schlüsseldateien:

- `src/session/session-manager.ts` — Baumdatenmodell, Traversierung, Blattbewegung, Branch-/Session-Extraktion
- `src/session/agent-session.ts` — `/tree`-Navigationsablauf, Zusammenfassung, Hook-/Event-Emission
- `src/modes/components/tree-selector.ts` — Interaktives Baum-UI-Verhalten und Filterung
- `src/modes/controllers/selector-controller.ts` — Selector-Orchestrierung für `/tree` und `/branch`
- `src/modes/controllers/input-controller.ts` — Befehlsrouting (`/tree`, `/branch`, Doppel-Escape-Verhalten)
- `src/session/messages.ts` — Konvertierung von `branch_summary`-, `compaction`- und `custom_message`-Einträgen in LLM-Kontextnachrichten

## Baumdatenmodell in `SessionManager`

Laufzeitindizes:

- `#byId: Map<string, SessionEntry>` — schnelle Suche für jeden Eintrag
- `#leafId: string | null` — aktuelle Position im Baum
- `#labelsById: Map<string, string>` — aufgelöste Labels nach Zieleintrags-ID

Baum-APIs:

- `getBranch(fromId?)` folgt den Elternverknüpfungen zur Wurzel und gibt den Wurzel→Knoten-Pfad zurück
- `getTree()` gibt `SessionTreeNode[]` zurück (`entry`, `children`, `label`)
  - Elternverknüpfungen werden zu Kind-Arrays
  - Einträge mit fehlenden Eltern werden als Wurzeln behandelt
  - Kinder werden älteste→neueste nach Zeitstempel sortiert
- `getChildren(parentId)` gibt direkte Kinder zurück
- `getLabel(id)` löst das aktuelle Label aus `labelsById` auf

`getTree()` ist eine Laufzeitprojektion; die Persistenz bleibt bei Append-only-JSONL-Einträgen.

## Blattbewegungssemantik

Es gibt drei Blattbewegungs-Primitive:

1. `branch(entryId)`
   - Validiert, dass der Eintrag existiert
   - Setzt `leafId = entryId`
   - Es wird kein neuer Eintrag geschrieben

2. `resetLeaf()`
   - Setzt `leafId = null`
   - Das nächste Anhängen erzeugt einen neuen Wurzeleintrag (`parentId = null`)

3. `branchWithSummary(branchFromId, summary, details?, fromExtension?)`
   - Akzeptiert `branchFromId: string | null`
   - Setzt `leafId = branchFromId`
   - Hängt einen `branch_summary`-Eintrag als Kind dieses Blatts an
   - Wenn `branchFromId` `null` ist, wird `fromId` als `"root"` persistiert

## `/tree`-Navigationsverhalten (gleiche Session-Datei)

`AgentSession.navigateTree()` ist Navigation, kein Datei-Forking.

Ablauf:

1. Ziel validieren und aufgegebenen Pfad berechnen (`collectEntriesForBranchSummary`)
2. `session_before_tree` mit `TreePreparation` emittieren
3. Optional aufgegebene Einträge zusammenfassen (Hook-bereitgestellte Zusammenfassung oder eingebauter Summarizer)
4. Neues Blattziel berechnen:
   - Auswahl einer **user**-Nachricht: Blatt bewegt sich zum Elternteil, und der Nachrichtentext wird für die Editor-Vorbefüllung zurückgegeben
   - Auswahl einer **custom_message**: gleiche Regel wie bei User-Nachricht (Blatt = Elternteil, Text befüllt Editor vor)
   - Auswahl eines anderen Eintrags: Blatt = ausgewählte Eintrags-ID
5. Blattbewegung anwenden:
   - mit Zusammenfassung: `branchWithSummary(newLeafId, ...)`
   - ohne Zusammenfassung und `newLeafId === null`: `resetLeaf()`
   - andernfalls: `branch(newLeafId)`
6. Agentenkontext vom neuen Blatt neu aufbauen und `session_tree` emittieren

Wichtig: Zusammenfassungseinträge werden an der **neuen Navigationsposition** angehängt, nicht am Ende des aufgegebenen Zweigs.

## `/branch`-Verhalten (neue Session-Datei)

`/branch` und `/tree` sind absichtlich unterschiedlich:

- `/tree` navigiert innerhalb der aktuellen Session-Datei.
- `/branch` erstellt eine neue Session-Branch-Datei (oder einen In-Memory-Ersatz für den nicht-persistenten Modus).

Benutzergerichteter `/branch`-Ablauf (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- Die Branch-Quelle muss eine **User-Nachricht** sein.
- Der ausgewählte Benutzertext wird für die Editor-Vorbefüllung extrahiert.
- Wenn die ausgewählte User-Nachricht die Wurzel ist (`parentId === null`): eine neue Session starten via `newSession({ parentSession: previousSessionFile })`.
- Andernfalls: `createBranchedSession(selectedEntry.parentId)` um die Historie bis zur ausgewählten Prompt-Grenze zu forken.

Spezifika von `SessionManager.createBranchedSession(leafId)`:

- Baut den Wurzel→Blatt-Pfad via `getBranch(leafId)` auf; wirft einen Fehler wenn fehlend.
- Schließt existierende `label`-Einträge vom kopierten Pfad aus.
- Baut frische Label-Einträge aus aufgelösten `labelsById` für Einträge neu auf, die im Pfad verbleiben.
- Persistenter Modus: schreibt eine neue JSONL-Datei und wechselt den Manager dorthin; gibt den neuen Dateipfad zurück.
- In-Memory-Modus: ersetzt die In-Memory-Einträge; gibt `undefined` zurück.

## Kontextrekonstruktion und Integration von Zusammenfassungen/Custom-Nachrichten

`buildSessionContext()` (in `session-manager.ts`) löst den aktiven Wurzel→Blatt-Pfad auf und baut den effektiven LLM-Kontextzustand auf:

- Verfolgt den letzten Thinking-/Model-/Mode-/TTSR-Zustand auf dem Pfad.
- Behandelt die letzte Kompaktierung auf dem Pfad:
  - gibt zuerst die Kompaktierungszusammenfassung aus
  - spielt behaltene Nachrichten von `firstKeptEntryId` bis zum Kompaktierungspunkt ab
  - spielt dann Post-Kompaktierungsnachrichten ab
- Enthält `branch_summary`- und `custom_message`-Einträge als `AgentMessage`-Objekte.

`session/messages.ts` bildet diese Nachrichtentypen dann für die Modelleingabe ab:

- `branchSummary` und `compactionSummary` werden zu User-Rollen-Template-Kontextnachrichten
- `custom`/`hookMessage` werden zu User-Rollen-Inhaltsnachrichten

Baumbewegung ändert den Kontext also durch Änderung des aktiven Blattpfads, nicht durch Mutation alter Einträge.

## Labels und Baum-UI-Verhalten

Label-Persistenz:

- `appendLabelChange(targetId, label?)` schreibt `label`-Einträge in der aktuellen Blattkette.
- `labelsById` wird sofort aktualisiert (setzen oder löschen).
- `getTree()` löst das aktuelle Label für jeden zurückgegebenen Knoten auf.

Baum-Selector-Verhalten (`tree-selector.ts`):

- Flacht den Baum für die Navigation ab, behält die Hervorhebung des aktiven Pfads bei und priorisiert die Anzeige des aktiven Zweigs zuerst.
- Unterstützt Filtermodi: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Unterstützt Freitext-Suche über gerenderten semantischen Inhalt.
- `Shift+L` öffnet die Inline-Label-Bearbeitung und schreibt via `appendLabelChange`.

Befehlsrouting:

- `/tree` öffnet immer den Baum-Selector.
- `/branch` öffnet den User-Nachrichten-Selector, es sei denn `doubleEscapeAction=tree`, in diesem Fall wird ebenfalls die Baum-Selector-UX verwendet.

## Extension- und Hook-Berührungspunkte für Baumoperationen

Befehlszeit-Extension-API (`ExtensionCommandContext`):

- `branch(entryId)` — gebranchigte Session-Datei erstellen
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
  - empfängt ein Abort-`signal` (Escape-Abbruchpfad)
- `session_tree`
  - emittiert `newLeafId`, `oldLeafId`
  - enthält `summaryEntry` wenn eine Zusammenfassung erstellt wurde
  - `fromExtension` gibt den Ursprung der Zusammenfassung an

Angrenzende aber verwandte Lifecycle-Hooks:

- `session_before_branch` / `session_branch` für den `/branch`-Ablauf
- `session_before_compact`, `session.compacting`, `session_compact` für Kompaktierungseinträge, die später die Baum-Kontextrekonstruktion beeinflussen

## Reale Einschränkungen und Randbedingungen

- `branch()` kann nicht auf `null` zielen; verwenden Sie `resetLeaf()` für den Wurzel-vor-erstem-Eintrag-Zustand.
- `branchWithSummary()` unterstützt `null` als Ziel und zeichnet `fromId: "root"` auf.
- Die Auswahl des aktuellen Blatts im Baum-Selector ist ein No-Op.
- Zusammenfassung erfordert ein aktives Modell; wenn keines vorhanden ist, schlägt die Zusammenfassungsnavigation sofort fehl.
- Wenn die Zusammenfassung abgebrochen wird, wird die Navigation abgebrochen und das Blatt bleibt unverändert.
- In-Memory-Sessions geben niemals einen Branch-Dateipfad von `createBranchedSession` zurück.

## Noch vorhandene Legacy-Kompatibilität

Session-Migrationen werden beim Laden weiterhin ausgeführt:

- v1→v2 fügt `id`/`parentId` hinzu und konvertiert den Kompaktierungsindex-Anker zu einem ID-Anker
- v2→v3 migriert die Legacy-`hookMessage`-Rolle zu `custom`

Das aktuelle Laufzeitverhalten entspricht Version-3-Baumsemantik nach der Migration.
