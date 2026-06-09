---
title: Handoff-Generierungspipeline
description: >-
  Handoff-Generierungspipeline zur Erstellung portabler
  Sitzungszusammenfassungen für die Teamzusammenarbeit.
sidebar:
  order: 8
  label: Handoff-Pipeline
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# `/handoff`-Generierungspipeline

Dieses Dokument beschreibt, wie der Coding-Agent `/handoff` heute implementiert: Auslösepfad, Generierungsprompt, Erfassung der Vervollständigung, Sitzungswechsel und Kontextreinjektion.

## Geltungsbereich

Abgedeckt:

- Interaktive `/handoff`-Befehlsverteilung
- `AgentSession.handoff()`-Lebenszyklus und Zustandsübergänge
- Wie die Handoff-Ausgabe aus der Assistentenausgabe erfasst wird
- Wie alte/neue Sitzungen Handoff-Daten unterschiedlich persistieren
- UI-Verhalten bei Erfolg, Abbruch und Fehler

Nicht abgedeckt:

- Interne Baumnavigation/Branch-Interna
- Nicht-Handoff-Sitzungsbefehle (`/new`, `/fork`, `/resume`)

## Implementierungsdateien

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Auslösepfad

1. `/handoff` wird in den eingebauten Slash-Befehl-Metadaten (`slash-commands.ts`) mit optionalem Inline-Hinweis deklariert: `[focus instructions]`.
2. Bei der interaktiven Eingabeverarbeitung (`InputController`) wird eingegebener Text, der `/handoff` oder `/handoff ...` entspricht, vor der normalen Prompt-Übermittlung abgefangen.
3. Der Editor wird geleert und `handleHandoffCommand(customInstructions?)` wird aufgerufen.
4. `CommandController.handleHandoffCommand` führt eine Vorabprüfung anhand der aktuellen Einträge durch:
   - Zählt Einträge vom `type === "message"`.
   - Bei `< 2` wird gewarnt: `Nothing to hand off (no messages yet)` und zurückgekehrt.

Die gleiche Mindestinhaltsprüfung existiert erneut innerhalb von `AgentSession.handoff()` und wirft einen Fehler bei Verletzung. Dies dupliziert die Sicherheit sowohl auf UI- als auch auf Sitzungsebene.

## End-to-End-Lebenszyklus

### 1) Handoff-Generierung starten

`AgentSession.handoff(customInstructions?)`:

- Liest aktuelle Branch-Einträge (`sessionManager.getBranch()`)
- Validiert die Mindestanzahl von Nachrichten (`>= 2`)
- Erstellt `#handoffAbortController`
- Erstellt einen festen, Inline-Prompt, der ein strukturiertes Handoff-Dokument anfordert (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Hängt `Additional focus: ...` an, falls benutzerdefinierte Anweisungen vorhanden sind

Der Prompt wird gesendet über:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` verhindert die Slash-/Prompt-Template-Expansion dieses internen Anweisungsnutzlast.

### 2) Vervollständigung erfassen

Vor dem Senden des Prompts abonniert `handoff()` Sitzungsereignisse und wartet auf `agent_end`.

Bei `agent_end` extrahiert es den Handoff-Text aus dem Agentenzustand, indem es rückwärts nach der neuesten `assistant`-Nachricht sucht und dann alle `content`-Blöcke mit `type === "text"` mit `\n` konkateniert.

Wichtige Extraktionsannahmen:

- Nur Textblöcke werden verwendet; Nicht-Text-Inhalte werden ignoriert.
- Es wird angenommen, dass die neueste Assistentennachricht der Handoff-Generierung entspricht.
- Es werden keine Markdown-Abschnitte geparst oder Formatkonformität validiert.
- Wenn die Assistentenausgabe keine Textblöcke enthält, wird der Handoff als fehlend behandelt.

### 3) Abbruchprüfungen

`handoff()` gibt `undefined` zurück, wenn eine der Bedingungen zutrifft:

- kein erfasster Handoff-Text, oder
- `#handoffAbortController.signal.aborted` ist true

Es löscht `#handoffAbortController` immer im `finally`-Block.

### 4) Neue Sitzungserstellung

Wenn Text erfasst wurde und kein Abbruch erfolgte:

1. Aktuelle Sitzung schreiben leeren (`sessionManager.flush()`)
2. Eine brandneue Sitzung starten (`sessionManager.newSession()`)
3. In-Memory-Agentenzustand zurücksetzen (`agent.reset()`)
4. `agent.sessionId` an die neue Sitzungs-ID binden
5. Warteschlangen-Kontext-Arrays leeren (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Todo-Erinnerungszähler zurücksetzen

`newSession()` erstellt einen neuen Header und eine leere Eintragsliste (Leaf wird auf `null` zurückgesetzt). Im Handoff-Pfad wird keine `parentSession` übergeben.

### 5) Handoff-Kontext-Injektion

Das generierte Handoff-Dokument wird eingewickelt und der neuen Sitzung als `custom_message`-Eintrag angehängt:

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

Nach der Injektion:

1. `sessionManager.buildSessionContext()` löst die Nachrichtenliste für das aktuelle Leaf auf
2. `agent.replaceMessages(sessionContext.messages)` macht die injizierte Handoff-Nachricht zum aktiven Kontext
3. Die Methode gibt `{ document: handoffText }` zurück

Zu diesem Zeitpunkt enthält der aktive LLM-Kontext in der neuen Sitzung die injizierte Handoff-Nachricht, nicht das alte Transkript.

## Persistenzmodell: alte Sitzung vs. neue Sitzung

### Alte Sitzung

Während der Generierung bleibt die normale Nachrichtenpersistenz aktiv. Die Assistenten-Handoff-Antwort wird als regulärer `message`-Eintrag bei `message_end` persistiert.

Ergebnis: Die ursprüngliche Sitzung enthält den sichtbar generierten Handoff als Teil des historischen Transkripts.

### Neue Sitzung

Nach dem Sitzungs-Reset wird der Handoff als `custom_message` mit `customType: "handoff"` persistiert.

`buildSessionContext()` konvertiert diesen Eintrag über `createCustomMessage(...)` in eine Laufzeit-Custom/User-Kontext-Nachricht, sodass er in zukünftigen Prompts der neuen Sitzung enthalten ist.

## Controller/UI-Verhalten

`CommandController.handleHandoffCommand`-Verhalten:

- Ruft `await session.handoff(customInstructions)` auf
- Wenn das Ergebnis `undefined` ist: `showError("Handoff cancelled")`
- Bei Erfolg:
  - `rebuildChatFromMessages()` (lädt neuen Sitzungskontext, einschließlich injiziertem Handoff)
  - Invalidiert Statuszeile und oberen Editor-Rahmen
  - Lädt Todos neu
  - Hängt Erfolgs-Chatzeile an: `New session started with handoff context`
- Bei Ausnahme:
  - wenn die Nachricht `"Handoff cancelled"` oder der Fehlername `AbortError` ist: `showError("Handoff cancelled")`
  - andernfalls: `showError("Handoff failed: <message>")`
- Fordert am Ende Rendering an

## Abbruchsemantik (aktuelles Verhalten)

### Abbruchprimitiv auf Sitzungsebene

`AgentSession` stellt bereit:

- `abortHandoff()` → bricht `#handoffAbortController` ab
- `isGeneratingHandoff` → true, solange der Controller existiert

Wenn dieser Abbruchpfad verwendet wird, lehnt der Handoff-Subscriber mit `Error("Handoff cancelled")` ab, und der Command-Controller ordnet dies der Abbruch-UI zu.

### Einschränkung des interaktiven `/handoff`-Pfads

In der aktuellen interaktiven Controller-Verdrahtung installiert `/handoff` keinen dedizierten Escape-Handler, der `abortHandoff()` aufruft (im Gegensatz zu Kompaktierungs-/Branch-Summary-Pfaden, die temporär `editor.onEscape` überschreiben).

Praktische Auswirkung:

- Es gibt Abbruchunterstützung auf Sitzungsebene, aber keinen handoff-spezifischen Tastenbindungs-Hook im `/handoff`-Befehlspfad.
- Benutzerunterbrechungen können weiterhin über breitere Agenten-Abbruchpfade erfolgen, aber das ist nicht derselbe explizite Abbruchkanal, der von `abortHandoff()` verwendet wird.

## Abgebrochener vs. fehlgeschlagener Handoff

Aktuelle UI-Klassifikation:

- **Abgebrochen/Storniert**
  - `abortHandoff()`-Pfad löst `"Handoff cancelled"` aus, oder
  - geworfener `AbortError`
  - UI zeigt `Handoff cancelled`

- **Fehlgeschlagen**
  - jeder andere geworfene Fehler aus `handoff()` / Prompt-Pipeline (Modell-/API-Validierungsfehler, Laufzeitausnahmen usw.)
  - UI zeigt `Handoff failed: ...`

Zusätzliche Nuance: Wenn die Generierung abgeschlossen wird, aber kein Text extrahiert wird, gibt `handoff()` `undefined` zurück und der Controller meldet derzeit **abgebrochen**, nicht **fehlgeschlagen**.

## Kurzsitzungs- und Mindestinhaltsschutzmaßnahmen

Zwei Schutzmaßnahmen verhindern signalarme Handoffs:

- UI-Ebene (`handleHandoffCommand`): warnt und kehrt frühzeitig bei `< 2` Nachrichteneinträgen zurück
- Sitzungsebene (`handoff()`): wirft die gleiche Bedingung als Fehler

Dies vermeidet die Erstellung einer neuen Sitzung mit leerem/nahezu leerem Handoff-Kontext.

## Zusammenfassung der Zustandsübergänge

Übergeordneter Zustandsfluss:

1. Interaktiver Slash-Befehl abgefangen
2. Vorabprüfung der Nachrichtenanzahl
3. `#handoffAbortController` erstellt (`isGeneratingHandoff = true`)
4. Interner Handoff-Prompt übermittelt (sichtbar im Chat als normale Assistentengenerierung)
5. Bei `agent_end` wird der letzte Assistententext extrahiert
6. Wenn fehlend/abgebrochen → `undefined` zurückgeben oder Abbruchfehlerpfad
7. Wenn vorhanden:
   - alte Sitzung leeren
   - neue leere Sitzung erstellen
   - Laufzeitwarteschlangen/-zähler zurücksetzen
   - `custom_message(handoff)` anhängen
   - aktive Agentennachrichten neu aufbauen und ersetzen
8. Controller baut Chat-UI neu auf und meldet Erfolg
9. `#handoffAbortController` geleert (`isGeneratingHandoff = false`)

## Bekannte Annahmen und Einschränkungen

- Handoff-Extraktion ist heuristisch: "letzte Assistenten-Textblöcke"; keine strukturelle Validierung.
- Keine harte Prüfung, ob das generierte Markdown dem angeforderten Abschnittsformat folgt.
- Fehlender extrahierter Text wird in der Controller-UX als Abbruch gemeldet.
- Der interaktive `/handoff`-Flow hat derzeit keine dedizierte Escape→`abortHandoff()`-Bindung.
- Abstammungsmetadaten der neuen Sitzung (`parentSession`) werden von diesem Pfad nicht gesetzt.
