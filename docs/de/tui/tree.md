---
title: Tree-Befehlsreferenz
description: >-
  /tree Befehlsreferenz zur Visualisierung des Sitzungsverlaufs und der
  Konversationsverzweigungen.
sidebar:
  order: 4
  label: /tree-Befehl
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree`-Befehlsreferenz

`/tree` öffnet den interaktiven **Sitzungsbaum**-Navigator. Er ermöglicht es Ihnen, zu jedem Eintrag in der aktuellen Sitzungsdatei zu springen und von diesem Punkt aus fortzufahren.

Dies ist eine dateiinterne Blattverschiebung, kein neuer Sitzungsexport.

## Was `/tree` bewirkt

- Erstellt einen Baum aus den aktuellen Sitzungseinträgen (`SessionManager.getTree()`)
- Öffnet `TreeSelectorComponent` mit Tastaturnavigation, Filtern und Suche
- Bei Auswahl wird `AgentSession.navigateTree(targetId, { summarize, customInstructions })` aufgerufen
- Baut den sichtbaren Chat vom neuen Blattpfad neu auf
- Füllt optional den Editor-Text vor, wenn eine Benutzer-/benutzerdefinierte Nachricht ausgewählt wird

Primäre Implementierung:

- `src/modes/controllers/input-controller.ts` (`/tree`, Tastenkombinations-Verdrahtung, Doppel-Escape-Verhalten)
- `src/modes/controllers/selector-controller.ts` (Baum-UI-Start + Zusammenfassungs-Prompt-Ablauf)
- `src/modes/components/tree-selector.ts` (Navigation, Filter, Suche, Labels, Rendering)
- `src/session/agent-session.ts` (`navigateTree` Blattwechsel + optionale Zusammenfassung)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, Label-Persistenz)

## Wie man ihn öffnet

Jede der folgenden Aktionen öffnet denselben Selektor:

- `/tree`
- konfigurierte Tastenkombinations-Aktion `tree`
- Doppel-Escape bei leerem Editor, wenn `doubleEscapeAction = "tree"` (Standard)
- `/branch` wenn `doubleEscapeAction = "tree"` (leitet zum Baum-Selektor statt zum reinen Benutzer-Verzweigungswähler weiter)

## Baum-UI-Modell

Der Baum wird aus den Elternzeigern der Sitzungseinträge (`id` / `parentId`) gerendert.

- Kinder werden nach Zeitstempel aufsteigend sortiert (ältere zuerst, neuere weiter unten)
- Der aktive Zweig (Pfad von der Wurzel zum aktuellen Blatt) wird mit einem Aufzählungszeichen markiert
- Labels (falls vorhanden) werden als `[label]` vor dem Knotentext dargestellt
- Wenn mehrere Wurzeln existieren (verwaiste/unterbrochene Elternketten), werden sie unter einer virtuellen Verzweigungswurzel angezeigt

```text
Example tree view (active path marked with •):

├─ user: "Start task"
│  └─ assistant: "Plan"
│     ├─ • user: "Try approach A"
│     │  └─ • assistant: "A result"
│     │     └─ • [milestone] user: "Continue A"
│     └─ user: "Try approach B"
│        └─ assistant: "B result"
```

Der Selektor zentriert sich um die aktuelle Auswahl und zeigt bis zu:

- `max(5, floor(terminalHeight / 2))` Zeilen

## Tastenkombinationen innerhalb des Baum-Selektors

- `Hoch` / `Runter`: Auswahl verschieben (springt um)
- `Links` / `Rechts`: Seite hoch / Seite runter
- `Enter`: Knoten auswählen
- `Esc`: Suche löschen, falls aktiv; andernfalls Selektor schließen
- `Strg+C`: Selektor schließen
- `Tippen`: An Suchabfrage anhängen
- `Rücktaste`: Suchzeichen löschen
- `Umschalt+L`: Label des ausgewählten Eintrags bearbeiten/löschen
- `Strg+O`: Filter vorwärts durchschalten
- `Umschalt+Strg+O`: Filter rückwärts durchschalten
- `Alt+D/T/U/L/A`: Direkt zu einem bestimmten Filtermodus springen

## Filter und Suchsemantik

Filtermodi (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Zeigt die meisten Konversationsknoten, blendet aber verwaltungstechnische Eintragstypen aus:

- `label`
- `custom`
- `model_change`
- `thinking_level_change`

### `no-tools`

Wie `default`, blendet zusätzlich `toolResult`-Nachrichten aus.

### `user-only`

Nur `message`-Einträge, bei denen die Rolle `user` ist.

### `labeled-only`

Nur Einträge, die aktuell zu einem Label aufgelöst werden.

### `all`

Alles im Sitzungsbaum, einschließlich verwaltungstechnischer/benutzerdefinierter Einträge.

### Verhalten bei reinen Tool-Assistentenknoten

Assistentennachrichten, die **nur Tool-Aufrufe** enthalten (kein Text), werden standardmäßig in allen gefilterten Ansichten ausgeblendet, es sei denn:

- Die Nachricht ist fehlerhaft/abgebrochen (`stopReason` ist nicht `stop`/`toolUse`), oder
- es ist das aktuelle Blatt (wird immer sichtbar gehalten)

### Suchverhalten

- Die Abfrage wird durch Leerzeichen tokenisiert
- Die Übereinstimmung ist nicht groß-/kleinschreibungssensitiv
- Alle Token müssen übereinstimmen (UND-Semantik)
- Durchsuchbarer Text umfasst Label, Rolle und typspezifischen Inhalt (Nachrichtentext, Verzweigungszusammenfassungstext, benutzerdefinierter Typ, Tool-Befehlsausschnitte usw.)

## Auswahlergebnisse (wichtig)

`navigateTree` berechnet das neue Blattverhalten basierend auf dem ausgewählten Eintragstyp:

### Auswahl einer `user`-Nachricht

- Das neue Blatt wird zur `parentId` des ausgewählten Eintrags
- Wenn der Elternteil `null` ist (Wurzel-Benutzernachricht), wird das Blatt auf die Wurzel zurückgesetzt (`resetLeaf()`)
- Der ausgewählte Nachrichtentext wird zum Bearbeiten/erneuten Absenden in den Editor kopiert

### Auswahl einer `custom_message`

- Gleiche Blattregel wie bei Benutzernachrichten (`parentId`)
- Textinhalt wird extrahiert und in den Editor kopiert

### Auswahl eines Nicht-Benutzer-Knotens (Assistent/Tool/Zusammenfassung/Kompaktierung/benutzerdefinierte Verwaltung/usw.)

- Das neue Blatt wird zur ID des ausgewählten Knotens
- Der Editor wird nicht vorausgefüllt

### Auswahl des aktuellen Blatts

- Keine Aktion; Selektor schließt sich mit "Bereits an diesem Punkt"

```text
Selection decision (simplified):

selected node
   │
   ├─ is current leaf? ── yes ──> close selector (no-op)
   │
   ├─ is user/custom_message? ── yes ──> leaf := parentId (or resetLeaf for root)
   │                                     + prefill editor text
   │
   └─ otherwise ──> leaf := selected node id
                    + no editor prefill
```

## Zusammenfassung-beim-Wechsel-Ablauf

Der Zusammenfassungs-Prompt wird durch `branchSummary.enabled` gesteuert (Standard: `false`).

Wenn aktiviert, fragt die Benutzeroberfläche nach der Knotenauswahl:

- `Keine Zusammenfassung`
- `Zusammenfassen`
- `Mit benutzerdefiniertem Prompt zusammenfassen`

Ablaufdetails:

- Escape im Zusammenfassungs-Prompt öffnet den Baum-Selektor erneut
- Abbruch des benutzerdefinierten Prompts kehrt zur Zusammenfassungsauswahl-Schleife zurück
- Während der Zusammenfassung zeigt die Benutzeroberfläche einen Ladeindikator und bindet `Esc` an `abortBranchSummary()`
- Wenn die Zusammenfassung abgebrochen wird, wird der Baum-Selektor erneut geöffnet und keine Verschiebung angewendet

`navigateTree`-Interna:

- Sammelt aufgegebene Zweigeinträge vom alten Blatt bis zum gemeinsamen Vorfahren
- Emittiert `session_before_tree` (Erweiterungen können abbrechen oder eine Zusammenfassung einfügen)
- Verwendet den Standard-Zusammenfasser nur wenn angefordert und benötigt
- Wendet die Verschiebung an mit:
  - `branchWithSummary(...)` wenn eine Zusammenfassung existiert
  - `branch(newLeafId)` für Nicht-Wurzel-Verschiebung ohne Zusammenfassung
  - `resetLeaf()` für Wurzel-Verschiebung ohne Zusammenfassung
- Ersetzt die Agentenkonversation durch den neu aufgebauten Sitzungskontext
- Emittiert `session_tree`

Hinweis: Wenn der Benutzer eine Zusammenfassung anfordert, aber nichts zusammenzufassen ist, wird die Navigation ohne Erstellung eines Zusammenfassungseintrags fortgesetzt.

## Labels

Label-Bearbeitungen in der Baum-Benutzeroberfläche rufen `appendLabelChange(targetId, label)` auf.

- Ein nicht-leeres Label setzt/aktualisiert das aufgelöste Label
- Ein leeres Label löscht es
- Labels werden als append-only `label`-Einträge gespeichert
- Baumknoten zeigen den aufgelösten Label-Zustand an, nicht die rohe Label-Eintragshistorie

## `/tree` im Vergleich zu verwandten Operationen

| Operation | Geltungsbereich | Ergebnis |
|---|---|---|
| `/tree` | Aktuelle Sitzungsdatei | Verschiebt das Blatt zum ausgewählten Punkt (gleiche Datei) |
| `/branch` | Normalerweise aktuelle Sitzungsdatei -> neue Sitzungsdatei | Verzweigt standardmäßig von der ausgewählten **Benutzer**-Nachricht in eine neue Sitzungsdatei; wenn `doubleEscapeAction = "tree"`, öffnet `/branch` stattdessen die Baumnavigations-Benutzeroberfläche |
| `/fork` | Gesamte aktuelle Sitzung | Dupliziert die Sitzung in eine neue persistierte Sitzungsdatei |
| `/resume` | Sitzungsliste | Wechselt zu einer anderen Sitzungsdatei |

Wichtige Unterscheidung: `/tree` ist ein Navigations-/Repositionierungswerkzeug innerhalb einer Sitzungsdatei. `/branch`, `/fork` und `/resume` ändern alle den Sitzungsdatei-Kontext.

## Operator-Workflows

### Von einem früheren Benutzer-Prompt erneut ausführen, ohne den aktuellen Zweig zu verlieren

1. `/tree`
2. Frühere Benutzernachricht suchen/auswählen
3. `Keine Zusammenfassung` wählen (oder bei Bedarf zusammenfassen)
4. Vorausgefüllten Text im Editor bearbeiten
5. Absenden

Effekt: Ein neuer Zweig wächst vom ausgewählten Punkt innerhalb derselben Sitzungsdatei.

### Aktuellen Zweig mit Kontext-Brotkrümel verlassen

1. `branchSummary.enabled` aktivieren
2. `/tree` und Zielknoten auswählen
3. `Zusammenfassen` wählen (oder benutzerdefinierter Prompt)

Effekt: Ein `branch_summary`-Eintrag wird an der Zielposition angehängt, bevor fortgefahren wird.

### Versteckte verwaltungstechnische Einträge untersuchen

1. `/tree`
2. `Alt+A` drücken (alle)
3. Nach `model`, `thinking`, `custom` oder Labels suchen

Effekt: Vollständige interne Zeitleiste inspizieren, nicht nur Konversationsknoten.

### Pivotpunkte für spätere Sprünge markieren

1. `/tree`
2. Zum Eintrag navigieren
3. `Umschalt+L` und Label setzen
4. Später `Alt+L` (`labeled-only`) für schnelle Navigation verwenden

Effekt: Schnelle Navigation zwischen dauerhaften Zweig-Orientierungspunkten.
