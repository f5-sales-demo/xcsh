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

Dieses Dokument beschreibt, wie der Coding-Agent `/handoff` heute implementiert: Auslösepfad, Generierungs-Prompt, Erfassung der Vervollständigung, Sitzungswechsel und Kontext-Reinjektion.

## Geltungsbereich

Behandelt:

- Interaktive `/handoff`-Befehlsweiterleitung
- `AgentSession.handoff()`-Lebenszyklus und Zustandsübergänge
- Wie die Handoff-Ausgabe aus der Assistenten-Ausgabe erfasst wird
- Wie alte/neue Sitzungen Handoff-Daten unterschiedlich persistieren
- UI-Verhalten bei Erfolg, Abbruch und Fehler

Behandelt nicht:

- Generische Baumnavigation/Branch-Interna
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
4. `CommandController.handleHandoffCommand` führt eine Vorprüfung anhand der aktuellen Einträge durch:
   - Zählt Einträge vom `type === "message"`.
   - Bei `< 2` wird gewarnt: `Nothing to hand off (no messages yet)` und die Methode kehrt zurück.

Die gleiche Mindestinhalt-Prüfung existiert erneut innerhalb von `AgentSession.handoff()` und wirft einen Fehler bei Verletzung. Dies dupliziert die Sicherheit sowohl auf der UI- als auch auf der Sitzungsebene.

## End-to-End-Lebenszyklus

### 1) Handoff-Generierung starten

`AgentSession.handoff(customInstructions?)`:

- Liest die aktuellen Branch-Einträge (`sessionManager.getBranch()`)
- Validiert die Mindestanzahl an Nachrichten (`>= 2`)
- Erstellt `#handoffAbortController`
- Baut einen festen, inline Prompt auf, der ein strukturiertes Handoff-Dokument anfordert (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Hängt `Additional focus: ...` an, wenn benutzerdefinierte Anweisungen bereitgestellt werden

Der Prompt wird gesendet via:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` verhindert die Slash/Prompt-Template-Expansion dieser internen Anweisungs-Payload.

### 2) Vervollständigung erfassen

Vor dem Senden des Prompts abonniert `handoff()` Sitzungsereignisse und wartet auf `agent_end`.

Bei `agent_end` extrahiert es den Handoff-Text aus dem Agenten-Zustand, indem es rückwärts nach der neuesten `assistant`-Nachricht sucht und dann alle `content`-Blöcke, bei denen `type === "text"` gilt, mit `\n` verkettet.

Wichtige Extraktionsannahmen:

- Nur Textblöcke werden verwendet; Nicht-Text-Inhalte werden ignoriert.
- Es wird angenommen, dass die neueste Assistenten-Nachricht der Handoff-Generierung entspricht.
- Es werden keine Markdown-Abschnitte geparst oder Formatkonformität validiert.
- Wenn die Assistenten-Ausgabe keine Textblöcke hat, wird der Handoff als fehlend behandelt.

### 3) Abbruchprüfungen

`handoff()` gibt `undefined` zurück, wenn eine der folgenden Bedingungen zutrifft:

- kein erfasster Handoff-Text, oder
- `#handoffAbortController.signal.aborted` ist `true`

Es bereinigt `#handoffAbortController` immer im `finally`-Block.

### 4) Neue Sitzung erstellen

Wenn Text erfasst wurde und kein Abbruch erfolgte:

1. Aktuelle Sitzung schreiben lassen (`sessionManager.flush()`)
2. Eine brandneue Sitzung starten (`sessionManager.newSession()`)
3. In-Memory-Agenten-Zustand zurücksetzen (`agent.reset()`)
4. `agent.sessionId` an die neue Sitzungs-ID binden
5. Warteschlangen-Kontext-Arrays leeren (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Todo-Erinnerungszähler zurücksetzen

`newSession()` erstellt einen neuen Header und eine leere Eintragsliste (Leaf wird auf `null` zurückgesetzt). Im Handoff-Pfad wird keine `parentSession` übergeben.

### 5) Handoff-Kontext-Injektion

Das generierte Handoff-Dokument wird umschlossen und als `custom_message`-Eintrag an die neue Sitzung angehängt:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Einfügungs-Aufruf:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semantik:

- `customType`: `"handoff"`
- `display`: `true` (sichtbar bei TUI-Rekonstruktion)
- Eintragstyp: `custom_message` (nimmt am LLM-Kontext teil)

### 6) Aktiven Agenten-Kontext neu aufbauen

Nach der Injektion:

1. `sessionManager.buildSessionContext()` löst die Nachrichtenliste für das aktuelle Leaf auf
2. `agent.replaceMessages(sessionContext.messages)` macht die injizierte Handoff-Nachricht zum aktiven Kontext
3. Methode gibt `{ document: handoffText }` zurück

Zu diesem Zeitpunkt enthält der aktive LLM-Kontext in der neuen Sitzung die injizierte Handoff-Nachricht, nicht das alte Transkript.

## Persistenzmodell: alte Sitzung vs. neue Sitzung

### Alte Sitzung

Während der Generierung bleibt die normale Nachrichtenpersistierung aktiv. Die Assistenten-Handoff-Antwort wird als regulärer `message`-Eintrag bei `message_end` persistiert.

Ergebnis: Die ursprüngliche Sitzung enthält den sichtbaren generierten Handoff als Teil des historischen Transkripts.

### Neue Sitzung

Nach dem Sitzungs-Reset wird der Handoff als `custom_message` mit `customType: "handoff"` persistiert.

`buildSessionContext()` konvertiert diesen Eintrag über `createCustomMessage(...)` in eine Laufzeit-Custom/User-Kontext-Nachricht, sodass er in zukünftigen Prompts der neuen Sitzung enthalten ist.

## Controller/UI-Verhalten

`CommandController.handleHandoffCommand`-Verhalten:

- Ruft `await session.handoff(customInstructions)` auf
- Wenn das Ergebnis `undefined` ist: `showError("Handoff cancelled")`
- Bei Erfolg:
  - `rebuildChatFromMessages()` (lädt den neuen Sitzungskontext, einschließlich injiziertem Handoff)
  - Invalidiert Statuszeile und oberen Editor-Rahmen
  - Lädt Todos neu
  - Hängt Erfolgs-Chat-Zeile an: `New session started with handoff context`
- Bei Ausnahme:
  - wenn die Nachricht `"Handoff cancelled"` lautet oder der Fehlername `AbortError` ist: `showError("Handoff cancelled")`
  - andernfalls: `showError("Handoff failed: <message>")`
- Fordert am Ende ein Render an

## Abbruch-Semantik (aktuelles Verhalten)

### Abbruch-Primitiv auf Sitzungsebene

`AgentSession` stellt bereit:

- `abortHandoff()` → bricht `#handoffAbortController` ab
- `isGeneratingHandoff` → true, solange der Controller existiert

Wenn dieser Abbruchpfad verwendet wird, lehnt der Handoff-Subscriber mit `Error("Handoff cancelled")` ab, und der Command-Controller ordnet dies der Abbruch-UI zu.

### Einschränkung des interaktiven `/handoff`-Pfads

In der aktuellen interaktiven Controller-Verdrahtung installiert `/handoff` keinen dedizierten Escape-Handler, der `abortHandoff()` aufruft (anders als Kompaktierungs-/Branch-Summary-Pfade, die `editor.onEscape` temporär überschreiben).

Praktische Auswirkung:

- Es gibt Abbruchunterstützung auf Sitzungsebene, aber keinen handoff-spezifischen Tastenbindungs-Hook im `/handoff`-Befehlspfad.
- Benutzerunterbrechungen können weiterhin über breitere Agenten-Abbruchpfade erfolgen, aber das ist nicht derselbe explizite Abbruchkanal, der von `abortHandoff()` verwendet wird.

## Abgebrochen vs. fehlgeschlagener Handoff

Aktuelle UI-Klassifizierung:

- **Abgebrochen/Storniert**
  - `abortHandoff()`-Pfad löst `"Handoff cancelled"` aus, oder
  - geworfener `AbortError`
  - UI zeigt `Handoff cancelled`

- **Fehlgeschlagen**
  - jeder andere geworfene Fehler von `handoff()` / Prompt-Pipeline (Modell-/API-Validierungsfehler, Laufzeitausnahmen usw.)
  - UI zeigt `Handoff failed: ...`

Zusätzliche Nuance: Wenn die Generierung abgeschlossen wird, aber kein Text extrahiert werden konnte, gibt `handoff()` `undefined` zurück und der Controller meldet derzeit **abgebrochen**, nicht **fehlgeschlagen**.

## Kurzsitzungs- und Mindestinhalt-Schutzmaßnahmen

Zwei Prüfungen verhindern Handoffs mit geringem Signalgehalt:

- UI-Ebene (`handleHandoffCommand`): warnt und kehrt frühzeitig zurück bei `< 2` Nachrichteneinträgen
- Sitzungsebene (`handoff()`): wirft die gleiche Bedingung als Fehler

Dies vermeidet die Erstellung einer neuen Sitzung mit leerem/nahezu leerem Handoff-Kontext.

## Zusammenfassung der Zustandsübergänge

Übergeordneter Zustandsfluss:

1. Interaktiver Slash-Befehl wird abgefangen
2. Vorprüfung der Nachrichtenanzahl
3. `#handoffAbortController` wird erstellt (`isGeneratingHandoff = true`)
4. Interner Handoff-Prompt wird übermittelt (im Chat als normale Assistenten-Generierung sichtbar)
5. Bei `agent_end` wird der letzte Assistenten-Text extrahiert
6. Wenn fehlend/abgebrochen → `undefined` zurückgeben oder Abbruch-Fehlerpfad
7. Wenn vorhanden:
   - Alte Sitzung flushen
   - Neue leere Sitzung erstellen
   - Laufzeit-Warteschlangen/Zähler zurücksetzen
   - `custom_message(handoff)` anhängen
   - Aktive Agenten-Nachrichten neu aufbauen und ersetzen
8. Controller baut Chat-UI neu auf und meldet Erfolg
9. `#handoffAbortController` wird bereinigt (`isGeneratingHandoff = false`)

## Bekannte Annahmen und Einschränkungen

- Die Handoff-Extraktion ist heuristisch: "letzte Assistenten-Textblöcke"; keine strukturelle Validierung.
- Keine harte Prüfung, ob das generierte Markdown dem angeforderten Abschnittsformat folgt.
- Fehlender extrahierter Text wird in der Controller-UX als Abbruch gemeldet.
- Der interaktive `/handoff`-Ablauf verfügt derzeit über keine dedizierte Escape→`abortHandoff()`-Bindung.
- Neue Sitzungs-Abstammungsmetadaten (`parentSession`) werden in diesem Pfad nicht gesetzt.
