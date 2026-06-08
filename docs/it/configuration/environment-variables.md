---
title: Variabili d'Ambiente
description: >-
  Riferimento delle variabili d'ambiente runtime per la configurazione e il
  controllo del comportamento di xcsh.
sidebar:
  order: 2
  label: Variabili d'ambiente
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Variabili d'Ambiente (Riferimento Runtime Corrente)

Questo riferimento è derivato dai percorsi di codice correnti in:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (risoluzione provider/autenticazione utilizzata da coding-agent)
- `packages/utils/src/**` e `packages/tui/src/**` dove tali variabili influenzano direttamente il runtime di coding-agent

Documenta solo il comportamento attivo.

## Modello di risoluzione e precedenza

La maggior parte delle ricerche runtime utilizza `$env` da `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`).

Ordine di caricamento di `$env`:

1. Ambiente di processo esistente (`Bun.env`)
2. `.env` del progetto (`$PWD/.env`) per le chiavi non già impostate
3. `.env` della home (`~/.env`) per le chiavi non già impostate

Regola aggiuntiva nei file `.env`: le chiavi `XCSH_*` vengono replicate nelle chiavi `PI_*` durante il parsing.

---

## 1) Autenticazione modello/provider

Queste vengono consumate tramite `getEnvApiKey()` (`packages/ai/src/stream.ts`) salvo diversa indicazione.

### Credenziali provider principali

| Variabile                       | Utilizzata per | Richiesta quando                                              | Note / precedenza                                                                                   |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Autenticazione API Anthropic | Si utilizza Anthropic con autenticazione token OAuth           | Ha precedenza su `ANTHROPIC_API_KEY` per la risoluzione dell'autenticazione provider                |
| `ANTHROPIC_API_KEY`             | Autenticazione API Anthropic | Si utilizza Anthropic senza token OAuth                       | Fallback dopo `ANTHROPIC_OAUTH_TOKEN`                                                               |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic tramite Azure Foundry / gateway enterprise | `CLAUDE_CODE_USE_FOUNDRY` abilitato                           | Ha precedenza su `ANTHROPIC_OAUTH_TOKEN` e `ANTHROPIC_API_KEY` quando la modalità Foundry è abilitata |
| `OPENAI_API_KEY`                | Autenticazione OpenAI | Si utilizzano provider della famiglia OpenAI senza argomento apiKey esplicito | Utilizzata dai provider OpenAI Completions/Responses                                                |
| `GEMINI_API_KEY`                | Autenticazione Google Gemini | Si utilizzano modelli del provider `google`                   | Chiave primaria per la mappatura del provider Gemini                                                |
| `GOOGLE_API_KEY`                | Fallback autenticazione tool immagini Gemini | Si utilizza il tool `gemini_image` senza `GEMINI_API_KEY`     | Utilizzata dal percorso fallback del tool immagini di coding-agent                                  |
| `GROQ_API_KEY`                  | Autenticazione Groq | Si utilizzano modelli Groq                                    |                                                                                                     |
| `CEREBRAS_API_KEY`              | Autenticazione Cerebras | Si utilizzano modelli Cerebras                                |                                                                                                     |
| `TOGETHER_API_KEY`              | Autenticazione Together | Si utilizza il provider `together`                            |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Autenticazione Hugging Face | Si utilizza il provider `huggingface`                         | Variabile d'ambiente token Hugging Face primaria                                                    |
| `HF_TOKEN`                      | Autenticazione Hugging Face | Si utilizza il provider `huggingface`                         | Fallback quando `HUGGINGFACE_HUB_TOKEN` non è impostato                                            |
| `SYNTHETIC_API_KEY`             | Autenticazione Synthetic | Si utilizzano modelli Synthetic                               |                                                                                                     |
| `NVIDIA_API_KEY`                | Autenticazione NVIDIA | Si utilizza il provider `nvidia`                              |                                                                                                     |
| `NANO_GPT_API_KEY`              | Autenticazione NanoGPT | Si utilizza il provider `nanogpt`                             |                                                                                                     |
| `VENICE_API_KEY`                | Autenticazione Venice | Si utilizza il provider `venice`                              |                                                                                                     |
| `LITELLM_API_KEY`               | Autenticazione LiteLLM | Si utilizza il provider `litellm`                             | Chiave proxy LiteLLM compatibile con OpenAI. Quando impostata con `LITELLM_BASE_URL`, abilita la configurazione automatica di `models.yml` |
| `LM_STUDIO_API_KEY`             | Autenticazione LM Studio (opzionale) | Si utilizza il provider `lm-studio` con host autenticati      | LM Studio locale solitamente funziona senza autenticazione; qualsiasi token non vuoto funziona quando è richiesta una chiave |
| `OLLAMA_API_KEY`                | Autenticazione Ollama (opzionale) | Si utilizza il provider `ollama` con host autenticati         | Ollama locale solitamente funziona senza autenticazione; qualsiasi token non vuoto funziona quando è richiesta una chiave |
| `LLAMA_CPP_API_KEY`             | Autenticazione Ollama (opzionale) | Si utilizza `llama-server` con il parametro `--api-key`       | llama.cpp locale solitamente funziona senza autenticazione; qualsiasi token non vuoto funziona quando è configurata una chiave |
| `XIAOMI_API_KEY`                | Autenticazione Xiaomi MiMo | Si utilizza il provider `xiaomi`                              |                                                                                                     |
| `MOONSHOT_API_KEY`              | Autenticazione Moonshot | Si utilizza il provider `moonshot`                            |                                                                                                     |
| `XAI_API_KEY`                   | Autenticazione xAI | Si utilizzano modelli xAI                                     |                                                                                                     |
| `OPENROUTER_API_KEY`            | Autenticazione OpenRouter | Si utilizzano modelli OpenRouter                              | Utilizzata anche dal tool immagini quando il provider preferito/auto è OpenRouter                   |
| `MISTRAL_API_KEY`               | Autenticazione Mistral | Si utilizzano modelli Mistral                                 |                                                                                                     |
| `ZAI_API_KEY`                   | Autenticazione z.ai | Si utilizzano modelli z.ai                                    | Utilizzata anche dal provider di ricerca web z.ai                                                   |
| `MINIMAX_API_KEY`               | Autenticazione MiniMax | Si utilizza il provider `minimax`                             |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | Autenticazione MiniMax Code | Si utilizza il provider `minimax-code`                        |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | Autenticazione MiniMax Code CN | Si utilizza il provider `minimax-code-cn`                     |                                                                                                     |
| `OPENCODE_API_KEY`              | Autenticazione OpenCode | Si utilizzano modelli OpenCode                                |                                                                                                     |
| `QIANFAN_API_KEY`               | Autenticazione Qianfan | Si utilizza il provider `qianfan`                             |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Autenticazione Qwen Portal | Si utilizza `qwen-portal` con token OAuth                     | Ha precedenza su `QWEN_PORTAL_API_KEY`                                                              |
| `QWEN_PORTAL_API_KEY`           | Autenticazione Qwen Portal | Si utilizza `qwen-portal` con chiave API                      | Fallback dopo `QWEN_OAUTH_TOKEN`                                                                    |
| `ZENMUX_API_KEY`                | Autenticazione ZenMux | Si utilizza il provider `zenmux`                              | Utilizzata per le rotte ZenMux compatibili con OpenAI e Anthropic                                   |
| `VLLM_API_KEY`                  | Autenticazione/scoperta vLLM opt-in | Si utilizza il provider `vllm` (server locali compatibili con OpenAI) | Qualsiasi valore non vuoto funziona per server locali senza autenticazione                          |
| `CURSOR_ACCESS_TOKEN`           | Autenticazione provider Cursor | Si utilizza il provider Cursor                                |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Autenticazione Vercel AI Gateway | Si utilizza il provider `vercel-ai-gateway`                   |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Autenticazione Cloudflare AI Gateway | Si utilizza il provider `cloudflare-ai-gateway`               | L'URL base deve essere configurato come `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### Catene di token GitHub/Copilot

| Variabile | Utilizzata per | Catena |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | Autenticazione provider GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Fallback Copilot; autenticazione API GitHub nel web scraper | Nel web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Fallback Copilot; autenticazione API GitHub nel web scraper | Nel web scraper: verificato prima di `GH_TOKEN` |

---

## 2) Configurazione runtime specifica per provider

### Anthropic Foundry Gateway (Azure / proxy enterprise)

Quando `CLAUDE_CODE_USE_FOUNDRY` è abilitato, le richieste Anthropic passano alla modalità Foundry:

- L'URL base viene risolto da `FOUNDRY_BASE_URL` (il fallback rimane l'URL base modello/default se non impostato).
- La risoluzione della chiave API per il provider `anthropic` diventa:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` viene analizzato come coppie `chiave: valore` separate da virgola/nuova riga e unito agli header della richiesta.
- Il materiale TLS client/server può essere iniettato dai valori d'ambiente:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Ciascuno accetta:
  - un percorso del filesystem al contenuto PEM, oppure
  - PEM inline (incluse le sequenze di escape `\n`).

| Variabile | Tipo di valore | Comportamento |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | Stringa di tipo booleano (`1`, `true`, `yes`, `on`) | Abilita la modalità Foundry per il provider Anthropic |
| `FOUNDRY_BASE_URL` | Stringa URL | URL base dell'endpoint Anthropic in modalità Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | Stringa token | Utilizzata per `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | Stringa lista header | Header aggiuntivi; formato `header-a: valore, header-b: valore` o separati da nuova riga |
| `NODE_EXTRA_CA_CERTS` | Percorso PEM o PEM inline | Catena CA aggiuntiva per la validazione del certificato server |
| `CLAUDE_CODE_CLIENT_CERT` | Percorso PEM o PEM inline | Certificato client mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | Percorso PEM o PEM inline | Chiave privata client mTLS (deve essere associata al certificato) |

### Amazon Bedrock

| Variabile | Default / comportamento |
|---|---|
| `AWS_REGION` | Sorgente primaria della regione |
| `AWS_DEFAULT_REGION` | Fallback se `AWS_REGION` non è impostato |
| `AWS_PROFILE` | Abilita il percorso di autenticazione con profilo nominato |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Abilita il percorso di autenticazione con chiave IAM |
| `AWS_BEARER_TOKEN_BEDROCK` | Abilita il percorso di autenticazione con bearer token |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Abilita il percorso di credenziali task ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Abilita il percorso di autenticazione web identity |
| `AWS_BEDROCK_SKIP_AUTH` | Se `1`, inietta credenziali fittizie (scenari proxy/senza autenticazione) |
| `AWS_BEDROCK_FORCE_HTTP1` | Se `1`, forza il gestore di richieste Node HTTP/1 |

Fallback della regione nel codice del provider: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variabile | Default / comportamento |
|---|---|
| `AZURE_OPENAI_API_KEY` | Richiesta a meno che la chiave API non sia passata come opzione |
| `AZURE_OPENAI_API_VERSION` | Default `v1` |
| `AZURE_OPENAI_BASE_URL` | Override diretto dell'URL base |
| `AZURE_OPENAI_RESOURCE_NAME` | Utilizzata per costruire l'URL base: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Stringa di mappatura opzionale: `modelId=deploymentName,model2=deployment2` |

Risoluzione URL base: opzione `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → opzione/env resource name → `model.baseUrl`.

### Google Vertex AI

| Variabile | Richiesta? | Note |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Sì (a meno che non sia passata nelle opzioni) | Fallback: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Fallback | Utilizzata come sorgente alternativa dell'ID progetto |
| `GOOGLE_CLOUD_LOCATION` | Sì (a meno che non sia passata nelle opzioni) | Nessun default nel provider |
| `GOOGLE_APPLICATION_CREDENTIALS` | Condizionale | Se impostata, il file deve esistere; altrimenti viene verificato il percorso fallback ADC (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variabile | Default / comportamento |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | Override primario dell'host OAuth |
| `KIMI_OAUTH_HOST` | Override fallback dell'host OAuth |
| `KIMI_CODE_BASE_URL` | Sovrascrive l'URL base dell'endpoint di utilizzo Kimi (`usage/kimi.ts`) |

Catena dell'host OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Compatibilità Antigravity/Gemini per immagini

| Variabile | Default / comportamento |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Sovrascrive il tag versione user-agent di Antigravity nel provider Gemini CLI |

### OpenAI Codex responses (controlli feature/debug)

| Variabile | Comportamento |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` abilita il logging debug del provider Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` abilita la preferenza di trasporto websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` abilita il percorso websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Override intero positivo (default 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Override intero non negativo (default 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Override base backoff intero positivo (default 500) |

### Debug provider Cursor

| Variabile | Comportamento |
|---|---|
| `DEBUG_CURSOR` | Abilita i log debug del provider; `2`/`verbose` per snippet dettagliati del payload |
| `DEBUG_CURSOR_LOG` | Percorso file opzionale per l'output del log debug JSONL |

### Switch di compatibilità prompt cache

| Variabile | Comportamento |
|---|---|
| `PI_CACHE_RETENTION` | Se `long`, abilita la ritenzione lunga dove supportato (`anthropic`, `openai-responses`, risoluzione ritenzione Bedrock) |

---

## 3) Sottosistema di ricerca web

### Credenziali provider di ricerca

| Variabile | Utilizzata da |
|---|---|
| `EXA_API_KEY` | Provider di ricerca Exa e tool MCP Exa |
| `BRAVE_API_KEY` | Provider di ricerca Brave |
| `PERPLEXITY_API_KEY` | Provider di ricerca Perplexity in modalità chiave API |
| `TAVILY_API_KEY` | Provider di ricerca Tavily |
| `ZAI_API_KEY` | Provider di ricerca z.ai (verifica anche l'OAuth memorizzato in `agent.db`) |
| `OPENAI_API_KEY` / Codex OAuth nel DB | Disponibilità/autenticazione del provider di ricerca Codex |

### Catena di autenticazione ricerca web Anthropic

`packages/coding-agent/src/web/search/auth.ts` risolve le credenziali di ricerca web Anthropic in questo ordine:

1. `ANTHROPIC_SEARCH_API_KEY` (+ opzionale `ANTHROPIC_SEARCH_BASE_URL`)
2. Voce provider `models.json` con `api: "anthropic-messages"`
3. Credenziali OAuth Anthropic da `agent.db` (non devono scadere entro un buffer di 5 minuti)
4. Fallback generico env Anthropic: chiave provider (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + opzionale `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` quando la modalità Foundry è abilitata)

Variabili correlate:

| Variabile | Default / comportamento |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Chiave di ricerca esplicita con la massima priorità |
| `ANTHROPIC_SEARCH_BASE_URL` | Default `https://api.anthropic.com` quando omesso |
| `ANTHROPIC_SEARCH_MODEL` | Default `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | URL base fallback generico per il percorso di autenticazione tier-4 |

### Flag di comportamento del flusso OAuth Perplexity

| Variabile | Comportamento |
|---|---|
| `PI_AUTH_NO_BORROW` | Se impostata, disabilita il percorso di prestito token dell'app nativa macOS nel flusso di login Perplexity |

---

## 4) Strumenti Python e runtime del kernel

| Variabile | Default / comportamento |
|---|---|
| `PI_PY` | Override della modalità tool Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; valori non validi ignorati |
| `PI_PYTHON_SKIP_CHECK` | Se `1`, salta i controlli di disponibilità/warm del kernel Python |
| `PI_PYTHON_GATEWAY_URL` | Se impostata, utilizza un gateway kernel esterno invece del gateway condiviso locale |
| `PI_PYTHON_GATEWAY_TOKEN` | Token di autenticazione opzionale per il gateway esterno (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Se `1`, abilita il percorso di trace IPC a basso livello nel modulo kernel |
| `VIRTUAL_ENV` | Percorso venv con la massima priorità per la risoluzione del runtime Python |

Comportamento condizionale aggiuntivo:

- Se `BUN_ENV=test` o `NODE_ENV=test`, i controlli di disponibilità Python sono considerati OK e il riscaldamento viene saltato.
- Il filtraggio dell'ambiente Python nega le chiavi API comuni e permette le variabili base sicure + i prefissi `LC_`, `XDG_`, `PI_`.

---

## 5) Toggle di comportamento dell'agente/runtime

| Variabile                  | Default / comportamento                                                                      |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Override temporaneo del ruolo modello per `smol` (il CLI `--smol` ha precedenza)             |
| `PI_SLOW_MODEL`            | Override temporaneo del ruolo modello per `slow` (il CLI `--slow` ha precedenza)             |
| `PI_PLAN_MODEL`            | Override temporaneo del ruolo modello per `plan` (il CLI `--plan` ha precedenza)             |
| `PI_NO_TITLE`              | Se impostata (qualsiasi valore non vuoto), disabilita la generazione automatica del titolo della sessione al primo messaggio dell'utente |
| `NULL_PROMPT`              | Se `true`, il costruttore del prompt di sistema restituisce una stringa vuota                 |
| `PI_BLOCKED_AGENT`         | Blocca un tipo specifico di sub-agente nel tool task                                         |
| `PI_SUBPROCESS_CMD`        | Sovrascrive il comando di spawn del sub-agente (bypass della risoluzione `xcsh` / `xcsh.cmd`)  |
| `PI_TASK_MAX_OUTPUT_BYTES` | Massimo byte di output catturato per sub-agente (default `500000`)                           |
| `PI_TASK_MAX_OUTPUT_LINES` | Massimo righe di output catturate per sub-agente (default `5000`)                            |
| `PI_TIMING`                | Se `1`, abilita i log di strumentazione timing per startup/tool                              |
| `PI_DEBUG_STARTUP`         | Abilita le stampe debug delle fasi di startup su stderr in molteplici percorsi di avvio      |
| `PI_PACKAGE_DIR`           | Sovrascrive la risoluzione della directory base degli asset del pacchetto (ricerca percorso docs/examples/changelog) |
| `PI_DISABLE_LSPMUX`        | Se `1`, disabilita il rilevamento/integrazione lspmux e forza lo spawn diretto del server LSP |
| `LITELLM_BASE_URL`         | URL base del proxy LiteLLM. Quando impostata con `LITELLM_API_KEY`, attiva la generazione automatica di `models.yml` alla prima esecuzione e l'auto-riparazione ad ogni avvio |
| `LM_STUDIO_BASE_URL`       | Override dell'URL base di scoperta implicita di LM Studio (default `http://127.0.0.1:1234/v1` se non impostato) |
| `OLLAMA_BASE_URL`          | Override dell'URL base di scoperta implicita di Ollama (default `http://127.0.0.1:11434` se non impostato) |
| `LLAMA_CPP_BASE_URL`       | Override dell'URL base di scoperta implicita di Llama.cpp (default `http://127.0.0.1:8080` se non impostato) |
| `PI_EDIT_VARIANT`          | Se `hashline`, forza la modalità di visualizzazione hashline read/grep quando il tool edit è disponibile |
| `PI_NO_PTY`                | Se `1`, disabilita il percorso PTY interattivo per il tool bash                              |

`PI_NO_PTY` viene impostata anche internamente quando si utilizza `--no-pty` nel CLI.

---

## 6) Percorsi root di storage e configurazione

Queste vengono consumate tramite `@f5xc-salesdemos/pi-utils/dirs` e influenzano dove coding-agent memorizza i dati.

| Variabile | Default / comportamento |
|---|---|
| `PI_CONFIG_DIR` | Nome directory radice di configurazione nella home (default `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Override completo per la directory dell'agente (default `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | Utilizzata per la corrispondenza della directory di lavoro corrente canonica negli helper di percorso |

---

## 7) Ambiente di esecuzione shell/tool

(Da `packages/utils/src/procmgr.ts` e integrazione del tool bash di coding-agent.)

| Variabile | Comportamento |
|---|---|
| `PI_BASH_NO_CI` | Sopprime l'iniezione automatica di `CI=true` nell'ambiente della shell generata |
| `CLAUDE_BASH_NO_CI` | Alias legacy di fallback per `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Destinata a disabilitare la modalità login shell |
| `CLAUDE_BASH_NO_LOGIN` | Alias legacy di fallback per `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Wrapper opzionale con prefisso di comando |
| `CLAUDE_CODE_SHELL_PREFIX` | Alias legacy di fallback per `PI_SHELL_PREFIX` |
| `VISUAL` | Comando preferito per editor esterno |
| `EDITOR` | Comando di fallback per editor esterno |

Nota sull'implementazione corrente: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` vengono lette, ma l'attuale `getShellArgs()` restituisce `['-l','-c']` in entrambi i rami (effettivamente senza effetto oggi).

---

## 8) Rilevamento UI/tema/sessione (env rilevato automaticamente)

Queste vengono lette come segnali runtime; sono solitamente impostate dal terminale/OS piuttosto che configurate manualmente.

| Variabile | Utilizzata per |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Rilevamento delle capacità di colore (modalità colore del tema) |
| `COLORFGBG` | Rilevamento automatico sfondo terminale chiaro/scuro |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Identità del terminale nel prompt/contesto di sistema |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Rilevamento desktop/window-manager nel prompt/contesto di sistema |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | ID breadcrumb stabili per sessione terminale |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Diagnostica informazioni di sistema |
| `APPDATA`, `XDG_CONFIG_HOME` | Risoluzione del percorso di configurazione lspmux |
| `HOME` | Abbreviazione dei percorsi nell'interfaccia comandi MCP |

---

## 9) Flag di caricamento nativo/debug

| Variabile | Comportamento |
|---|---|
| `PI_DEV` | Abilita la diagnostica verbose del caricamento addon nativi in `packages/natives` |

## 10) Flag runtime TUI (pacchetto condiviso, influenza la UX di coding-agent)

| Variabile | Comportamento |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` sopprimono le notifiche desktop |
| `PI_TUI_WRITE_LOG` | Se impostata, registra le scritture TUI su file |
| `PI_HARDWARE_CURSOR` | Se `1`, abilita la modalità cursore hardware |
| `PI_CLEAR_ON_SHRINK` | Se `1`, pulisce le righe vuote quando il contenuto si riduce |
| `PI_DEBUG_REDRAW` | Se `1`, abilita il logging debug del ridisegno |
| `PI_TUI_DEBUG` | Se `1`, abilita il percorso di dump debug approfondito della TUI |

---

## 11) Controlli di generazione commit

| Variabile | Comportamento |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Se `true` (case-insensitive), forza il percorso di generazione commit di fallback |
| `PI_COMMIT_NO_FALLBACK` | Se `true`, disabilita il fallback quando l'agente non restituisce alcuna proposta |
| `PI_COMMIT_MAP_REDUCE` | Se `false`, disabilita il percorso di analisi commit map-reduce |
| `DEBUG` | Se impostata, vengono stampati gli stack trace degli errori dell'agente commit |

---

## Variabili sensibili per la sicurezza

Trattare queste come segreti; non registrarle nei log né nel controllo versione:

- Chiavi provider/API e credenziali OAuth/bearer (tutte le `*_API_KEY`, `*_TOKEN`, token di accesso/aggiornamento OAuth)
- Credenziali cloud (`AWS_*`, il percorso `GOOGLE_APPLICATION_CREDENTIALS` può esporre materiale di account di servizio)
- Variabili di autenticazione ricerca/provider (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, chiavi di ricerca Anthropic)
- Materiale mTLS Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` quando punta a bundle CA privati)

Il runtime Python inoltre rimuove esplicitamente molte variabili chiave comuni prima di generare sottoprocessi del kernel (`packages/coding-agent/src/ipy/runtime.ts`).
