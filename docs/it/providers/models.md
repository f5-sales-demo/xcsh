---
title: Configurazione di modelli e provider
description: >-
  Registro dei modelli e configurazione del provider tramite models.yml con
  routing, fallback e prezzi.
sidebar:
  order: 1
  label: Modelli e provider
i18n:
  sourceHash: 8053df967ff6
  translator: machine
---

# Configurazione di modelli e provider (`models.yml`)

Questo documento descrive come il coding-agent carica attualmente i modelli, applica le sostituzioni, risolve le credenziali e sceglie i modelli in fase di esecuzione.

## Cosa controlla il comportamento dei modelli

File di implementazione principali:

- `src/config/model-registry.ts` — carica i modelli integrati e personalizzati, le sostituzioni del provider, il rilevamento in fase di esecuzione, l'integrazione con l'autenticazione
- `src/config/model-resolver.ts` — analizza i pattern dei modelli e seleziona i modelli iniziali/smol/slow
- `src/config/settings-schema.ts` — impostazioni relative ai modelli (`modelRoles`, preferenze di trasporto del provider)
- `src/session/auth-storage.ts` — ordine di risoluzione per chiavi API e OAuth
- `packages/ai/src/models.ts` e `packages/ai/src/types.ts` — provider/modelli integrati e tipi `Model`/`compat`

## Posizione del file di configurazione e comportamento legacy

Percorso di configurazione predefinito:

- `~/.xcsh/agent/models.yml`

Comportamento legacy ancora presente:

- Se `models.yml` non è presente e `models.json` esiste nella stessa posizione, viene migrato in `models.yml`.
- I percorsi di configurazione `.json` / `.jsonc` espliciti sono ancora supportati quando passati programmaticamente a `ModelRegistry`.

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

`configVersion` è un intero opzionale scritto dal sistema di configurazione automatica. Quando presente, xcsh lo utilizza per rilevare configurazioni obsolete e aggiornarle automaticamente.

`provider-id` è la chiave canonica del provider utilizzata per la selezione e la ricerca dell'autenticazione.

`equivalence` è opzionale e configura il raggruppamento canonico dei modelli al di sopra dei modelli concreti del provider:

- `overrides` mappa un selettore concreto esatto (`provider/modelId`) a un id canonico ufficiale upstream
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

Obbligatori:

- `baseUrl`
- `apiKey` a meno che non sia impostato `auth: none`
- `api` a livello di provider o per ciascun modello

### Provider solo per sostituzione (`models` assente o vuoto)

Deve definire almeno uno dei seguenti:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` richiede `api` a livello di provider.

### Controlli sui valori del modello

- `id` obbligatorio
- `contextWindow` e `maxTokens` devono essere positivi se forniti

## Ordine di unione e sostituzione

Pipeline di ModelRegistry (durante l'aggiornamento):

1. Carica provider/modelli integrati da `@f5-sales-demo/pi-ai`.
2. Carica la configurazione personalizzata da `models.yml`.
3. Applica le sostituzioni del provider (`baseUrl`, `headers`) ai modelli integrati.
4. Applica `modelOverrides` (per provider + id modello).
5. Unisce i `models` personalizzati:
   - lo stesso `provider + id` sostituisce quello esistente
   - altrimenti viene aggiunto in coda
6. Applica i modelli scoperti in fase di esecuzione (attualmente Ollama e LM Studio), quindi riapplica le sostituzioni del modello.

## Equivalenza canonica dei modelli e coalescenza

Il registro mantiene ogni modello concreto del provider e poi costruisce un livello canonico al di sopra di essi.

Gli id canonici sono id ufficiali upstream, ad esempio:

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

1. sostituzione utente esatta da `equivalence.overrides`
2. corrispondenze di id ufficiali incluse nei metadati del modello integrato
3. normalizzazione euristica conservativa per varianti gateway/provider
4. fallback all'id proprio del modello concreto

Le euristiche attuali sono intenzionalmente limitate:

- i prefissi upstream incorporati possono essere rimossi quando presenti, ad esempio `anthropic/...` o `openai/...`
- le varianti di versione con punti e trattini possono essere normalizzate solo quando mappano a un id ufficiale esistente, ad esempio `4.6 -> 4-6`
- le famiglie o versioni ambigue non vengono unite senza una corrispondenza inclusa o una sostituzione esplicita

### Comportamento della risoluzione canonica

Quando più varianti concrete condividono un id canonico, la risoluzione utilizza:

1. disponibilità e autenticazione
2. `modelProviderOrder` in `config.yml`
3. ordine del registro/provider esistente se `modelProviderOrder` non è impostato

I provider disabilitati o non autenticati vengono ignorati.

Lo stato della sessione e le trascrizioni continuano a registrare il provider/modello concreto che ha effettivamente eseguito il turno.

Valori predefiniti del provider rispetto alle sostituzioni per modello:

- Gli `headers` del provider costituiscono la base.
- Gli `headers` del modello sovrascrivono le chiavi degli header del provider.
- `modelOverrides` può sovrascrivere i metadati del modello (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` viene unito in profondità per i blocchi di routing annidati (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integrazione con il rilevamento in fase di esecuzione

### Rilevamento implicito di Ollama

Se `ollama` non è configurato esplicitamente, il registro aggiunge un provider rilevabile in modo implicito:

- provider: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento in fase di esecuzione chiama `GET /api/tags` su Ollama e sintetizza le voci del modello con valori predefiniti locali.

### Rilevamento implicito di llama.cpp

Se `llama.cpp` non è configurato esplicitamente, il registro aggiunge un provider rilevabile in modo implicito:
Nota: utilizza la nuova API anthropic messages invece di openai-completions.

- provider: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento in fase di esecuzione chiama `GET models` su llama.cpp e sintetizza le voci del modello con valori predefiniti locali.

### Rilevamento implicito di LM Studio

Se `lm-studio` non è configurato esplicitamente, il registro aggiunge un provider rilevabile in modo implicito:

- provider: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento in fase di esecuzione recupera i modelli (`GET /models`) e sintetizza le voci del modello con valori predefiniti locali.

### Rilevamento esplicito del provider

È possibile configurare il rilevamento manualmente:

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

### Registrazione di provider tramite estensioni

Le estensioni possono registrare provider in fase di esecuzione (`pi.registerProvider(...)`), inclusi:

- sostituzione/aggiunta di modelli per un provider
- registrazione di gestori di stream personalizzati per nuovi ID API
- registrazione di provider OAuth personalizzati

## Ordine di risoluzione per autenticazione e chiavi API

Quando si richiede una chiave per un provider, l'ordine effettivo è:

1. Sostituzione in fase di esecuzione (CLI `--api-key`)
2. Credenziale chiave API memorizzata in `agent.db`
3. Credenziale OAuth memorizzata in `agent.db` (con aggiornamento)
4. Mappatura tramite variabile d'ambiente (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ecc.)
5. Resolver di fallback di ModelRegistry (provider `apiKey` da `models.yml`, semantica nome-env-o-letterale)

Comportamento di `apiKey` in `models.yml`:

- Il valore viene prima trattato come nome di variabile d'ambiente.
- Se non esiste alcuna variabile d'ambiente, la stringa letterale viene utilizzata come token.

Se `authHeader: true` e il provider `apiKey` è impostato, i modelli ricevono:

- header `Authorization: Bearer <chiave-risolta>` iniettato.

Provider senza chiave:

- I provider contrassegnati con `auth: none` vengono considerati disponibili senza credenziali.
- `getApiKey*` restituisce `kNoAuth` per essi.

## Disponibilità dei modelli vs tutti i modelli

- `getAll()` restituisce il registro dei modelli caricati (integrati + personalizzati uniti + scoperti).
- `getAvailable()` filtra i modelli che sono senza chiave o hanno un'autenticazione risolvibile.

Pertanto un modello può esistere nel registro ma non essere selezionabile finché non è disponibile l'autenticazione.

## Risoluzione dei modelli in fase di esecuzione

### Analisi di CLI e pattern

`model-resolver.ts` supporta:

- `provider/modelId` esatto
- id di modello canonico esatto
- id di modello esatto (provider dedotto)
- corrispondenza fuzzy/per sottostringa
- pattern glob nell'ambito di `--models` (ad es. `openai/*`, `*sonnet*`)
- suffisso opzionale `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` è legacy; è preferibile usare `--model`.

Precedenza della risoluzione per selettori esatti:

1. `provider/modelId` esatto bypassa la coalescenza
2. id canonico esatto risolve tramite l'indice canonico
3. id concreto semplice esatto funziona comunque
4. la corrispondenza fuzzy e glob viene eseguita dopo i percorsi esatti

### Priorità di selezione del modello iniziale

`findInitialModel(...)` utilizza questo ordine:

1. provider+modello esplicito da CLI
2. primo modello nell'ambito (se non si riprende una sessione)
3. provider/modello predefinito salvato
4. valori predefiniti di provider noti (ad es. OpenAI/Anthropic/ecc.) tra i modelli disponibili
5. primo modello disponibile

### Alias di ruolo e impostazioni

Ruoli dei modelli supportati:

- `default`, `smol`, `slow`, `plan`, `commit`

Gli alias di ruolo come `pi/smol` si espandono tramite `settings.modelRoles`. Ogni valore di ruolo può anche aggiungere un selettore di pensiero come `:minimal`, `:low`, `:medium` o `:high`.

Se un ruolo punta a un altro ruolo, il modello di destinazione eredita normalmente e qualsiasi suffisso esplicito sul ruolo di riferimento prevale per quell'uso specifico del ruolo.

Impostazioni correlate:

- `modelRoles` (record)
- `enabledModels` (elenco di pattern nell'ambito)
- `modelProviderOrder` (precedenza globale del provider canonico)
- `providers.kimiApiFormat` (formato della richiesta `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferenza websocket `auto|off|on` per il trasporto OpenAI Codex)

`modelRoles` può memorizzare:

- `provider/modelId` per fissare una variante concreta del provider
- un id canonico come `gpt-5.3-codex` per consentire la coalescenza del provider

Per `enabledModels` e CLI `--models`:

- gli id canonici esatti si espandono a tutte le varianti concrete in quel gruppo canonico
- le voci esplicite `provider/modelId` rimangono esatte
- i glob e le corrispondenze fuzzy operano comunque sui modelli concreti

## `/model` e `--list-models`

Entrambe le superfici mantengono visibili e selezionabili i modelli con prefisso del provider.

Ora espongono anche i modelli canonici/coalescenti:

- `/model` include una vista canonica insieme alle schede del provider
- `--list-models` stampa una sezione canonica più le righe concrete del provider

La selezione di una voce canonica memorizza il selettore canonico. La selezione di una riga del provider memorizza l'`provider/modelId` esplicito.

## Promozione del contesto (catene di fallback a livello di modello)

La promozione del contesto è un meccanismo di recupero da overflow per varianti con contesto ridotto (ad esempio `*-spark`) che promuove automaticamente a un elemento gemello con contesto più ampio quando l'API rifiuta una richiesta con un errore di lunghezza del contesto.

### Attivazione e ordine

Quando un turno fallisce con un errore di overflow del contesto (ad es. `context_length_exceeded`), `AgentSession` tenta la promozione **prima** di ricorrere alla compattazione:

1. Se `contextPromotion.enabled` è true, risolve un target di promozione (vedere di seguito).
2. Se viene trovato un target, lo sostituisce e riprova la richiesta — senza necessità di compattazione.
3. Se non è disponibile alcun target, prosegue con la compattazione automatica sul modello corrente.

### Selezione del target

La selezione è guidata dal modello, non dal ruolo:

1. `currentModel.contextPromotionTarget` (se configurato)
2. modello con contesto più ampio più piccolo sullo stesso provider + API

I candidati vengono ignorati a meno che le credenziali non si risolvano (`ModelRegistry.getApiKey(...)`).

### Handoff del websocket OpenAI Codex

In caso di passaggio da/a `openai-codex-responses`, la chiave di stato del provider di sessione `openai-codex-responses` viene chiusa prima del cambio di modello. Questo elimina lo stato del trasporto websocket in modo che il turno successivo parta pulito sul modello promosso.

### Comportamento della persistenza

La promozione utilizza il cambio temporaneo (`setModelTemporary`):

- registrata come `model_change` temporaneo nella cronologia della sessione
- non riscrive la mappatura dei ruoli salvata

### Configurazione di catene di fallback esplicite

Configurare il fallback direttamente nei metadati del modello tramite `contextPromotionTarget`.

`contextPromotionTarget` accetta:

- `provider/model-id` (esplicito)
- `model-id` (risolto nel provider corrente)

Esempio (`models.yml`) per Spark -> non-Spark sullo stesso provider:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Il generatore di modelli integrato assegna anche questo automaticamente per i modelli `*-spark` quando esiste un modello base sullo stesso provider.

## Campi di compatibilità e routing

`models.yml` supporta questo sottoinsieme di `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Questi vengono utilizzati dalla logica di trasporto OpenAI-completions e combinati con il rilevamento automatico basato su URL.

## Esempi pratici

### Endpoint compatibile con OpenAI locale (senza autenticazione)

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

### Sostituzione del routing del provider integrato e metadati del modello

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

## Configurazione automatica del proxy LiteLLM

Quando le variabili d'ambiente `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono entrambe impostate, xcsh gestisce automaticamente la configurazione di `models.yml` per il proxy LiteLLM.

### Generazione automatica al primo avvio

Se `models.yml` non esiste e vengono rilevate le variabili d'ambiente LiteLLM, xcsh lo genera automaticamente:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Viene generato anche un `config.yml` predefinito con impostazioni sensate per il provider di immagini.

### Autoripristino all'avvio

Ad ogni avvio, `startupHealthCheck()` nel registro dei modelli esegue i seguenti controlli:

| Condizione | Azione |
|-----------|--------|
| `models.yml` mancante | Genera automaticamente dalle variabili d'ambiente |
| `models.yml` corrotto o non analizzabile | Backup in `.bak`, rigenera |
| `baseUrl` non corrisponde a `LITELLM_BASE_URL` | Backup in `.bak`, rigenera con nuovo URL |
| `configVersion` mancante o obsoleto | Backup in `.bak`, rigenera con versione corrente |
| Configurazione integra | Nessuna azione |

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
| `LITELLM_BASE_URL` | URL del proxy LiteLLM (ad es. `https://your-proxy.example.com`). Deve iniziare con `http://` o `https://`. |
| `LITELLM_API_KEY` | Chiave API per il proxy. Referenziata per nome nella configurazione generata, risolta in fase di esecuzione. |

Se una delle variabili non è impostata, la configurazione automatica viene ignorata silenziosamente.

### Versioning della configurazione

Le configurazioni generate includono un campo `configVersion`. Quando il formato generato cambia nelle versioni future, xcsh rileva le configurazioni obsolete e le aggiorna automaticamente (con backup).

## Avvertenza per i consumer legacy

La maggior parte della configurazione dei modelli ora fluisce tramite `models.yml` attraverso `ModelRegistry`.

Rimane un percorso legacy degno di nota: la risoluzione dell'autenticazione Anthropic per la ricerca web legge ancora direttamente `~/.xcsh/agent/models.json` in `src/web/search/auth.ts`.

Se si fa affidamento su quel percorso specifico, tenere presente la compatibilità JSON finché tale modulo non viene migrato.

## Modalità di errore

Se `models.yml` non supera i controlli di schema o validazione:

- Se `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono impostati, il controllo di integrità all'avvio tenta la riparazione automatica (backup del file corrotto, rigenerazione dalle variabili d'ambiente). Se la riparazione ha esito positivo, il registro ricarica la configurazione corretta.
- Se la riparazione automatica non è possibile (variabili d'ambiente non impostate, errore di scrittura), il registro continua a operare con i modelli integrati.
- L'errore viene esposto tramite `ModelRegistry.getError()` e visualizzato nell'interfaccia utente/notifiche.
