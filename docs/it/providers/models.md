---
title: Configurazione di Modelli e Provider
description: Registro dei modelli e configurazione dei provider tramite models.yml con routing, fallback e pricing.
sidebar:
  order: 1
  label: Modelli e provider
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Configurazione di Modelli e Provider (`models.yml`)

Questo documento descrive come il coding-agent attualmente carica i modelli, applica gli override, risolve le credenziali e sceglie i modelli a runtime.

## Cosa controlla il comportamento del modello

File di implementazione principali:

- `src/config/model-registry.ts` — carica i modelli integrati + personalizzati, gli override dei provider, il rilevamento a runtime, l'integrazione dell'autenticazione
- `src/config/model-resolver.ts` — analizza i pattern dei modelli e seleziona i modelli initial/smol/slow
- `src/config/settings-schema.ts` — impostazioni relative ai modelli (`modelRoles`, preferenze di trasporto del provider)
- `src/session/auth-storage.ts` — ordine di risoluzione delle chiavi API + OAuth
- `packages/ai/src/models.ts` e `packages/ai/src/types.ts` — provider/modelli integrati e tipi `Model`/`compat`

## Posizione del file di configurazione e comportamento legacy

Percorso di configurazione predefinito:

- `~/.xcsh/agent/models.yml`

Comportamento legacy ancora presente:

- Se `models.yml` è mancante e `models.json` esiste nella stessa posizione, viene migrato a `models.yml`.
- I percorsi di configurazione espliciti `.json` / `.jsonc` sono ancora supportati quando passati in modo programmatico al `ModelRegistry`.

## Struttura di `models.yml`

```yaml
configVersion: 1  # facoltativo — scritto da auto-config, usato per il rilevamento della migrazione
providers:
  <provider-id>:
    # configurazione a livello di provider
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` è un numero intero facoltativo scritto dal sistema di auto-configurazione. Quando è presente, xcsh lo utilizza per rilevare le configurazioni obsolete e aggiornarle automaticamente.

`provider-id` è la chiave canonica del provider utilizzata per la selezione e la ricerca dell'autenticazione.

`equivalence` è facoltativo e configura il raggruppamento canonico dei modelli in aggiunta ai modelli di provider concreti:

- `overrides` mappa un selettore concreto esatto (`provider/modelId`) a un ID canonico ufficiale upstream
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

### Valori consentiti di `api` per provider/modello

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valori consentiti per auth/discovery

- `auth`: `apiKey` (impostazione predefinita) o `none`
- `discovery.type`: `ollama`

## Regole di validazione (attuali)

### Provider personalizzato completo (`models` non è vuoto)

Richiesto:

- `baseUrl`
- `apiKey` a meno che `auth: none`
- `api` a livello di provider o per ogni modello

### Provider con solo override (`models` mancante o vuoto)

Deve definire almeno uno di:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Rilevamento (Discovery)

- `discovery` richiede `api` a livello di provider.

### Controlli sui valori del modello

- `id` richiesto
- `contextWindow` e `maxTokens` devono essere positivi se forniti

## Ordine di unione e override

Pipeline del ModelRegistry (all'aggiornamento):

1. Carica i provider/modelli integrati da `@f5-sales-demo/pi-ai`.
2. Carica la configurazione personalizzata `models.yml`.
3. Applica gli override del provider (`baseUrl`, `headers`) ai modelli integrati.
4. Applica `modelOverrides` (per provider + id del modello).
5. Unisce i `models` personalizzati:
   - stesso `provider + id` sostituisce quello esistente
   - altrimenti accoda
6. Applica i modelli rilevati a runtime (attualmente Ollama e LM Studio), quindi riapplica gli override dei modelli.

## Equivalenza del modello canonico e coalescing

Il registro mantiene ogni modello di provider concreto e costruisce poi un livello canonico sopra di essi.

Gli ID canonici sono solo gli ID ufficiali upstream, per esempio:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configurazione di equivalenza in `models.yml`

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

1. override utente esatto da `equivalence.overrides`
2. corrispondenze in bundle di ID ufficiali dai metadati dei modelli integrati
3. normalizzazione euristica conservativa per varianti di gateway/provider
4. fallback all'ID del modello concreto stesso

Le euristiche attuali sono intenzionalmente limitate:

- i prefissi upstream incorporati possono essere rimossi quando presenti, ad esempio `anthropic/...` o `openai/...`
- le varianti di versione con punti e trattini possono essere normalizzate solo quando si mappano a un ID ufficiale esistente, per esempio `4.6 -> 4-6`
- le famiglie o le versioni ambigue non vengono unite senza una corrispondenza in bundle o un override esplicito

### Comportamento della risoluzione canonica

Quando più varianti concrete condividono un ID canonico, la risoluzione utilizza:

1. disponibilità e autenticazione
2. `modelProviderOrder` da `config.yml`
3. l'ordine esistente del registro/provider se `modelProviderOrder` non è impostato

I provider disabilitati o non autenticati vengono ignorati.

Lo stato della sessione e le trascrizioni continuano a registrare il provider/modello concreto che ha effettivamente eseguito il turno.

Impostazioni predefinite del provider vs override per modello:

- Gli `headers` del provider sono la base.
- Gli `headers` del modello sovrascrivono le chiavi degli header del provider.
- `modelOverrides` può sovrascrivere i metadati del modello (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` viene unito in profondità per blocchi di routing annidati (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integrazione del rilevamento a runtime

### Rilevamento implicito di Ollama

Se `ollama` non è configurato esplicitamente, il registro aggiunge un provider rilevabile implicito:

- provider: `ollama`
- api: `openai-completions`
- base URL: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento a runtime chiama `GET /api/tags` su Ollama e sintetizza le voci del modello con i valori predefiniti locali.

### Rilevamento implicito di llama.cpp

Se `llama.cpp` non è configurato esplicitamente, il registro aggiunge un provider rilevabile implicito:
Nota: utilizza l'API antropic messages più recente invece di openai-completions.

- provider: `llama.cpp`
- api: `openai-responses`
- base URL: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento a runtime chiama `GET models` su llama.cpp e sintetizza le voci del modello con i valori predefiniti locali.

### Rilevamento implicito di LM Studio

Se `lm-studio` non è configurato esplicitamente, il registro aggiunge un provider rilevabile implicito:

- provider: `lm-studio`
- api: `openai-completions`
- base URL: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modalità di autenticazione: senza chiave (comportamento `auth: none`)

Il rilevamento a runtime recupera i modelli (`GET /models`) e sintetizza le voci del modello con i valori predefiniti locali.

### Rilevamento del provider esplicito

Puoi configurare tu stesso il rilevamento:

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

Le estensioni possono registrare provider a runtime (`pi.registerProvider(...)`), inclusi:

- sostituzione/aggiunta di modelli per un provider
- registrazione di gestori di stream personalizzati per nuovi ID API
- registrazione di provider OAuth personalizzati

## Ordine di risoluzione di autenticazione e chiavi API

Quando si richiede una chiave per un provider, l'ordine effettivo è:

1. Override a runtime (CLI `--api-key`)
2. Credenziale della chiave API memorizzata in `agent.db`
3. Credenziale OAuth memorizzata in `agent.db` (con refresh)
4. Mappatura della variabile d'ambiente (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, ecc.)
5. Risolutore di fallback del ModelRegistry (`apiKey` del provider da `models.yml`, semantica env-name-or-literal)

Comportamento di `apiKey` in `models.yml`:

- Il valore viene prima trattato come un nome di variabile d'ambiente.
- Se non esiste alcuna variabile d'ambiente, la stringa letterale viene utilizzata come token.

Se `authHeader: true` e la `apiKey` del provider è impostata, i modelli ottengono:

- L'iniezione dell'intestazione `Authorization: Bearer <resolved-key>`.

Provider senza chiave:

- I provider contrassegnati come `auth: none` sono considerati disponibili senza credenziali.
- `getApiKey*` restituisce `kNoAuth` per loro.

## Disponibilità dei modelli rispetto a tutti i modelli

- `getAll()` restituisce il registro dei modelli caricato (integrati + personalizzati uniti + rilevati).
- `getAvailable()` filtra i modelli che sono senza chiave o che hanno un'autenticazione risolvibile.

Quindi un modello può esistere nel registro ma non essere selezionabile finché l'autenticazione non è disponibile.

## Risoluzione dei modelli a runtime

### Analisi CLI e pattern

`model-resolver.ts` supporta:

- `provider/modelId` esatto
- ID di modello canonico esatto
- ID di modello esatto (provider dedotto)
- corrispondenza fuzzy/sottostringa
- pattern di ambito glob in `--models` (es. `openai/*`, `*sonnet*`)
- suffisso opzionale `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` è legacy; `--model` è preferito.

Precedenza di risoluzione per i selettori esatti:

1. `provider/modelId` esatto bypassa il coalescing
2. l'ID canonico esatto si risolve attraverso l'indice canonico
3. l'ID concreto nudo esatto funziona ancora
4. le corrispondenze fuzzy e glob vengono eseguite dopo i percorsi esatti

### Priorità di selezione iniziale del modello

`findInitialModel(...)` usa questo ordine:

1. provider+modello esplicito nella CLI
2. primo modello con ambito (se non si riprende l'esecuzione)
3. provider/modello predefinito salvato
4. predefiniti del provider noti (es. OpenAI/Anthropic/ecc.) tra i modelli disponibili
5. primo modello disponibile

### Alias e impostazioni di ruolo

Ruoli di modello supportati:

- `default`, `smol`, `slow`, `plan`, `commit`

Alias di ruolo come `pi/smol` si espandono attraverso `settings.modelRoles`. Ogni valore di ruolo può anche accodare un selettore di pensiero come `:minimal`, `:low`, `:medium` o `:high`.

Se un ruolo punta a un altro ruolo, il modello di destinazione eredita ancora normalmente e qualsiasi suffisso esplicito nel ruolo chiamante ha la precedenza per quell'uso specifico del ruolo.

Impostazioni correlate:

- `modelRoles` (record)
- `enabledModels` (elenco di pattern con ambito)
- `modelProviderOrder` (precedenza globale canonica-provider)
- `providers.kimiApiFormat` (formato di richiesta `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferenza websocket `auto|off|on` per il trasporto OpenAI Codex)

`modelRoles` può memorizzare:

- `provider/modelId` per fissare una variante di provider concreta
- un ID canonico come `gpt-5.3-codex` per consentire il coalescing dei provider

Per `enabledModels` e `--models` dalla CLI:

- gli ID canonici esatti si espandono a tutte le varianti concrete in quel gruppo canonico
- le voci esplicite `provider/modelId` rimangono esatte
- i glob e le corrispondenze fuzzy operano ancora sui modelli concreti

## `/model` e `--list-models`

Entrambe le interfacce mantengono i modelli con prefisso del provider visibili e selezionabili.

Ora espongono anche i modelli canonici/uniti:

- `/model` include una vista canonica accanto alle schede dei provider
- `--list-models` stampa una sezione canonica più le righe dei provider concreti

La selezione di una voce canonica memorizza il selettore canonico. La selezione di una riga di un provider memorizza esplicitamente `provider/modelId`.

## Promozione del contesto (catene di fallback a livello di modello)

La promozione del contesto è un meccanismo di recupero da overflow per varianti con contesto ridotto (ad esempio `*-spark`) che promuove automaticamente a un sibling con contesto più ampio quando l'API rifiuta una richiesta con un errore di lunghezza del contesto.

### Attivazione e ordine

Quando un turno fallisce con un errore di overflow del contesto (es. `context_length_exceeded`), `AgentSession` tenta la promozione **prima** di ricorrere alla compattazione:

1. Se `contextPromotion.enabled` è true, risolve una destinazione di promozione (vedi sotto).
2. Se viene trovata una destinazione, passa ad essa e riprova la richiesta — nessuna compattazione necessaria.
3. Se nessuna destinazione è disponibile, si ricorre all'auto-compattazione sul modello corrente.

### Selezione della destinazione

La selezione è guidata dal modello, non dal ruolo:

1. `currentModel.contextPromotionTarget` (se configurato)
2. il modello più piccolo con un contesto maggiore sullo stesso provider + API

I candidati vengono ignorati a meno che le credenziali non si risolvano (`ModelRegistry.getApiKey(...)`).

### Handoff websocket per OpenAI Codex

In caso di passaggio da/verso `openai-codex-responses`, la chiave di stato del provider di sessione `openai-codex-responses` viene chiusa prima del cambio di modello. Questo rilascia lo stato di trasporto websocket in modo che il turno successivo inizi pulito sul modello promosso.

### Comportamento di persistenza

La promozione utilizza un cambio temporaneo (`setModelTemporary`):

- registrato come `model_change` temporaneo nella cronologia della sessione
- non sovrascrive la mappatura del ruolo salvata

### Configurazione di catene di fallback esplicite

Configura il fallback direttamente nei metadati del modello tramite `contextPromotionTarget`.

`contextPromotionTarget` accetta in alternativa:

- `provider/model-id` (esplicito)
- `model-id` (risolto all'interno del provider corrente)

Esempio (`models.yml`) da Spark a non-Spark sullo stesso provider:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

Il generatore di modelli integrato assegna questo automaticamente per i modelli `*-spark` quando esiste un modello base per lo stesso provider.

## Campi di compatibilità e routing

`models.yml` supporta questo sottoinsieme per `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Questi vengono consumati dalla logica di trasporto OpenAI-completions e combinati con il rilevamento automatico basato su URL.

## Esempi pratici

### Endpoint locale compatibile con OpenAI (nessuna autenticazione)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (locale)
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

### Override della route del provider integrato + metadati del modello

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

## Configurazione automatica per proxy LiteLLM

Quando entrambe le variabili d'ambiente `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono impostate, xcsh gestisce automaticamente la configurazione di `models.yml` per il proxy LiteLLM.

### Auto-generazione al primo avvio

Se `models.yml` non esiste e vengono rilevate le variabili d'ambiente di LiteLLM, xcsh lo genera automaticamente:

```yaml
# Generato automaticamente da xcsh per proxy LiteLLM
# Chiave API risolta dalla variabile d'ambiente LITELLM_API_KEY a runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Viene generato anche un `config.yml` predefinito con impostazioni del provider di immagini sensate.

### Auto-riparazione all'avvio

A ogni avvio, `startupHealthCheck()` nel registro dei modelli esegue i seguenti controlli:

| Condizione | Azione |
|-----------|--------|
| `models.yml` mancante | Auto-generazione dalle variabili d'ambiente |
| `models.yml` corrotto o non analizzabile | Backup in `.bak`, rigenerazione |
| `baseUrl` non corrisponde a `LITELLM_BASE_URL` | Backup in `.bak`, rigenerazione con nuovo URL |
| `configVersion` mancante o obsoleto | Backup in `.bak`, rigenerazione con la versione corrente |
| Configurazione integra | Nessuna azione |

Tutte le riparazioni creano backup `.bak` prima di sovrascrivere. Tutte le operazioni sono idempotenti.

### Comando CLI

```bash
xcsh setup litellm              # Genera o corregge configurazione LiteLLM
xcsh setup litellm --check      # Convalida senza scrivere
xcsh setup litellm --check --json  # Output di convalida leggibile dalla macchina
```

### Variabili d'ambiente richieste

| Variabile | Scopo |
|----------|---------|
| `LITELLM_BASE_URL` | URL del proxy LiteLLM (es. `https://your-proxy.example.com`). Deve iniziare con `http://` o `https://`. |
| `LITELLM_API_KEY` | Chiave API per il proxy. Referenziata per nome nella configurazione generata, risolta a runtime. |

Se una delle due variabili non è impostata, l'auto-configurazione viene ignorata silenziosamente.

### Versionamento della configurazione

Le configurazioni generate includono un campo `configVersion`. Quando il formato generato cambia nelle versioni future, xcsh rileva le configurazioni obsolete e le aggiorna automaticamente (con backup).

## Avviso per consumatori legacy

La maggior parte della configurazione dei modelli ora fluisce attraverso `models.yml` tramite `ModelRegistry`.

Rimane un percorso legacy degno di nota: la risoluzione dell'autenticazione Anthropic per la ricerca web legge ancora direttamente `~/.xcsh/agent/models.json` in `src/web/search/auth.ts`.

Se fai affidamento su quel percorso specifico, tieni a mente la compatibilità JSON finché quel modulo non sarà migrato.

## Modalità di errore

Se `models.yml` fallisce i controlli di schema o validazione:

- Se `LITELLM_BASE_URL` e `LITELLM_API_KEY` sono impostate, il controllo di integrità all'avvio tenta l'auto-riparazione (backup del file corrotto, rigenerazione dalle variabili d'ambiente). Se la riparazione ha esito positivo, il registro ricarica la configurazione corretta.
- Se l'auto-riparazione non è possibile (variabili d'ambiente non impostate, errore di scrittura), il registro continua a operare con i modelli integrati.
- L'errore viene esposto tramite `ModelRegistry.getError()` ed emerso nell'interfaccia utente/notifiche.
