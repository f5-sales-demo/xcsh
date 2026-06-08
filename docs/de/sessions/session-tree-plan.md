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

Die Session wird als Append-Only-Eintragsprotokoll gespeichert, aber das Laufzeitverhalten ist baumbasiert:

- Jeder Nicht-Header-Eintrag hat `id` und `parentId`.
- Die aktive Position ist `leafId` im `SessionManager`.
- Das Anhängen eines Eintrags erstellt immer ein Kind des aktuellen Blatts.
- Verzweigung schreibt die Historie **nicht** um; sie ändert nur, wohin das Blatt vor dem nächsten Anhängen zeigt.

Schlüsseldateien:

- `src/session/session-manager.ts` — Baumdatenmodell, Traversierung, Blattbewegung, Branch-/Session-Extraktion
- `src/session/agent-session.ts` — `/tree`-Navigationsablauf, Zusammenfassung, Hook-/Event-Emission
- `src/modes/components/tree-selector.ts` — interaktives Baum-UI-Verhalten und Filterung
- `src/modes/controllers/selector-controller.ts` — Selektor-Orchestrierung für `/tree` und `/branch`
- `src/modes/controllers/input-controller.ts` — Befehlsweiterleitung (`/tree`, `/branch`, Doppel-Escape-Verhalten)
- `src/session/messages.ts` — Konvertierung von `branch_summary`-, `compaction`- und `custom_message`-Einträgen in LLM-Kontextnachrichten

## Baumdatenmodell im `SessionManager`

Laufzeitindizes:

- `#byId: Map<string, SessionEntry>` — schneller Lookup für jeden Eintrag
- `#leafId: string | null` — aktuelle Position im Baum
- `#labelsById: Map<string, string>` — aufgelöste Labels nach Ziel-Eintrags-ID

Baum-APIs:

- `getBranch(fromId?)` traversiert Eltern-Links zur Wurzel und gibt den Wurzel→Knoten-Pfad zurück
- `getTree()` gibt `SessionTreeNode[]` zurück (`entry`, `children`, `label`)
  - Eltern-Links werden zu Kind-Arrays
  - Einträge mit fehlenden Eltern werden als Wurzeln behandelt
  - Kinder werden vom ältesten zum neuesten nach Zeitstempel sortiert
- `getChildren(parentId)` gibt direkte Kinder zurück
- `getLabel(id)` löst das aktuelle Label aus `labelsById` auf

`getTree()` ist eine Laufzeitprojektion; die Persistenz bleibt als Append-Only-JSONL-Einträge bestehen.

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
   - Hängt einen `branch_summary`-Eintrag als Kind dieses Blatts an
   - Wenn `branchFromId` `null` ist, wird `fromId` als `"root"` persistiert

## `/tree`-Navigationsverhalten (gleiche Session-Datei)

`AgentSession.navigateTree()` ist Navigation, keine Datei-Abspaltung.

Ablauf:

1. Ziel validieren und verlassenen Pfad berechnen (`collectEntriesForBranchSummary`)
2. `session_before_tree` mit `TreePreparation` emittieren
3. Optional verlassene Einträge zusammenfassen (Hook-bereitgestellte Zusammenfassung oder eingebauter Zusammenfasser)
4. Neues Blattziel berechnen:
   - Auswahl einer **user**-Nachricht: Blatt bewegt sich zum Elternknoten, und der Nachrichtentext wird für die Editor-Vorbefüllung zurückgegeben
   - Auswahl einer **custom_message**: gleiche Regel wie bei User-Nachrichten (Blatt = Eltern, Text befüllt Editor vor)
   - Auswahl eines anderen Eintrags: Blatt = ausgewählte Eintrags-ID
5. Blattbewegung anwenden:
   - mit Zusammenfassung: `branchWithSummary(newLeafId, ...)`
   - ohne Zusammenfassung und `newLeafId === null`: `resetLeaf()`
   - andernfalls: `branch(newLeafId)`
6. Agentenkontext aus neuem Blatt neu aufbauen und `session_tree` emittieren

Wichtig: Zusammenfassungseinträge werden an der **neuen Navigationsposition** angehängt, nicht am Ende des verlassenen Zweigs.

## `/branch`-Verhalten (neue Session-Datei)

`/branch` und `/tree` sind absichtlich unterschiedlich:

- `/tree` navigiert innerhalb der aktuellen Session-Datei.
- `/branch` erstellt eine neue Session-Branch-Datei (oder einen In-Memory-Ersatz für den nicht-persistenten Modus).

Benutzerorientierter `/branch`-Ablauf (`SelectorController.showUserMessageSelector` → `AgentSession.branch`):

- Die Branch-Quelle muss eine **User-Nachricht** sein.
- Der ausgewählte User-Text wird für die Editor-Vorbefüllung extrahiert.
- Wenn die ausgewählte User-Nachricht eine Wurzel ist (`parentId === null`): eine neue Session starten via `newSession({ parentSession: previousSessionFile })`.
- Andernfalls: `createBranchedSession(selectedEntry.parentId)`, um die Historie bis zur ausgewählten Prompt-Grenze abzuspalten.

`SessionManager.createBranchedSession(leafId)` im Detail:

- Baut den Wurzel→Blatt-Pfad via `getBranch(leafId)` auf; wirft einen Fehler, wenn nicht vorhanden.
- Schließt bestehende `label`-Einträge aus dem kopierten Pfad aus.
- Baut frische Label-Einträge aus den aufgelösten `labelsById` für Einträge, die im Pfad verbleiben, neu auf.
- Persistenter Modus: schreibt eine neue JSONL-Datei und wechselt den Manager dorthin; gibt den neuen Dateipfad zurück.
- In-Memory-Modus: ersetzt die In-Memory-Einträge; gibt `undefined` zurück.

## Kontextrekonstruktion und Zusammenfassungs-/Custom-Integration

`buildSessionContext()` (in `session-manager.ts`) löst den aktiven Wurzel→Blatt-Pfad auf und baut den effektiven LLM-Kontextzustand auf:

- Verfolgt den letzten Thinking-/Modell-/Modus-/TTSR-Zustand auf dem Pfad.
- Behandelt die letzte Kompaktierung auf dem Pfad:
  - gibt zuerst die Kompaktierungszusammenfassung aus
  - spielt behaltene Nachrichten von `firstKeptEntryId` bis zum Kompaktierungspunkt ab
  - spielt dann Post-Kompaktierungs-Nachrichten ab
- Enthält `branch_summary`- und `custom_message`-Einträge als `AgentMessage`-Objekte.

`session/messages.ts` bildet dann diese Nachrichtentypen für die Modelleingabe ab:

- `branchSummary` und `compactionSummary` werden zu User-Rollen-Template-Kontextnachrichten
- `custom`/`hookMessage` werden zu User-Rollen-Inhaltsnachrichten

Baumbewegung ändert also den Kontext durch Änderung des aktiven Blattpfads, nicht durch Mutation alter Einträge.

## Labels und Baum-UI-Verhalten

Label-Persistenz:

- `appendLabelChange(targetId, label?)` schreibt `label`-Einträge in die aktuelle Blattkette.
- `labelsById` wird sofort aktualisiert (setzen oder löschen).
- `getTree()` löst das aktuelle Label auf jeden zurückgegebenen Knoten auf.

Baumselektor-Verhalten (`tree-selector.ts`):

- Flacht den Baum für die Navigation ab, behält die Hervorhebung des aktiven Pfads bei und priorisiert die Anzeige des aktiven Zweigs.
- Unterstützt Filtermodi: `default`, `no-tools`, `user-only`, `labeled-only`, `all`.
- Unterstützt Freitext-Suche über gerenderten semantischen Inhalt.
- `Shift+L` öffnet die Inline-Label-Bearbeitung und schreibt via `appendLabelChange`.

Befehlsweiterleitung:

- `/tree` öffnet immer den Baumselektor.
- `/branch` öffnet den User-Nachrichten-Selektor, es sei denn `doubleEscapeAction=tree`, in diesem Fall wird ebenfalls die Baumselektor-UX verwendet.

## Extension- und Hook-Berührungspunkte für Baumoperationen

Befehlszeit-Extension-API (`ExtensionCommandContext`):

- `branch(entryId)` — gebrancht Session-Datei erstellen
- `navigateTree(targetId, { summarize? })` — innerhalb des aktuellen Baums/der Datei navigieren

Events rund um die Baumnavigation:

- `session_before_tree`
  - empfängt `TreePreparation`:
    - `targetId`
    - `oldLeafId`
    - `commonAncestorId`
    - `entriesToSummarize`
    - `userWantsSummary`
  - kann die Navigation abbrechen
  - kann Zusammenfassungs-Payload bereitstellen, das anstelle des eingebauten Zusammenfassers verwendet wird
  - empfängt Abbruch-`signal` (Escape-Abbruchpfad)
- `session_tree`
  - emittiert `newLeafId`, `oldLeafId`
  - enthält `summaryEntry`, wenn eine Zusammenfassung erstellt wurde
  - `fromExtension` gibt die Herkunft der Zusammenfassung an

Angrenzende, aber verwandte Lebenszyklus-Hooks:

- `session_before_branch` / `session_branch` für den `/branch`-Ablauf
- `session_before_compact`, `session.compacting`, `session_compact` für Kompaktierungseinträge, die später die Baum-Kontextrekonstruktion beeinflussen

## Reale Einschränkungen und Randbedingungen

- `branch()` kann nicht auf `null` zielen; verwenden Sie `resetLeaf()` für den Wurzel-vor-erstem-Eintrag-Zustand.
- `branchWithSummary()` unterstützt `null` als Ziel und zeichnet `fromId: "root"` auf.
- Die Auswahl des aktuellen Blatts im Baumselektor ist ein No-Op.
- Zusammenfassung erfordert ein aktives Modell; wenn keines vorhanden ist, schlägt die Zusammenfassungsnavigation sofort fehl.
- Wenn die Zusammenfassung abgebrochen wird, wird die Navigation abgebrochen und das Blatt bleibt unverändert.
- In-Memory-Sessions geben niemals einen Branch-Dateipfad von `createBranchedSession` zurück.

## Noch vorhandene Legacy-Kompatibilität

Session-Migrationen werden beim Laden weiterhin ausgeführt:

- v1→v2 fügt `id`/`parentId` hinzu und konvertiert den Kompaktierungsindex-Anker in einen ID-Anker
- v2→v3 migriert die Legacy-`hookMessage`-Rolle zu `custom`

Das aktuelle Laufzeitverhalten entspricht nach der Migration der Version-3-Baumsemantik.
