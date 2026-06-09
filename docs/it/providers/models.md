---
title: Configurazione di modelli e provider
description: >-
  Registro dei modelli e configurazione dei provider tramite models.yml con
  routing, fallback e pricing.
sidebar:
  order: 1
  label: Modelli e provider
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# Configurazione di modelli e provider (`models.yml`)

Questo documento descrive come il coding-agent attualmente carica i modelli, applica le sovrascritture, risolve le credenziali e sceglie i modelli a runtime.

## Cosa controlla il comportamento dei modelli

File di implementazione principali:

- `src/config/model-registry.ts` — carica modelli built-in + personalizzati, sovrascritture dei provider, discovery a runtime, integrazione dell'autenticazione
- `src/config/model-resolver.ts` — analizza i pattern dei modelli e seleziona i modelli initial/smol/slow
- `src/config/settings-schema.ts` — impostazioni relative ai modelli (`modelRoles`, preferenze di trasporto dei provider)
- `src/session/auth-storage.ts` — ordine di risoluzione delle chiavi API + OAuth
- `packages/ai/src/models.ts` e `packages/ai/src/types.ts` — provider/modelli built-in e tipi `Model`/`compat`

## Posizione del file di configurazione e comportamento legacy

Percorso di configurazione predefinito:

- `~/.xcsh/agent/models.yml`

Comportamento legacy ancora presente:

- Se `models.yml` è mancante e `models.json` esiste nella stessa posizione, viene migrato a `models.yml`.
- I percorsi di configurazione espliciti `.json` / `.jsonc` sono ancora supportati quando passati programmaticamente a `ModelRegistry`.

## Struttura di `models.yml`

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` è un intero opzionale scritto dal sistema di auto-config. Quando presente, xcsh lo utilizza per rilevare configurazioni obsolete e aggiornarle automaticamente.

`provider-id` è la chiave canonica del provider utilizzata nella selezione e nel lookup dell'autenticazione.

`equivalence` è opzionale e configura il raggruppamento canonico dei modelli al di sopra dei modelli concreti del provider:

- `overrides` mappa un selettore concreto esatto (`provider/modelId`) a un id canonico upstream ufficiale
- `exclude` esclude un selettore concreto dal raggruppamento canonico

## Campi a livello di provider

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### Valori `api` consentiti per provider/modello

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valori consentiti per auth/discovery

- `auth`: `apiKey` (predefinito) o `none`
- `discovery.type`: `ollama`

## Regole di validazione (attuali)

### Provider personalizzato completo (`models` non vuoto)

Richiesti:

- `baseUrl`
- `apiKey` a meno che non sia impostato `auth: none`
- `api` a livello di provider o per ogni modello

### Provider solo con sovrascritture (`models` mancante o vuoto)

Deve definire almeno uno tra:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` richiede `api` a livello di provider.

### Controlli sui valori del modello

- `id` obbligatorio
- `contextWindow` e `maxTokens` devono essere positivi se forniti

## Ordine di merge e sovrascrittura

Pipeline di ModelRegistry (al refresh):

1. Carica provider/modelli built-in da `@f5xc-salesdemos/pi-ai`.
2. Carica la configurazione personalizzata `models.yml`.
3. Applica le sovrascritture del provider (`baseUrl`, `headers`) ai modelli built-in.
4. Applica `modelOverrides` (per provider + model id).
5. Effettua il merge dei `models` personalizzati:
   - stesso `provider + id` sostituisce l'esistente
   - altrimenti viene aggiunto in coda
6. Applica i modelli scoperti a runtime (attualmente Ollama e LM Studio), poi riapplica le sovrascritture dei modelli.

## Equivalenza canonica dei modelli e coalescenza

Il registro mantiene ogni modello concreto del provider e poi costruisce un livello canonico sopra di essi.

Gli id canonici sono solo id upstream ufficiali, per esempio:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configurazione dell'equivalenza in `models.yml`

Esempio:

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

Ordine di costruzione per il raggruppamento canonico:

1. sovrascrittura esatta dell'utente da `equivalence.overrides`
2. corrispondenze ufficiali-id dai metadati del modello built-in
3. normalizzazione euristica conservativa per varianti gateway/provider
4. fallback all'id proprio del modello concreto

Le euristiche attuali sono intenzionalmente restrittive:

- i prefissi upstream incorporati possono essere rimossi quando presenti, per esempio `anthropic/...` o `openai/...`
- le varianti di versione con punti e trattini possono essere normalizzate solo quando mappano a un id ufficiale esistente, per esempio `4.6 -> 4-6`
- famiglie o versioni ambigue non vengono unite senza una corrispondenza built-in o una sovrascrittura esplicita

### Comportamento della risoluzione canonica

Quando più varianti concrete condividono un id canonico, la risoluzione utilizza:

1. disponibilità e autenticazione
2. `modelProviderOrder` di `config.yml`
3. ordine esistente del registro/provider se `modelProviderOrder` non è impostato

I provider disabilitati o non autenticati vengono saltati.

Lo stato della sessione e le trascrizioni continuano a registrare il provider/modello concreto che ha effettivamente eseguito il turno.

Valori predefiniti del provider vs sovrascritture per modello:

- Gli `headers` del provider sono la base.
- Gli `headers` del modello sovrascrivono le chiavi header del provider.
- `modelOverrides` può sovrascrivere i metadati del modello (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` viene unito in profondità per i blocchi di routing annidati (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integrazione del discovery a runtime

### Discovery implicito di Ollama

Se `ollama` non è configurato esplicitamente, il registro aggiunge un provider scopribile implicito:

- provider: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modalità auth: senza chiave (comportamento `auth: none`)

Il discovery a runtime chiama `GET /api/tags` su Ollama e sintetizza voci di modello con valori predefiniti locali.

### Discovery implicito di llama.cpp

Se `llama.cpp` non è configurato esplicitamente, il registro aggiunge un provider scopribile implicito:
Nota: utilizza la più recente API anthropic messages invece di openai-completions.

- provider: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modalità auth: senza chiave (comportamento `auth: none`)

Il discovery a runtime chiama `GET models` su llama.cpp e sintetizza voci di modello con valori predefiniti locali.

### Discovery implicito di LM Studio

Se `lm-studio` non è configurato esplicitamente, il registro aggiunge un provider scopribile implicito:

- provider: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modalità auth: senza chiave (comportamento `auth: none`)

Il discovery a runtime recupera i modelli (`GET /models`) e sintetizza voci di modello con valori predefiniti locali.

### Discovery esplicito del provider

È possibile configurare il discovery manualmente:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### Registrazione dei provider tramite estensioni

Le estensioni possono registrare provider a runtime (`pi.registerProvider(...)`), inclusi:

- sostituzione/aggiunta di modelli per un provider
- registrazione di handler di stream personalizzati per nuovi ID API
- registrazione di provider OAuth personalizzati

## Ordine di risoluzione dell'autenticazione e delle chiavi API

Quando viene richiesta una chiave per un provider, l'ordine effettivo è:

1. Sovrascrittura a runtime (CLI `--api-key`)
2. Credenziale chiave API memorizzata in `agent.db`
3. Credenziale OAuth memorizzata in `agent.db` (con refresh)
4. Mappatura variabile d'ambiente (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ecc.)
5. Resolver di fallback di ModelRegistry (`apiKey` del provider da `models.yml`, semantica nome-env-o-letterale)

Comportamento di `apiKey` in `models.yml`:

- Il valore viene prima trattato come nome di variabile d'ambiente.
- Se nessuna variabile d'ambiente esiste, la stringa letterale viene usata come token.

Se `authHeader: true` e `apiKey` del provider è impostato, i modelli ricevono:

- Header `Authorization: Bearer <chiave-risolta>` iniettato.

Provider senza chiave:

- I provider contrassegnati con `auth: none` sono trattati come disponibili senza credenziali.
- `getApiKey*` restituisce `kNoAuth` per essi.

## Disponibilità dei modelli vs tutti i modelli

- `getAll()` restituisce il registro dei modelli caricato (built-in + personalizzati uniti + scoperti).
- `getAvailable()` filtra ai modelli che sono senza chiave o hanno un'autenticazione risolvibile.

Quindi un modello può esistere nel registro ma non essere selezionabile fino a quando l'autenticazione non è disponibile.

## Risoluzione dei modelli a runtime

### CLI e analisi dei pattern

`model-resolver.ts` supporta:

- `provider/modelId` esatto
- id canonico del modello esatto
- id del modello esatto (provider inferito)
- corrispondenza fuzzy/sottostringa
- pattern glob di scope in `--models` (es. `openai/*`, `*sonnet*`)
- suffisso opzionale `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` è legacy; `--model` è preferito.

Precedenza di risoluzione per selettori esatti:

1. `provider/modelId` esatto bypassa la coalescenza
2. id canonico esatto si risolve attraverso l'indice canonico
3. id concreto bare esatto funziona ancora
4. la corrispondenza fuzzy e glob viene eseguita dopo i percorsi esatti

### Priorità nella selezione del modello iniziale

`findInitialModel(...)` utilizza questo ordine:

1. provider+modello esplicito da CLI
2. primo modello nello scope (se non si sta riprendendo una sessione)
3. provider/modello predefinito salvato
4. valori predefiniti dei provider noti (es. OpenAI/Anthropic/ecc.) tra i modelli disponibili
5. primo modello disponibile

### Alias dei ruoli e impostazioni

Ruoli del modello supportati:

- `default`, `smol`, `slow`, `plan`, `commit`

Gli alias dei ruoli come `pi/smol` si espandono attraverso `settings.modelRoles`. Ogni valore di ruolo può anche aggiungere un selettore di thinking come `:minimal`, `:low`, `:medium` o `:high`.

Se un ruolo punta a un altro ruolo, il modello di destinazione eredita normalmente e qualsiasi suffisso esplicito sul ruolo referente prevale per quell'uso specifico del ruolo.

Impostazioni correlate:

- `modelRoles` (record)
- `enabledModels` (lista di pattern con scope)
- `modelProviderOrder` (precedenza globale provider canonico)
- `providers.kimiApiFormat` (formato richiesta `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferenza websocket `auto|off|on` per il trasporto OpenAI Codex)

`modelRoles` può memorizzare sia:

- `provider/modelId` per fissare una variante concreta del provider
- un id canonico come `gpt-5.3-codex` per consentire la coalescenza dei provider

Per `enabledModels` e CLI `--models`:

- gli id canonici esatti si espandono a tutte le varianti concrete in quel gruppo canonico
- le voci esplicite `provider/modelId` rimangono esatte
- i glob e le corrispondenze fuzzy operano ancora sui modelli concreti

## `/model` e `--list-models`

Entrambe le interfacce mantengono i modelli con prefisso provider visibili e selezionabili.

Ora espongono anche i modelli canonici/coalescenti:

- `/model` include una vista canonica accanto alle schede dei provider
- `--list-models` stampa una sezione canonica più le righe concrete dei provider

Selezionare una voce canonica memorizza il selettore canonico. Selezionare una riga del provider memorizza l'esplicito `provider/modelId`.

## Promozione del contesto (catene di fallback a livello di modello)

La promozione del contesto è un meccanismo di recupero dall'overflow per varianti con contesto ridotto (per esempio `*-spark`) che promuove automaticamente a un modello fratello con contesto più ampio quando l'API rifiuta una richiesta con un errore di lunghezza del contesto.

### Attivazione e ordine

Quando un turno fallisce con un errore di overflow del contesto (es. `context_length_exceeded`), `AgentSession` tenta la promozione **prima** di ricorrere alla compattazione:

1. Se `contextPromotion.enabled` è true, risolvi un target di promozione (vedi sotto).
2. Se viene trovato un target, passa a esso e riprova la richiesta — nessuna compattazione necessaria.
3. Se nessun target è disponibile, procedi alla compattazione automatica sul modello corrente.

### Selezione del target

La selezione è guidata dal modello, non dal ruolo:

1. `currentModel.contextPromotionTarget` (se configurato)
2. modello con contesto più ampio e più piccolo sullo stesso provider + API

I candidati vengono ignorati a meno che le credenziali non si risolvano (`ModelRegistry.getApiKey(...)`).

### Passaggio websocket di OpenAI Codex

Se si passa da/a `openai-codex-responses`, la chiave dello stato del provider della sessione `openai-codex-responses` viene chiusa prima del cambio di modello. Questo elimina lo stato del trasporto websocket in modo che il turno successivo parta pulito sul modello promosso.

### Comportamento della persistenza

La promozione utilizza il cambio temporaneo (`setModelTemporary`):

- registrato come un `model_change` temporaneo nella cronologia della sessione
- non riscrive la mappatura dei ruoli salvata

### Configurazione di catene di fallback esplicite

Configurare il fallback direttamente nei metadati del modello tramite `contextPromotionTarget`.

`contextPromotionTarget` accetta sia:

- `provider/model-id` (esplicito)
- `model-id` (risolto all'interno del provider corrente)

Esempio (`models.yml`) per Spark -> non-Spark sullo stesso provider:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Il generatore di modelli built-in assegna questo automaticamente anche per i modelli `*-spark` quando esiste un modello base sullo stesso provider.

## Campi di compatibilità e routing

`models.yml` supporta questo sottoinsieme `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Questi vengono consumati dalla logica di trasporto OpenAI-completions e combinati con il rilevamento automatico basato sull'URL.

## Esempi pratici

### Endpoint locale compatibile OpenAI (senza auth)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### Proxy ospitato con chiave basata su variabile d'ambiente

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### Sovrascrittura della rotta del provider built-in + metadati del modello

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## Auto-configurazione del proxy LiteLLM

Quando entrambe le variabili d'ambiente `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono impostate, xcsh gestisce automaticamente la configurazione di `models.yml` per il proxy LiteLLM.

### Auto-generazione al primo avvio

Se `models.yml` non esiste e le variabili d'ambiente LiteLLM vengono rilevate, xcsh lo genera automaticamente:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Viene generato anche un `config.yml` predefinito con impostazioni ragionevoli per il provider di immagini.

### Auto-riparazione all'avvio

Ad ogni avvio, `startupHealthCheck()` nel registro dei modelli esegue i seguenti controlli:

| Condizione | Azione |
|-----------|--------|
| `models.yml` mancante | Auto-generazione dalle variabili d'ambiente |
| `models.yml` corrotto o non analizzabile | Backup in `.bak`, rigenerazione |
| `baseUrl` non corrisponde a `LITELLM_BASE_URL` | Backup in `.bak`, rigenerazione con nuovo URL |
| `configVersion` mancante o obsoleto | Backup in `.bak`, rigenerazione con versione corrente |
| La configurazione è sana | Nessuna azione |

Tutte le riparazioni creano backup `.bak` prima di sovrascrivere. Tutte le operazioni sono idempotenti.

### Comando CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### Variabili d'ambiente richieste

| Variabile | Scopo |
|----------|---------|
| `LITELLM_BASE_URL` | URL del proxy LiteLLM (es. `https://your-proxy.example.com`). Deve iniziare con `http://` o `https://`. |
| `LITELLM_API_KEY` | Chiave API per il proxy. Referenziata per nome nella configurazione generata, risolta a runtime. |

Se una delle due variabili non è impostata, l'auto-configurazione viene silenziosamente saltata.

### Versionamento della configurazione

Le configurazioni generate includono un campo `configVersion`. Quando il formato generato cambia nelle versioni future, xcsh rileva le configurazioni obsolete e le aggiorna automaticamente (con backup).

## Avvertenza sui consumer legacy

La maggior parte della configurazione dei modelli ora passa attraverso `models.yml` tramite `ModelRegistry`.

Rimane un percorso legacy notevole: la risoluzione dell'autenticazione Anthropic per la ricerca web legge ancora direttamente `~/.xcsh/agent/models.json` in `src/web/search/auth.ts`.

Se dipendete da quel percorso specifico, tenete presente la compatibilità JSON fino a quando quel modulo non verrà migrato.

## Modalità di errore

Se `models.yml` non supera i controlli di schema o validazione:

- Se `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono impostati, il controllo di salute all'avvio tenta l'auto-riparazione (backup del file corrotto, rigenerazione dalle variabili d'ambiente). Se la riparazione riesce, il registro ricarica la configurazione corretta.
- Se l'auto-riparazione non è possibile (variabili d'ambiente non impostate, errore di scrittura), il registro continua a operare con i modelli built-in.
- L'errore viene esposto tramite `ModelRegistry.getError()` e mostrato nell'interfaccia/notifiche.
