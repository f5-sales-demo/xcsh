---
title: Tree-Befehlsreferenz
description: >-
  /tree-Befehlsreferenz zur Visualisierung des Sitzungsverlaufs und der
  Gesprächsverzweigungen.
sidebar:
  order: 4
  label: /tree-Befehl
i18n:
  sourceHash: ee0e412fe993
  translator: machine
---

# `/tree`-Befehlsreferenz

`/tree` öffnet den interaktiven **Sitzungsbaum**-Navigator. Er ermöglicht es Ihnen, zu einem beliebigen Eintrag in der aktuellen Sitzungsdatei zu springen und von diesem Punkt aus fortzufahren.

Dies ist eine dateiinterne Blattverschiebung, kein neuer Sitzungsexport.

## Was `/tree` bewirkt

- Erstellt einen Baum aus den aktuellen Sitzungseinträgen (`SessionManager.getTree()`)
- Öffnet `TreeSelectorComponent` mit Tastaturnavigation, Filtern und Suche
- Bei Auswahl wird `AgentSession.navigateTree(targetId, { summarize, customInstructions })` aufgerufen
- Baut den sichtbaren Chat vom neuen Blattpfad aus neu auf
- Füllt optional den Editor-Text vor, wenn eine Benutzer-/benutzerdefinierte Nachricht ausgewählt wird

Primäre Implementierung:

- `src/modes/controllers/input-controller.ts` (`/tree`, Tastenkürzel-Verdrahtung, Doppel-Escape-Verhalten)
- `src/modes/controllers/selector-controller.ts` (Baum-UI-Start + Zusammenfassungs-Prompt-Ablauf)
- `src/modes/components/tree-selector.ts` (Navigation, Filter, Suche, Labels, Rendering)
- `src/session/agent-session.ts` (`navigateTree` Blattwechsel + optionale Zusammenfassung)
- `src/session/session-manager.ts` (`getTree`, `branch`, `branchWithSummary`, `resetLeaf`, Label-Persistenz)

## Wie man ihn öffnet

Jede der folgenden Methoden öffnet denselben Selektor:

- `/tree`
- Konfigurierte Tastenkürzel-Aktion `tree`
- Doppel-Escape bei leerem Editor, wenn `doubleEscapeAction = "tree"` (Standard)
- `/branch` wenn `doubleEscapeAction = "tree"` (leitet zum Baum-Selektor statt zum Nur-Benutzer-Verzweigungswähler weiter)

## Baum-UI-Modell

Der Baum wird aus den Eltern-Zeigern der Sitzungseinträge (`id` / `parentId`) gerendert.

- Kinder werden nach Zeitstempel aufsteigend sortiert (ältere zuerst, neuere weiter unten)
- Der aktive Zweig (Pfad von der Wurzel zum aktuellen Blatt) ist mit einem Aufzählungszeichen markiert
- Labels (falls vorhanden) werden als `[label]` vor dem Knotentext gerendert
- Falls mehrere Wurzeln existieren (verwaiste/unterbrochene Elternketten), werden sie unter einer virtuellen Verzweigungswurzel angezeigt

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

## Tastenkürzel innerhalb des Baum-Selektors

- `Up` / `Down`: Auswahl verschieben (umhüllend)
- `Left` / `Right`: Seite hoch / Seite runter
- `Enter`: Knoten auswählen
- `Esc`: Suche löschen, falls aktiv; andernfalls Selektor schließen
- `Ctrl+C`: Selektor schließen
- `Tippen`: An Suchanfrage anhängen
- `Backspace`: Suchzeichen löschen
- `Shift+L`: Label des ausgewählten Eintrags bearbeiten/löschen
- `Ctrl+O`: Filter vorwärts durchschalten
- `Shift+Ctrl+O`: Filter rückwärts durchschalten
- `Alt+D/T/U/L/A`: Direkt zu einem bestimmten Filtermodus springen

## Filter und Suchsemantik

Filtermodi (`TreeList`):

1. `default`
2. `no-tools`
3. `user-only`
4. `labeled-only`
5. `all`

### `default`

Zeigt die meisten Gesprächsknoten, blendet aber verwaltungstechnische Eintragstypen aus:

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

Alles im Sitzungsbaum, einschließlich Verwaltungs-/benutzerdefinierter Einträge.

### Verhalten bei reinen Tool-Assistenten-Knoten

Assistenten-Nachrichten, die **nur Tool-Aufrufe** enthalten (kein Text), werden standardmäßig in allen gefilterten Ansichten ausgeblendet, es sei denn:

- Die Nachricht ist fehlerhaft/abgebrochen (`stopReason` nicht `stop`/`toolUse`), oder
- es ist das aktuelle Blatt (wird immer sichtbar gehalten)

### Suchverhalten

- Die Anfrage wird durch Leerzeichen tokenisiert
- Der Abgleich ist nicht groß-/kleinschreibungssensitiv
- Alle Token müssen übereinstimmen (UND-Semantik)
- Durchsuchbarer Text umfasst Label, Rolle und typspezifischen Inhalt (Nachrichtentext, Verzweigungszusammenfassungstext, benutzerdefinierter Typ, Tool-Befehlsausschnitte usw.)

## Auswahlergebnisse (wichtig)

`navigateTree` berechnet das neue Blattverhalten anhand des ausgewählten Eintragstyps:

### Auswahl einer `user`-Nachricht

- Das neue Blatt wird die `parentId` des ausgewählten Eintrags
- Wenn der Elternknoten `null` ist (Wurzel-Benutzernachricht), wird das Blatt auf die Wurzel zurückgesetzt (`resetLeaf()`)
- Der ausgewählte Nachrichtentext wird zur Bearbeitung/erneuten Übermittlung in den Editor kopiert

### Auswahl einer `custom_message`

- Gleiche Blattregel wie bei Benutzernachrichten (`parentId`)
- Der Textinhalt wird extrahiert und in den Editor kopiert

### Auswahl eines Nicht-Benutzer-Knotens (Assistent/Tool/Zusammenfassung/Kompaktierung/benutzerdefinierte Verwaltung/usw.)

- Das neue Blatt wird die ID des ausgewählten Knotens
- Der Editor wird nicht vorausgefüllt

### Auswahl des aktuellen Blatts

- Keine Aktion; der Selektor schließt sich mit "Bereits an diesem Punkt"

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

## Zusammenfassung-bei-Wechsel-Ablauf

Der Zusammenfassungs-Prompt wird durch `branchSummary.enabled` gesteuert (Standard: `false`).

Wenn aktiviert, fragt die UI nach der Knotenauswahl:

- `Keine Zusammenfassung`
- `Zusammenfassen`
- `Mit benutzerdefiniertem Prompt zusammenfassen`

Ablaufdetails:

- Escape im Zusammenfassungs-Prompt öffnet den Baum-Selektor erneut
- Abbruch des benutzerdefinierten Prompts kehrt zur Zusammenfassungsauswahl-Schleife zurück
- Während der Zusammenfassung zeigt die UI einen Ladeindikator und bindet `Esc` an `abortBranchSummary()`
- Wenn die Zusammenfassung abgebrochen wird, öffnet sich der Baum-Selektor erneut und es wird keine Verschiebung angewendet

`navigateTree`-Interna:

- Sammelt verlassene Zweigeinträge vom alten Blatt bis zum gemeinsamen Vorfahren
- Löst `session_before_tree` aus (Erweiterungen können abbrechen oder Zusammenfassung einfügen)
- Verwendet den Standard-Zusammenfasser nur wenn angefordert und benötigt
- Wendet die Verschiebung an mit:
  - `branchWithSummary(...)` wenn eine Zusammenfassung existiert
  - `branch(newLeafId)` für Nicht-Wurzel-Verschiebung ohne Zusammenfassung
  - `resetLeaf()` für Wurzel-Verschiebung ohne Zusammenfassung
- Ersetzt die Agentenkonversation durch den neu aufgebauten Sitzungskontext
- Löst `session_tree` aus

Hinweis: Wenn der Benutzer eine Zusammenfassung anfordert, aber nichts zusammenzufassen ist, wird die Navigation fortgesetzt, ohne einen Zusammenfassungseintrag zu erstellen.

## Labels

Label-Bearbeitungen in der Baum-UI rufen `appendLabelChange(targetId, label)` auf.

- Nicht-leeres Label setzt/aktualisiert das aufgelöste Label
- Leeres Label löscht es
- Labels werden als Nur-Anhängen-`label`-Einträge gespeichert
- Baumknoten zeigen den aufgelösten Label-Zustand an, nicht den rohen Label-Eintragsverlauf

## `/tree` im Vergleich zu benachbarten Operationen

| Operation | Geltungsbereich | Ergebnis |
|---|---|---|
| `/tree` | Aktuelle Sitzungsdatei | Verschiebt das Blatt zum ausgewählten Punkt (gleiche Datei) |
| `/branch` | Normalerweise aktuelle Sitzungsdatei -> neue Sitzungsdatei | Verzweigt standardmäßig von der ausgewählten **Benutzer**-Nachricht in eine neue Sitzungsdatei; wenn `doubleEscapeAction = "tree"`, öffnet `/branch` stattdessen die Baumnavigations-UI |
| `/fork` | Gesamte aktuelle Sitzung | Dupliziert die Sitzung in eine neue persistierte Sitzungsdatei |
| `/resume` | Sitzungsliste | Wechselt zu einer anderen Sitzungsdatei |

Wichtige Unterscheidung: `/tree` ist ein Navigations-/Repositionierungswerkzeug innerhalb einer Sitzungsdatei. `/branch`, `/fork` und `/resume` ändern alle den Sitzungsdatei-Kontext.

## Operator-Workflows

### Von einem früheren Benutzer-Prompt erneut ausführen, ohne den aktuellen Zweig zu verlieren

1. `/tree`
2. Frühere Benutzernachricht suchen/auswählen
3. `Keine Zusammenfassung` wählen (oder zusammenfassen, falls benötigt)
4. Vorausgefüllten Text im Editor bearbeiten
5. Absenden

Effekt: Ein neuer Zweig wächst vom ausgewählten Punkt innerhalb derselben Sitzungsdatei.

### Aktuellen Zweig mit Kontextbrodkrümel verlassen

1. `branchSummary.enabled` aktivieren
2. `/tree` und Zielknoten auswählen
3. `Zusammenfassen` wählen (oder benutzerdefinierten Prompt)

Effekt: Ein `branch_summary`-Eintrag wird an der Zielposition angehängt, bevor fortgefahren wird.

### Versteckte Verwaltungseinträge untersuchen

1. `/tree`
2. `Alt+A` drücken (alle)
3. Nach `model`, `thinking`, `custom` oder Labels suchen

Effekt: Vollständige interne Zeitleiste inspizieren, nicht nur Gesprächsknoten.

### Ankerpunkte für spätere Sprünge markieren

1. `/tree`
2. Zu einem Eintrag navigieren
3. `Shift+L` und Label setzen
4. Später `Alt+L` (`labeled-only`) für schnelle Sprünge verwenden

Effekt: Schnelle Navigation zwischen dauerhaften Verzweigungslandmarken.
