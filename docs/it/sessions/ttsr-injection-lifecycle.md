---
title: Ciclo di vita dell'iniezione TTSR
description: >-
  Ciclo di vita dell'iniezione TTSR (tool-use, tool-result, system-reminder) per
  la gestione del contesto.
sidebar:
  order: 9
  label: Iniezione TTSR
i18n:
  sourceHash: d6179a286584
  translator: machine
---

# Ciclo di vita dell'iniezione TTSR

Questo documento copre l'attuale percorso runtime delle Time Traveling Stream Rules (TTSR), dalla scoperta delle regole all'interruzione dello stream, all'iniezione di retry, alle notifiche delle estensioni e alla gestione dello stato di sessione.

## File di implementazione

- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/export/ttsr.ts`](../../packages/coding-agent/src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../../packages/coding-agent/src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../../packages/coding-agent/src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../../packages/coding-agent/src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)

## 1. Feed di scoperta e registrazione delle regole

Alla creazione della sessione, `createAgentSession()` carica tutte le regole scoperte e costruisce un `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Comportamento di deduplicazione pre-registrazione

`loadCapability("rules")` deduplica per `rule.name` con semantica first-wins (priorità del provider più alta per prima). I duplicati oscurati vengono rimossi prima della registrazione TTSR.

### Comportamento di `TtsrManager.addRule()`

La registrazione viene saltata quando:

- `rule.ttsrTrigger` è assente
- una regola con lo stesso `rule.name` è già stata registrata in questo manager
- la regex non riesce a compilare (`new RegExp(rule.ttsrTrigger)` lancia un'eccezione)

I trigger con regex non valide vengono registrati come warning e ignorati; l'avvio della sessione continua.

### Avvertenza sulle impostazioni

`TtsrSettings.enabled` viene caricato nel manager ma attualmente non viene verificato nel gating runtime. Se esistono regole, il matching viene comunque eseguito.

## 2. Ciclo di vita del monitor dello streaming

Il rilevamento TTSR viene eseguito all'interno di `AgentSession.#handleAgentEvent`.

### Inizio turno

Su `turn_start`, il buffer dello stream viene resettato:

- `ttsrManager.resetBuffer()`

### Durante lo stream (`message_update`)

Quando arrivano aggiornamenti dell'assistente e le regole esistono:

- monitora `text_delta` e `toolcall_delta`
- aggiungi il delta nel buffer del manager
- chiama `check(buffer)`

`check()` itera le regole registrate e restituisce tutte le regole corrispondenti che superano la policy di ripetizione (`#canTrigger`).

## 3. Decisione di trigger e percorso di abort immediato

Quando una o più regole corrispondono:

1. `markInjected(matches)` registra i nomi delle regole nello stato di iniezione del manager.
2. le regole corrispondenti vengono accodate in `#pendingTtsrInjections`.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` viene chiamato immediatamente.
5. l'evento `ttsr_triggered` viene emesso in modo asincrono (fire-and-forget).
6. il lavoro di retry viene pianificato tramite `setTimeout(..., 50)`.

L'abort non viene bloccato in attesa dei callback delle estensioni.

## 4. Pianificazione del retry, modalità contesto e iniezione del promemoria

Dopo il timeout di 50ms:

1. `#ttsrAbortPending = false`
2. leggi `ttsrManager.getSettings().contextMode`
3. se `contextMode === "discard"`, scarta l'output parziale dell'assistente con `agent.popMessage()`
4. costruisci il contenuto dell'iniezione dalle regole in sospeso usando il template `ttsr-interrupt.md`
5. aggiungi un messaggio utente sintetico contenente un blocco `<system-interrupt ...>` per ogni regola
6. chiama `agent.continue()` per riprovare la generazione

Il payload del template è:

```xml
<system-interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system-interrupt>
```

Le iniezioni in sospeso vengono cancellate dopo la generazione del contenuto.

### Comportamento di `contextMode` sull'output parziale

- `discard`: il messaggio parziale/abortito dell'assistente viene rimosso prima del retry.
- `keep`: l'output parziale dell'assistente rimane nello stato della conversazione; il promemoria viene aggiunto dopo di esso.

## 5. Policy di ripetizione e logica di gap

`TtsrManager` traccia `#messageCount` e `lastInjectedAt` per ogni regola.

### `repeatMode: "once"`

Una regola può triggerare solo una volta dopo che ha un record di iniezione.

### `repeatMode: "after-gap"`

Una regola può ri-triggerare solo quando:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` si incrementa su `turn_end`, quindi il gap viene misurato in turni completati, non in chunk dello stream.

## 6. Emissione degli eventi e superfici di estensione/hook

### Evento di sessione

`AgentSessionEvent` include:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Extension runner

`#emitSessionEvent()` inoltra l'evento a:

- listener delle estensioni (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- sottoscrittori locali della sessione

### Tipizzazione di hook e custom-tool

- l'API delle estensioni espone `on("ttsr_triggered", ...)`
- l'API degli hook espone `on("ttsr_triggered", ...)`
- i custom tool ricevono `onSession({ reason: "ttsr_triggered", rules })`

### Differenza di rendering in modalità interattiva

La modalità interattiva utilizza `session.isTtsrAbortPending` per sopprimere la visualizzazione del motivo di stop dell'assistente abortito come un errore visibile durante l'interruzione TTSR, e renderizza un `TtsrNotificationComponent` quando l'evento arriva.

## 7. Persistenza e stato di ripresa (implementazione attuale)

`SessionManager` ha il supporto completo dello schema per la persistenza delle regole iniettate:

- tipo di entry: `ttsr_injection`
- API di append: `appendTtsrInjection(ruleNames)`
- API di query: `getInjectedTtsrRules()`
- la ricostruzione del contesto include `SessionContext.injectedTtsrRules`

`TtsrManager` supporta anche il ripristino tramite `restoreInjected(ruleNames)`.

### Stato attuale del collegamento

Nel percorso runtime attuale:

- `AgentSession` non aggiunge entry `ttsr_injection` quando il TTSR si attiva.
- `createAgentSession()` non ripristina `existingSession.injectedTtsrRules` nel `ttsrManager`.

Effetto netto: la soppressione delle regole iniettate viene applicata in memoria per il processo attivo, ma attualmente non viene persistita/ripristinata attraverso il ricaricamento/ripresa della sessione da questo percorso.

## 8. Limiti di race condition e garanzie di ordinamento

### Callback di abort vs retry

- l'abort è sincrono dal punto di vista del gestore TTSR (`agent.abort()` chiamato immediatamente)
- il retry è differito tramite timer (`50ms`)
- la notifica delle estensioni è asincrona e intenzionalmente non attesa prima della pianificazione di abort/retry

### Match multipli nella stessa finestra dello stream

`check()` restituisce tutte le regole idonee attualmente corrispondenti. Vengono iniettate come batch nel successivo messaggio di retry.

### Tra abort e continue

Durante la finestra del timer, lo stato può cambiare (interruzione dell'utente, azioni di modalità, eventi aggiuntivi). La chiamata di retry è best-effort: `agent.continue().catch(() => {})` inghiotte gli errori successivi.

## 9. Riepilogo dei casi limite

- Regex `ttsr_trigger` non valida: saltata con warning; le altre regole continuano.
- Nomi di regole duplicati a livello di capability: i duplicati a priorità inferiore vengono oscurati prima della registrazione.
- Nomi duplicati a livello di manager: la seconda registrazione viene ignorata.
- `contextMode: "keep"`: l'output parziale in violazione può rimanere nel contesto prima del retry con promemoria.
- Il repeat-after-gap dipende dagli incrementi del conteggio dei turni a `turn_end`; i chunk a metà turno non avanzano i contatori di gap.
