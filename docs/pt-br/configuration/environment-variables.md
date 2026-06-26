---
title: Variáveis de Ambiente
description: >-
  Referência de variáveis de ambiente de runtime para configuração e controle de
  comportamento do xcsh.
sidebar:
  order: 2
  label: Variáveis de ambiente
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Variáveis de Ambiente (Referência de Runtime Atual)

Esta referência é derivada dos caminhos de código atuais em:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (resolução de provedor/autenticação utilizada pelo coding-agent)
- `packages/utils/src/**` e `packages/tui/src/**` onde essas variáveis afetam diretamente o runtime do coding-agent

Documenta apenas o comportamento ativo.

## Modelo de resolução e precedência

A maioria das consultas em runtime utiliza `$env` de `@f5-sales-demo/pi-utils` (`packages/utils/src/env.ts`).

Ordem de carregamento do `$env`:

1. Ambiente de processo existente (`Bun.env`)
2. `.env` do projeto (`$PWD/.env`) para chaves ainda não definidas
3. `.env` do diretório home (`~/.env`) para chaves ainda não definidas

Regra adicional em arquivos `.env`: chaves `XCSH_*` são espelhadas para chaves `PI_*` durante o parse.

---

## 1) Autenticação de modelo/provedor

Estas são consumidas via `getEnvApiKey()` (`packages/ai/src/stream.ts`), salvo indicação contrária.

### Credenciais principais de provedor

| Variável                        | Usada para | Necessária quando                                             | Notas / precedência                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Autenticação na API Anthropic | Usando Anthropic com autenticação por token OAuth             | Tem precedência sobre `ANTHROPIC_API_KEY` na resolução de autenticação do provedor                   |
| `ANTHROPIC_API_KEY`             | Autenticação na API Anthropic | Usando Anthropic sem token OAuth                              | Fallback após `ANTHROPIC_OAUTH_TOKEN`                                                               |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic via Azure Foundry / gateway empresarial | `CLAUDE_CODE_USE_FOUNDRY` habilitado                          | Tem precedência sobre `ANTHROPIC_OAUTH_TOKEN` e `ANTHROPIC_API_KEY` quando o modo Foundry está habilitado |
| `OPENAI_API_KEY`                | Autenticação OpenAI | Usando provedores da família OpenAI sem argumento apiKey explícito | Usado pelos provedores OpenAI Completions/Responses                                                 |
| `GEMINI_API_KEY`                | Autenticação Google Gemini | Usando modelos do provedor `google`                           | Chave principal para mapeamento do provedor Gemini                                                  |
| `GOOGLE_API_KEY`                | Fallback de autenticação da ferramenta de imagem Gemini | Usando a ferramenta `gemini_image` sem `GEMINI_API_KEY`       | Usado pelo caminho de fallback da ferramenta de imagem do coding-agent                              |
| `GROQ_API_KEY`                  | Autenticação Groq | Usando modelos Groq                                           |                                                                                                     |
| `CEREBRAS_API_KEY`              | Autenticação Cerebras | Usando modelos Cerebras                                       |                                                                                                     |
| `TOGETHER_API_KEY`              | Autenticação Together | Usando provedor `together`                                    |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Autenticação Hugging Face | Usando provedor `huggingface`                                 | Variável de ambiente principal do token Hugging Face                                                |
| `HF_TOKEN`                      | Autenticação Hugging Face | Usando provedor `huggingface`                                 | Fallback quando `HUGGINGFACE_HUB_TOKEN` não está definido                                           |
| `SYNTHETIC_API_KEY`             | Autenticação Synthetic | Usando modelos Synthetic                                      |                                                                                                     |
| `NVIDIA_API_KEY`                | Autenticação NVIDIA | Usando provedor `nvidia`                                      |                                                                                                     |
| `NANO_GPT_API_KEY`              | Autenticação NanoGPT | Usando provedor `nanogpt`                                     |                                                                                                     |
| `VENICE_API_KEY`                | Autenticação Venice | Usando provedor `venice`                                      |                                                                                                     |
| `LITELLM_API_KEY`               | Autenticação LiteLLM | Usando provedor `litellm`                                     | Chave de proxy LiteLLM compatível com OpenAI. Quando definido com `LITELLM_BASE_URL`, habilita a auto-configuração do `models.yml` |
| `LM_STUDIO_API_KEY`             | Autenticação LM Studio (opcional) | Usando provedor `lm-studio` com hosts autenticados            | LM Studio local geralmente roda sem autenticação; qualquer token não vazio funciona quando uma chave é necessária |
| `OLLAMA_API_KEY`                | Autenticação Ollama (opcional) | Usando provedor `ollama` com hosts autenticados               | Ollama local geralmente roda sem autenticação; qualquer token não vazio funciona quando uma chave é necessária |
| `LLAMA_CPP_API_KEY`             | Autenticação Ollama (opcional) | Usando `llama-server` com parâmetro `--api-key`               | llama.cpp local geralmente roda sem autenticação; qualquer token não vazio funciona quando uma chave é configurada |
| `XIAOMI_API_KEY`                | Autenticação Xiaomi MiMo | Usando provedor `xiaomi`                                      |                                                                                                     |
| `MOONSHOT_API_KEY`              | Autenticação Moonshot | Usando provedor `moonshot`                                    |                                                                                                     |
| `XAI_API_KEY`                   | Autenticação xAI | Usando modelos xAI                                            |                                                                                                     |
| `OPENROUTER_API_KEY`            | Autenticação OpenRouter | Usando modelos OpenRouter                                     | Também usado pela ferramenta de imagem quando o provedor preferido/auto é OpenRouter                |
| `MISTRAL_API_KEY`               | Autenticação Mistral | Usando modelos Mistral                                        |                                                                                                     |
| `ZAI_API_KEY`                   | Autenticação z.ai | Usando modelos z.ai                                           | Também usado pelo provedor de busca web z.ai                                                        |
| `MINIMAX_API_KEY`               | Autenticação MiniMax | Usando provedor `minimax`                                     |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | Autenticação MiniMax Code | Usando provedor `minimax-code`                                |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | Autenticação MiniMax Code CN | Usando provedor `minimax-code-cn`                             |                                                                                                     |
| `OPENCODE_API_KEY`              | Autenticação OpenCode | Usando modelos OpenCode                                       |                                                                                                     |
| `QIANFAN_API_KEY`               | Autenticação Qianfan | Usando provedor `qianfan`                                     |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Autenticação Qwen Portal | Usando `qwen-portal` com token OAuth                          | Tem precedência sobre `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | Autenticação Qwen Portal | Usando `qwen-portal` com chave API                            | Fallback após `QWEN_OAUTH_TOKEN`                                                                    |
| `ZENMUX_API_KEY`                | Autenticação ZenMux | Usando provedor `zenmux`                                      | Usado para rotas compatíveis com OpenAI e Anthropic do ZenMux                                       |
| `VLLM_API_KEY`                  | Autenticação/descoberta opt-in do vLLM | Usando provedor `vllm` (servidores locais compatíveis com OpenAI) | Qualquer valor não vazio funciona para servidores locais sem autenticação                           |
| `CURSOR_ACCESS_TOKEN`           | Autenticação do provedor Cursor | Usando provedor Cursor                                        |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Autenticação Vercel AI Gateway | Usando provedor `vercel-ai-gateway`                           |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Autenticação Cloudflare AI Gateway | Usando provedor `cloudflare-ai-gateway`                       | A URL base deve ser configurada como `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### Cadeias de token GitHub/Copilot

| Variável | Usada para | Cadeia |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | Autenticação do provedor GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Fallback do Copilot; autenticação na API GitHub no web scraper | No web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Fallback do Copilot; autenticação na API GitHub no web scraper | No web scraper: verificado antes de `GH_TOKEN` |

---

## 2) Configuração de runtime específica por provedor

### Anthropic Foundry Gateway (Azure / proxy empresarial)

Quando `CLAUDE_CODE_USE_FOUNDRY` está habilitado, as requisições Anthropic mudam para o modo Foundry:

- A URL base é resolvida a partir de `FOUNDRY_BASE_URL` (o fallback permanece como a URL base padrão/do modelo se não definida).
- A resolução da chave API para o provedor `anthropic` torna-se:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` é interpretado como pares `chave: valor` separados por vírgula/nova linha e mesclados nos cabeçalhos da requisição.
- Material TLS de cliente/servidor pode ser injetado a partir de valores de ambiente:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Cada um aceita:
  - um caminho de sistema de arquivos para conteúdo PEM, ou
  - PEM inline (incluindo sequências `\n` escapadas).

| Variável | Tipo de valor | Comportamento |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | String tipo booleano (`1`, `true`, `yes`, `on`) | Habilita o modo Foundry para o provedor Anthropic |
| `FOUNDRY_BASE_URL` | String URL | URL base do endpoint Anthropic no modo Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | String de token | Usado para `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | String de lista de cabeçalhos | Cabeçalhos extras; formato `header-a: valor, header-b: valor` ou separados por nova linha |
| `NODE_EXTRA_CA_CERTS` | Caminho PEM ou PEM inline | Cadeia CA extra para validação de certificado do servidor |
| `CLAUDE_CODE_CLIENT_CERT` | Caminho PEM ou PEM inline | Certificado de cliente mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | Caminho PEM ou PEM inline | Chave privada do cliente mTLS (deve ser pareada com o certificado) |

### Amazon Bedrock

| Variável | Padrão / comportamento |
|---|---|
| `AWS_REGION` | Fonte principal de região |
| `AWS_DEFAULT_REGION` | Fallback se `AWS_REGION` não estiver definida |
| `AWS_PROFILE` | Habilita o caminho de autenticação por perfil nomeado |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Habilita o caminho de autenticação por chave IAM |
| `AWS_BEARER_TOKEN_BEDROCK` | Habilita o caminho de autenticação por bearer token |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Habilita o caminho de credencial de tarefa ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Habilita o caminho de autenticação por web identity |
| `AWS_BEDROCK_SKIP_AUTH` | Se `1`, injeta credenciais fictícias (cenários de proxy/sem autenticação) |
| `AWS_BEDROCK_FORCE_HTTP1` | Se `1`, força o handler de requisição Node HTTP/1 |

Fallback de região no código do provedor: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variável | Padrão / comportamento |
|---|---|
| `AZURE_OPENAI_API_KEY` | Obrigatória a menos que a chave API seja passada como opção |
| `AZURE_OPENAI_API_VERSION` | Padrão `v1` |
| `AZURE_OPENAI_BASE_URL` | Override direto da URL base |
| `AZURE_OPENAI_RESOURCE_NAME` | Usado para construir a URL base: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | String de mapeamento opcional: `modelId=deploymentName,model2=deployment2` |

Resolução da URL base: opção `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → opção/env resource name → `model.baseUrl`.

### Google Vertex AI

| Variável | Obrigatória? | Notas |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Sim (a menos que passada nas opções) | Fallback: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Fallback | Usada como fonte alternativa de ID do projeto |
| `GOOGLE_CLOUD_LOCATION` | Sim (a menos que passada nas opções) | Sem padrão no provedor |
| `GOOGLE_APPLICATION_CREDENTIALS` | Condicional | Se definida, o arquivo deve existir; caso contrário, o caminho de fallback ADC é verificado (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variável | Padrão / comportamento |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | Override principal do host OAuth |
| `KIMI_OAUTH_HOST` | Override de fallback do host OAuth |
| `KIMI_CODE_BASE_URL` | Substitui a URL base do endpoint de uso do Kimi (`usage/kimi.ts`) |

Cadeia do host OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Compatibilidade Antigravity/Gemini image

| Variável | Padrão / comportamento |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Substitui a tag de versão do user-agent Antigravity no provedor Gemini CLI |

### OpenAI Codex responses (controles de funcionalidade/debug)

| Variável | Comportamento |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` habilita logs de debug do provedor Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` habilita preferência de transporte websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` habilita caminho websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Override de inteiro positivo (padrão 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Override de inteiro não negativo (padrão 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Override de backoff base em inteiro positivo (padrão 500) |

### Debug do provedor Cursor

| Variável | Comportamento |
|---|---|
| `DEBUG_CURSOR` | Habilita logs de debug do provedor; `2`/`verbose` para trechos detalhados de payload |
| `DEBUG_CURSOR_LOG` | Caminho de arquivo opcional para saída de log de debug JSONL |

### Chave de compatibilidade de cache de prompt

| Variável | Comportamento |
|---|---|
| `PI_CACHE_RETENTION` | Se `long`, habilita retenção longa onde suportado (`anthropic`, `openai-responses`, resolução de retenção Bedrock) |

---

## 3) Subsistema de busca web

### Credenciais de provedor de busca

| Variável | Usada por |
|---|---|
| `EXA_API_KEY` | Provedor de busca Exa e ferramentas MCP Exa |
| `BRAVE_API_KEY` | Provedor de busca Brave |
| `PERPLEXITY_API_KEY` | Modo chave API do provedor de busca Perplexity |
| `TAVILY_API_KEY` | Provedor de busca Tavily |
| `ZAI_API_KEY` | Provedor de busca z.ai (também verifica OAuth armazenado em `agent.db`) |
| `OPENAI_API_KEY` / OAuth Codex no DB | Disponibilidade/autenticação do provedor de busca Codex |

### Cadeia de autenticação de busca web Anthropic

`packages/coding-agent/src/web/search/auth.ts` resolve credenciais de busca web Anthropic nesta ordem:

1. `ANTHROPIC_SEARCH_API_KEY` (+ opcional `ANTHROPIC_SEARCH_BASE_URL`)
2. Entrada de provedor em `models.json` com `api: "anthropic-messages"`
3. Credenciais OAuth Anthropic de `agent.db` (não deve expirar dentro do buffer de 5 minutos)
4. Fallback genérico de env Anthropic: chave do provedor (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + opcional `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` quando o modo Foundry está habilitado)

Variáveis relacionadas:

| Variável | Padrão / comportamento |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Chave de busca explícita de maior prioridade |
| `ANTHROPIC_SEARCH_BASE_URL` | Padrão `https://api.anthropic.com` quando omitida |
| `ANTHROPIC_SEARCH_MODEL` | Padrão `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | URL base de fallback genérica para o caminho de autenticação nível 4 |

### Flag de comportamento do fluxo OAuth Perplexity

| Variável | Comportamento |
|---|---|
| `PI_AUTH_NO_BORROW` | Se definida, desabilita o caminho de empréstimo de token de aplicativo nativo macOS no fluxo de login Perplexity |

---

## 4) Ferramentas Python e runtime de kernel

| Variável | Padrão / comportamento |
|---|---|
| `PI_PY` | Override do modo de ferramenta Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; valores inválidos são ignorados |
| `PI_PYTHON_SKIP_CHECK` | Se `1`, pula verificações de disponibilidade/aquecimento do kernel Python |
| `PI_PYTHON_GATEWAY_URL` | Se definida, usa gateway de kernel externo em vez do gateway compartilhado local |
| `PI_PYTHON_GATEWAY_TOKEN` | Token de autenticação opcional para gateway externo (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Se `1`, habilita caminho de rastreamento IPC de baixo nível no módulo de kernel |
| `VIRTUAL_ENV` | Caminho de venv de maior prioridade para resolução do runtime Python |

Comportamento condicional extra:

- Se `BUN_ENV=test` ou `NODE_ENV=test`, as verificações de disponibilidade do Python são tratadas como OK e o aquecimento é ignorado.
- A filtragem de ambiente Python nega chaves API comuns e permite variáveis base seguras + prefixos `LC_`, `XDG_`, `PI_`.

---

## 5) Toggles de comportamento do agente/runtime

| Variável                   | Padrão / comportamento                                                                       |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Override efêmero de model-role para `smol` (CLI `--smol` tem precedência)                    |
| `PI_SLOW_MODEL`            | Override efêmero de model-role para `slow` (CLI `--slow` tem precedência)                    |
| `PI_PLAN_MODEL`            | Override efêmero de model-role para `plan` (CLI `--plan` tem precedência)                    |
| `PI_NO_TITLE`              | Se definida (qualquer valor não vazio), desabilita a geração automática de título de sessão na primeira mensagem do usuário |
| `NULL_PROMPT`              | Se `true`, o construtor de prompt de sistema retorna string vazia                            |
| `PI_BLOCKED_AGENT`         | Bloqueia um tipo específico de subagente na ferramenta de tarefa                             |
| `PI_SUBPROCESS_CMD`        | Substitui o comando de spawn do subagente (bypass da resolução `xcsh` / `xcsh.cmd`)           |
| `PI_TASK_MAX_OUTPUT_BYTES` | Máximo de bytes de saída capturados por subagente (padrão `500000`)                          |
| `PI_TASK_MAX_OUTPUT_LINES` | Máximo de linhas de saída capturadas por subagente (padrão `5000`)                           |
| `PI_TIMING`                | Se `1`, habilita logs de instrumentação de timing de startup/ferramenta                      |
| `PI_DEBUG_STARTUP`         | Habilita prints de debug de estágio de startup para stderr em múltiplos caminhos de startup  |
| `PI_PACKAGE_DIR`           | Substitui a resolução do diretório base de assets do pacote (busca de caminhos de docs/exemplos/changelog) |
| `PI_DISABLE_LSPMUX`        | Se `1`, desabilita detecção/integração do lspmux e força o spawn direto do servidor LSP      |
| `LITELLM_BASE_URL`         | URL base do proxy LiteLLM. Quando definida com `LITELLM_API_KEY`, dispara a auto-geração do `models.yml` na primeira execução e auto-reparo em cada startup |
| `LM_STUDIO_BASE_URL`       | Override da URL base de descoberta implícita padrão do LM Studio (`http://127.0.0.1:1234/v1` se não definida) |
| `OLLAMA_BASE_URL`          | Override da URL base de descoberta implícita padrão do Ollama (`http://127.0.0.1:11434` se não definida) |
| `LLAMA_CPP_BASE_URL`       | Override da URL base de descoberta implícita padrão do Llama.cpp (`http://127.0.0.1:8080` se não definida) |
| `PI_EDIT_VARIANT`          | Se `hashline`, força o modo de exibição hashline read/grep quando a ferramenta de edição está disponível |
| `PI_NO_PTY`                | Se `1`, desabilita o caminho PTY interativo para a ferramenta bash                           |

`PI_NO_PTY` também é definida internamente quando o CLI `--no-pty` é usado.

---

## 6) Caminhos raiz de armazenamento e configuração

Estas são consumidas via `@f5-sales-demo/pi-utils/dirs` e afetam onde o coding-agent armazena dados.

| Variável | Padrão / comportamento |
|---|---|
| `PI_CONFIG_DIR` | Nome do diretório raiz de configuração sob o home (padrão `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Override completo para o diretório do agente (padrão `~/<PI_CONFIG_DIR ou .xcsh>/agent`) |
| `PWD` | Usado ao fazer correspondência do diretório de trabalho atual canônico em helpers de caminho |

---

## 7) Ambiente de execução de shell/ferramentas

(De `packages/utils/src/procmgr.ts` e integração da ferramenta bash do coding-agent.)

| Variável | Comportamento |
|---|---|
| `PI_BASH_NO_CI` | Suprime a injeção automática de `CI=true` no ambiente de shell gerado |
| `CLAUDE_BASH_NO_CI` | Alias legado de fallback para `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Destinada a desabilitar o modo de shell de login |
| `CLAUDE_BASH_NO_LOGIN` | Alias legado de fallback para `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Wrapper de prefixo de comando opcional |
| `CLAUDE_CODE_SHELL_PREFIX` | Alias legado de fallback para `PI_SHELL_PREFIX` |
| `VISUAL` | Comando de editor externo preferido |
| `EDITOR` | Comando de editor externo de fallback |

Nota da implementação atual: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` são lidas, mas a implementação atual de `getShellArgs()` retorna `['-l','-c']` em ambas as ramificações (efetivamente sem efeito hoje).

---

## 8) Detecção de UI/tema/sessão (env auto-detectado)

Estas são lidas como sinais de runtime; geralmente são definidas pelo terminal/SO em vez de configuradas manualmente.

| Variável | Usada para |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Detecção de capacidade de cor (modo de cor do tema) |
| `COLORFGBG` | Auto-detecção de fundo claro/escuro do terminal |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Identidade do terminal no prompt/contexto do sistema |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Detecção de desktop/gerenciador de janelas no prompt/contexto do sistema |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | IDs de breadcrumb de sessão estáveis por terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Diagnósticos de informações do sistema |
| `APPDATA`, `XDG_CONFIG_HOME` | Resolução de caminho de configuração do lspmux |
| `HOME` | Encurtamento de caminho na UI de comando MCP |

---

## 9) Flags de carregamento nativo/debug

| Variável | Comportamento |
|---|---|
| `PI_DEV` | Habilita diagnósticos verbosos de carregamento de addon nativo em `packages/natives` |

## 10) Flags de runtime da TUI (pacote compartilhado, afeta a UX do coding-agent)

| Variável | Comportamento |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` suprimem notificações de desktop |
| `PI_TUI_WRITE_LOG` | Se definida, registra escritas da TUI em arquivo |
| `PI_HARDWARE_CURSOR` | Se `1`, habilita modo de cursor de hardware |
| `PI_CLEAR_ON_SHRINK` | Se `1`, limpa linhas vazias quando o conteúdo encolhe |
| `PI_DEBUG_REDRAW` | Se `1`, habilita log de debug de redesenho |
| `PI_TUI_DEBUG` | Se `1`, habilita caminho de dump de debug profundo da TUI |

---

## 11) Controles de geração de commit

| Variável | Comportamento |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Se `true` (case-insensitive), força o caminho de geração de commit por fallback |
| `PI_COMMIT_NO_FALLBACK` | Se `true`, desabilita fallback quando o agente não retorna nenhuma proposta |
| `PI_COMMIT_MAP_REDUCE` | Se `false`, desabilita o caminho de análise de commit por map-reduce |
| `DEBUG` | Se definida, stack traces de erro do agente de commit são impressos |

---

## Variáveis sensíveis à segurança

Trate estas como segredos; não as registre em logs nem as commit:

- Chaves de provedor/API e credenciais OAuth/bearer (todas as `*_API_KEY`, `*_TOKEN`, tokens de acesso/refresh OAuth)
- Credenciais de nuvem (`AWS_*`, o caminho de `GOOGLE_APPLICATION_CREDENTIALS` pode expor material de conta de serviço)
- Variáveis de autenticação de busca/provedor (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, chaves de busca Anthropic)
- Material mTLS Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` quando aponta para bundles de CA privados)

O runtime Python também remove explicitamente muitas variáveis de chave comuns antes de gerar subprocessos de kernel (`packages/coding-agent/src/ipy/runtime.ts`).
