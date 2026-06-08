---
title: Handoff-Generierungs-Pipeline
description: >-
  Handoff-Generierungs-Pipeline zur Erstellung portabler
  Sitzungszusammenfassungen für die Teamzusammenarbeit.
sidebar:
  order: 8
  label: Handoff-Pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff`-Generierungs-Pipeline

Dieses Dokument beschreibt, wie der Coding-Agent `/handoff` derzeit implementiert: Auslösepfad, Generierungs-Prompt, Erfassung der Fertigstellung, Sitzungswechsel und Kontextwiedereinspeisung.

## Geltungsbereich

Abgedeckt:

- Interaktive `/handoff`-Befehlsweiterleitung
- `AgentSession.handoff()`-Lebenszyklus und Zustandsübergänge
- Wie die Handoff-Ausgabe aus der Assistenten-Ausgabe erfasst wird
- Wie alte/neue Sitzungen Handoff-Daten unterschiedlich persistieren
- UI-Verhalten bei Erfolg, Abbruch und Fehler

Nicht abgedeckt:

- Generische Baumnavigation/Branch-Interna
- Nicht-Handoff-Sitzungsbefehle (`/new`, `/fork`, `/resume`)

## Implementierungsdateien

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Auslösepfad

1. `/handoff` wird in den integrierten Slash-Command-Metadaten (`slash-commands.ts`) mit optionalem Inline-Hinweis deklariert: `[focus instructions]`.
2. Bei der interaktiven Eingabeverarbeitung (`InputController`) wird eingegebener Text, der `/handoff` oder `/handoff ...` entspricht, vor der normalen Prompt-Übermittlung abgefangen.
3. Der Editor wird geleert und `handleHandoffCommand(customInstructions?)` wird aufgerufen.
4. `CommandController.handleHandoffCommand` führt eine Vorabprüfung anhand der aktuellen Einträge durch:
   - Zählt Einträge vom `type === "message"`.
   - Wenn `< 2`, wird gewarnt: `Nothing to hand off (no messages yet)` und die Funktion kehrt zurück.

Dieselbe Mindestinhalt-Prüfung existiert erneut innerhalb von `AgentSession.handoff()` und wirft einen Fehler, wenn sie verletzt wird. Dies dupliziert die Sicherheit sowohl auf der UI- als auch auf der Sitzungsebene.

## End-to-End-Lebenszyklus

### 1) Handoff-Generierung starten

`AgentSession.handoff(customInstructions?)`:

- Liest die aktuellen Branch-Einträge (`sessionManager.getBranch()`)
- Validiert die Mindestanzahl an Nachrichten (`>= 2`)
- Erstellt `#handoffAbortController`
- Baut einen festen, Inline-Prompt auf, der ein strukturiertes Handoff-Dokument anfordert (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Fügt `Additional focus: ...` hinzu, wenn benutzerdefinierte Anweisungen bereitgestellt werden

Der Prompt wird gesendet über:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` verhindert die Slash-/Prompt-Template-Expansion dieser internen Anweisungsnutzlast.

### 2) Fertigstellung erfassen

Vor dem Senden des Prompts abonniert `handoff()` Sitzungsereignisse und wartet auf `agent_end`.

Bei `agent_end` extrahiert es den Handoff-Text aus dem Agentenzustand, indem es rückwärts nach der neuesten `assistant`-Nachricht sucht und dann alle `content`-Blöcke mit `type === "text"` mit `\n` verkettet.

Wichtige Extraktionsannahmen:

- Nur Textblöcke werden verwendet; Nicht-Text-Inhalte werden ignoriert.
- Es wird angenommen, dass die neueste Assistenten-Nachricht der Handoff-Generierung entspricht.
- Es werden keine Markdown-Abschnitte geparst oder Formatkonformität validiert.
- Wenn die Assistenten-Ausgabe keine Textblöcke enthält, wird der Handoff als fehlend behandelt.

### 3) Abbruchprüfungen

`handoff()` gibt `undefined` zurück, wenn eine der folgenden Bedingungen zutrifft:

- kein erfasster Handoff-Text, oder
- `#handoffAbortController.signal.aborted` ist true

Es löscht `#handoffAbortController` immer im `finally`-Block.

### 4) Neue Sitzung erstellen

Wenn Text erfasst und nicht abgebrochen wurde:

1. Aktuelle Sitzung flushen (`sessionManager.flush()`)
2. Eine brandneue Sitzung starten (`sessionManager.newSession()`)
3. In-Memory-Agentenzustand zurücksetzen (`agent.reset()`)
4. `agent.sessionId` an neue Sitzungs-ID binden
5. Warteschlangen-Kontext-Arrays leeren (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Todo-Erinnerungszähler zurücksetzen

`newSession()` erstellt einen neuen Header und eine leere Eintragsliste (Leaf wird auf `null` zurückgesetzt). Im Handoff-Pfad wird keine `parentSession` übergeben.

### 5) Handoff-Kontext-Einspeisung

Das generierte Handoff-Dokument wird umschlossen und der neuen Sitzung als `custom_message`-Eintrag hinzugefügt:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Einfügeaufruf:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semantik:

- `customType`: `"handoff"`
- `display`: `true` (sichtbar beim TUI-Neuaufbau)
- Eintragstyp: `custom_message` (nimmt am LLM-Kontext teil)

### 6) Aktiven Agentenkontext neu aufbauen

Nach der Einspeisung:

1. `sessionManager.buildSessionContext()` löst die Nachrichtenliste für das aktuelle Leaf auf
2. `agent.replaceMessages(sessionContext.messages)` macht die eingespeiste Handoff-Nachricht zum aktiven Kontext
3. Die Methode gibt `{ document: handoffText }` zurück

An diesem Punkt enthält der aktive LLM-Kontext in der neuen Sitzung die eingespeiste Handoff-Nachricht, nicht das alte Transkript.

## Persistenzmodell: alte Sitzung vs. neue Sitzung

### Alte Sitzung

Während der Generierung bleibt die normale Nachrichtenpersistenz aktiv. Die Assistenten-Handoff-Antwort wird als regulärer `message`-Eintrag bei `message_end` persistiert.

Ergebnis: Die ursprüngliche Sitzung enthält den sichtbaren generierten Handoff als Teil des historischen Transkripts.

### Neue Sitzung

Nach dem Sitzungsreset wird der Handoff als `custom_message` mit `customType: "handoff"` persistiert.

`buildSessionContext()` konvertiert diesen Eintrag in eine Laufzeit-Custom/User-Kontext-Nachricht via `createCustomMessage(...)`, sodass er in zukünftigen Prompts der neuen Sitzung enthalten ist.

## Controller/UI-Verhalten

`CommandController.handleHandoffCommand`-Verhalten:

- Ruft `await session.handoff(customInstructions)` auf
- Wenn das Ergebnis `undefined` ist: `showError("Handoff cancelled")`
- Bei Erfolg:
  - `rebuildChatFromMessages()` (lädt neuen Sitzungskontext, einschließlich eingespeistem Handoff)
  - Invalidiert Statuszeile und oberen Editor-Rand
  - Lädt Todos neu
  - Hängt Erfolgs-Chatzeile an: `New session started with handoff context`
- Bei Ausnahme:
  - Wenn die Nachricht `"Handoff cancelled"` lautet oder der Fehlername `AbortError` ist: `showError("Handoff cancelled")`
  - Andernfalls: `showError("Handoff failed: <message>")`
- Fordert am Ende ein Rendern an

## Abbruch-Semantik (aktuelles Verhalten)

### Abbruchprimitiv auf Sitzungsebene

`AgentSession` stellt bereit:

- `abortHandoff()` → bricht `#handoffAbortController` ab
- `isGeneratingHandoff` → true, solange der Controller existiert

Wenn dieser Abbruchpfad verwendet wird, lehnt der Handoff-Subscriber mit `Error("Handoff cancelled")` ab, und der Command-Controller bildet dies auf die Abbruch-UI ab.

### Einschränkung des interaktiven `/handoff`-Pfads

In der aktuellen interaktiven Controller-Verdrahtung installiert `/handoff` keinen dedizierten Escape-Handler, der `abortHandoff()` aufruft (im Gegensatz zu Kompaktierungs-/Branch-Summary-Pfaden, die `editor.onEscape` temporär überschreiben).

Praktische Auswirkung:

- Es gibt Abbruchunterstützung auf Sitzungsebene, aber keinen handoff-spezifischen Keybinding-Hook im `/handoff`-Befehlspfad.
- Benutzerunterbrechung kann weiterhin über breitere Agent-Abbruchpfade erfolgen, aber das ist nicht derselbe explizite Abbruchkanal, der von `abortHandoff()` verwendet wird.

## Abgebrochen vs. fehlgeschlagener Handoff

Aktuelle UI-Klassifikation:

- **Abgebrochen/Storniert**
  - `abortHandoff()`-Pfad löst `"Handoff cancelled"` aus, oder
  - geworfener `AbortError`
  - UI zeigt `Handoff cancelled`

- **Fehlgeschlagen**
  - jeder andere geworfene Fehler von `handoff()` / Prompt-Pipeline (Modell-/API-Validierungsfehler, Laufzeitausnahmen usw.)
  - UI zeigt `Handoff failed: ...`

Zusätzliche Nuance: Wenn die Generierung abgeschlossen wird, aber kein Text extrahiert wird, gibt `handoff()` `undefined` zurück und der Controller meldet aktuell **Abgebrochen**, nicht **Fehlgeschlagen**.

## Kurzsitzungs- und Mindestinhalt-Schutzmaßnahmen

Zwei Schutzmaßnahmen verhindern Handoffs mit geringem Signal:

- UI-Ebene (`handleHandoffCommand`): warnt und kehrt frühzeitig zurück bei `< 2` Nachrichteneinträgen
- Sitzungsebene (`handoff()`): wirft dieselbe Bedingung als Fehler

Dies vermeidet die Erstellung einer neuen Sitzung mit leerem/nahezu leerem Handoff-Kontext.

## Zustandsübergangs-Zusammenfassung

Übergeordneter Zustandsfluss:

1. Interaktiver Slash-Befehl wird abgefangen
2. Vorabprüfung der Nachrichtenanzahl
3. `#handoffAbortController` wird erstellt (`isGeneratingHandoff = true`)
4. Interner Handoff-Prompt wird übermittelt (sichtbar im Chat als normale Assistenten-Generierung)
5. Bei `agent_end` wird der letzte Assistenten-Text extrahiert
6. Wenn fehlend/abgebrochen → `undefined` zurückgeben oder Abbruch-Fehlerpfad
7. Wenn vorhanden:
   - Alte Sitzung flushen
   - Neue leere Sitzung erstellen
   - Laufzeit-Warteschlangen/Zähler zurücksetzen
   - `custom_message(handoff)` anhängen
   - Aktive Agenten-Nachrichten neu aufbauen und ersetzen
8. Controller baut Chat-UI neu auf und meldet Erfolg
9. `#handoffAbortController` wird geleert (`isGeneratingHandoff = false`)

## Bekannte Annahmen und Einschränkungen

- Handoff-Extraktion ist heuristisch: "letzte Assistenten-Textblöcke"; keine strukturelle Validierung.
- Keine harte Prüfung, ob das generierte Markdown dem angeforderten Abschnittsformat folgt.
- Fehlender extrahierter Text wird in der Controller-UX als Abbruch gemeldet.
- Der interaktive `/handoff`-Fluss hat derzeit keine dedizierte Escape→`abortHandoff()`-Bindung.
- Neue Sitzungs-Herkunftsmetadaten (`parentSession`) werden von diesem Pfad nicht gesetzt.
