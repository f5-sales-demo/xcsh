---
title: Configuração de Modelo e Provedor
description: Registro de modelo e configuração de provedor via models.yml com roteamento, fallback e preços.
sidebar:
  order: 1
  label: Modelos e provedores
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Configuração de Modelo e Provedor (`models.yml`)

Este documento descreve como o coding-agent atualmente carrega modelos, aplica substituições, resolve credenciais e escolhe modelos em tempo de execução.

## O que controla o comportamento do modelo

Arquivos de implementação principais:

- `src/config/model-registry.ts` — carrega modelos integrados + personalizados, substituições de provedor, descoberta em tempo de execução, integração de autenticação
- `src/config/model-resolver.ts` — analisa padrões de modelo e seleciona modelos iniciais/pequenos/lentos
- `src/config/settings-schema.ts` — configurações relacionadas a modelos (`modelRoles`, preferências de transporte do provedor)
- `src/session/auth-storage.ts` — ordem de resolução de chave de API + OAuth
- `packages/ai/src/models.ts` e `packages/ai/src/types.ts` — provedores/modelos integrados e tipos `Model`/`compat`

## Localização do arquivo de configuração e comportamento legado

Caminho de configuração padrão:

- `~/.xcsh/agent/models.yml`

Comportamento legado ainda presente:

- Se `models.yml` estiver ausente e `models.json` existir no mesmo local, ele é migrado para `models.yml`.
- Caminhos de configuração explícitos `.json` / `.jsonc` ainda são suportados quando passados programaticamente para `ModelRegistry`.

## Formato do `models.yml`

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

`configVersion` é um inteiro opcional escrito pelo sistema de auto-configuração. Quando presente, xcsh o usa para detectar configurações desatualizadas e atualizá-las automaticamente.

`provider-id` é a chave canônica do provedor usada em toda a seleção e busca de autenticação.

`equivalence` é opcional e configura o agrupamento de modelo canônico sobre os modelos de provedores concretos:

- `overrides` mapeia um seletor concreto exato (`provider/modelId`) para um id canônico upstream oficial
- `exclude` remove um seletor concreto do agrupamento canônico

## Campos no nível do provedor

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

### Valores permitidos de `api` para provedor/modelo

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valores permitidos de auth/discovery

- `auth`: `apiKey` (padrão) ou `none`
- `discovery.type`: `ollama`

## Regras de validação (atuais)

### Provedor personalizado completo (`models` não está vazio)

Obrigatório:

- `baseUrl`
- `apiKey` a menos que `auth: none`
- `api` no nível do provedor ou em cada modelo

### Provedor apenas com substituições (`models` ausente ou vazio)

Deve definir pelo menos um de:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Descoberta

- `discovery` requer `api` no nível do provedor.

### Verificações de valor do modelo

- `id` obrigatório
- `contextWindow` e `maxTokens` devem ser positivos, se fornecidos

## Ordem de mesclagem e substituição

Pipeline do ModelRegistry (na atualização):

1. Carrega provedores/modelos integrados de `@f5-sales-demo/pi-ai`.
2. Carrega configuração personalizada de `models.yml`.
3. Aplica substituições de provedor (`baseUrl`, `headers`) a modelos integrados.
4. Aplica `modelOverrides` (por provedor + id do modelo).
5. Mescla `models` personalizados:
   - o mesmo `provider + id` substitui o existente
   - caso contrário, acrescenta
6. Aplica modelos descobertos em tempo de execução (atualmente Ollama e LM Studio), em seguida, reaplica as substituições de modelo.

## Equivalência e coalescência de modelo canônico

O registro mantém cada modelo de provedor concreto e então constrói uma camada canônica acima deles.

Ids canônicos são apenas ids oficiais upstream, por exemplo:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configuração de equivalência no `models.yml`

Exemplo:

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

Ordem de compilação para agrupamento canônico:

1. substituição exata do usuário em `equivalence.overrides`
2. correspondências de id oficial incluídas dos metadados do modelo integrado
3. normalização heurística conservadora para variantes de gateway/provedor
4. fallback para o próprio id do modelo concreto

As heurísticas atuais são intencionalmente restritas:

- prefixos upstream incorporados podem ser removidos quando presentes, por exemplo `anthropic/...` ou `openai/...`
- variantes de versão pontilhadas e tracejadas só podem ser normalizadas quando mapeiam para um id oficial existente, por exemplo `4.6 -> 4-6`
- famílias ou versões ambíguas não são mescladas sem uma correspondência incluída ou substituição explícita

### Comportamento de resolução canônica

Quando múltiplas variantes concretas compartilham um id canônico, a resolução usa:

1. disponibilidade e autenticação
2. `modelProviderOrder` no `config.yml`
3. ordem de provedor/registro existente se `modelProviderOrder` não estiver definido

Provedores desabilitados ou não autenticados são ignorados.

O estado da sessão e as transcrições continuam a registrar o provedor/modelo concreto que realmente executou o turno.

Padrões de provedor versus substituições por modelo:

- `headers` de provedor são básicos.
- `headers` de modelo substituem as chaves de cabeçalho do provedor.
- `modelOverrides` pode substituir metadados do modelo (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` é mesclado profundamente (deep-merged) para blocos de roteamento aninhados (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integração de descoberta em tempo de execução

### Descoberta implícita do Ollama

Se `ollama` não for configurado explicitamente, o registro adiciona um provedor descoberto implicitamente:

- provedor: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` ou `http://127.0.0.1:11434`
- modo de autenticação: sem chave (comportamento de `auth: none`)

A descoberta em tempo de execução chama `GET /api/tags` no Ollama e sintetiza as entradas de modelo com padrões locais.

### Descoberta implícita do llama.cpp

Se `llama.cpp` não for configurado explicitamente, o registro adiciona um provedor descoberto implicitamente:
Nota: ele usa a api mais recente de mensagens do antropic em vez de openai-competions.

- provedor: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` ou `http://127.0.0.1:8080`
- modo de autenticação: sem chave (comportamento de `auth: none`)

A descoberta em tempo de execução chama `GET models` no llama.cpp e sintetiza as entradas de modelo com padrões locais.

### Descoberta implícita do LM Studio

Se `lm-studio` não for configurado explicitamente, o registro adiciona um provedor descoberto implicitamente:

- provedor: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` ou `http://127.0.0.1:1234/v1`
- modo de autenticação: sem chave (comportamento de `auth: none`)

A descoberta em tempo de execução busca modelos (`GET /models`) e sintetiza as entradas de modelo com padrões locais.

### Descoberta explícita de provedor

Você pode configurar a descoberta sozinho:

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

### Registro de provedor de extensão

Extensões podem registrar provedores em tempo de execução (`pi.registerProvider(...)`), incluindo:

- substituição/adição de modelo para um provedor
- registro de manipulador de stream personalizado para novos IDs de API
- registro de provedor OAuth personalizado

## Ordem de resolução de chave de API e autenticação

Ao solicitar uma chave para um provedor, a ordem efetiva é:

1. Substituição em tempo de execução (CLI `--api-key`)
2. Credencial de chave de API armazenada no `agent.db`
3. Credencial OAuth armazenada no `agent.db` (com atualização)
4. Mapeamento de variável de ambiente (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Resolvedor de fallback do ModelRegistry (`apiKey` de provedor do `models.yml`, nome-de-ambiente-ou-semântica-literal)

Comportamento do `apiKey` no `models.yml`:

- O valor é primeiro tratado como um nome de variável de ambiente.
- Se não houver variável de ambiente, a string literal é usada como o token.

Se `authHeader: true` e `apiKey` do provedor estiverem definidos, os modelos recebem:

- Injeção do cabeçalho `Authorization: Bearer <resolved-key>`.

Provedores sem chave:

- Provedores marcados com `auth: none` são tratados como disponíveis sem credenciais.
- `getApiKey*` retorna `kNoAuth` para eles.

## Disponibilidade do modelo versus todos os modelos

- `getAll()` retorna o registro de modelo carregado (integrados + personalizados mesclados + descobertos).
- `getAvailable()` filtra os modelos para aqueles sem chave ou com autenticação resolvida.

Portanto, um modelo pode existir no registro, mas não ser selecionável até que a autenticação esteja disponível.

## Resolução de modelo em tempo de execução

### CLI e análise de padrão

`model-resolver.ts` suporta:

- id exato `provider/modelId`
- id de modelo canônico exato
- id de modelo exato (provedor inferido)
- correspondência aproximada/substring
- padrões de escopo glob em `--models` (por exemplo, `openai/*`, `*sonnet*`)
- sufixo opcional `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` é legado; `--model` é preferível.

Precedência de resolução para seletores exatos:

1. `provider/modelId` exato ignora a coalescência
2. id canônico exato é resolvido pelo índice canônico
3. id concreto simples exato ainda funciona
4. correspondência aproximada e glob rodam após os caminhos exatos

### Prioridade inicial de seleção de modelo

`findInitialModel(...)` usa esta ordem:

1. provedor+modelo CLI explícito
2. primeiro modelo com escopo (se não estiver retomando)
3. modelo/provedor padrão salvo
4. padrões de provedores conhecidos (por exemplo, OpenAI/Anthropic/etc.) entre os modelos disponíveis
5. primeiro modelo disponível

### Aliases de função e configurações

Funções de modelo suportadas:

- `default`, `smol`, `slow`, `plan`, `commit`

Aliases de funções como `pi/smol` são expandidos pelo `settings.modelRoles`. Cada valor de função também pode anexar um seletor de pensamento, como `:minimal`, `:low`, `:medium` ou `:high`.

Se uma função aponta para outra função, o modelo alvo ainda herda normalmente e qualquer sufixo explícito na função referenciada vence para aquele uso específico da função.

Configurações relacionadas:

- `modelRoles` (registro)
- `enabledModels` (lista de padrão com escopo)
- `modelProviderOrder` (precedência global canônica-provedor)
- `providers.kimiApiFormat` (formato de requisição `openai` ou `anthropic`)
- `providers.openaiWebsockets` (preferência de websocket `auto|off|on` para transporte do OpenAI Codex)

`modelRoles` pode armazenar:

- `provider/modelId` para fixar uma variante de provedor concreta
- um id canônico como `gpt-5.3-codex` para permitir a coalescência de provedor

Para `enabledModels` e `--models` via CLI:

- ids canônicos exatos se expandem para todas as variantes concretas naquele grupo canônico
- entradas explícitas `provider/modelId` permanecem exatas
- as correspondências de globs e parciais ainda operam em modelos concretos

## `/model` e `--list-models`

Ambas as superfícies mantêm os modelos com prefixos de provedor visíveis e selecionáveis.

Eles agora também expõem modelos canônicos/coalescidos:

- `/model` inclui uma visão canônica ao lado das abas do provedor
- `--list-models` imprime uma seção canônica além das linhas concretas do provedor

Selecionar uma entrada canônica armazena o seletor canônico. Selecionar uma linha do provedor armazena o `provider/modelId` explícito.

## Promoção de contexto (cadeias de fallback de nível de modelo)

Promoção de contexto é um mecanismo de recuperação de transbordamento para variantes de contexto pequeno (por exemplo `*-spark`) que promove automaticamente para um irmão de contexto maior quando a API rejeita uma solicitação com erro de comprimento de contexto.

### Gatilho e ordem

Quando um turno falha com um erro de transbordamento de contexto (ex: `context_length_exceeded`), a `AgentSession` tenta a promoção **antes** de fazer fallback para a compactação:

1. Se `contextPromotion.enabled` for verdadeiro, resolva um alvo de promoção (veja abaixo).
2. Se um alvo for encontrado, mude para ele e tente a solicitação novamente — sem necessidade de compactação.
3. Se nenhum alvo estiver disponível, faça fallback para auto-compactação no modelo atual.

### Seleção do alvo

A seleção é orientada por modelo, não por função:

1. `currentModel.contextPromotionTarget` (se configurado)
2. menor modelo de maior contexto no mesmo provedor + API

Os candidatos são ignorados a menos que as credenciais sejam resolvidas (`ModelRegistry.getApiKey(...)`).

### Handoff do websocket OpenAI Codex

Se estiver mudando de/para `openai-codex-responses`, a chave de estado do provedor de sessão `openai-codex-responses` é fechada antes da mudança do modelo. Isso descarta o estado de transporte do websocket para que o próximo turno comece do zero no modelo promovido.

### Comportamento de persistência

A promoção usa mudança temporária (`setModelTemporary`):

- registrado como um `model_change` temporário no histórico da sessão
- não reescreve o mapeamento de função salvo

### Configurando cadeias explícitas de fallback

Configure o fallback diretamente nos metadados do modelo via `contextPromotionTarget`.

`contextPromotionTarget` aceita:

- `provider/model-id` (explícito)
- `model-id` (resolvido dentro do provedor atual)

Exemplo (`models.yml`) para Spark -> não-Spark no mesmo provedor:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

O gerador de modelo integrado também atribui isso automaticamente para modelos `*-spark` quando existe um modelo base do mesmo provedor.

## Campos de compatibilidade e roteamento

`models.yml` suporta este subconjunto de `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` ou `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Estes são consumidos pela lógica de transporte do OpenAI-completions e combinados com auto-detecção baseada em URL.

## Exemplos práticos

### Endpoint compatível com OpenAI local (sem autenticação)

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

### Proxy hospedado com chave baseada em variável de ambiente

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

### Substituir rota do provedor integrado + metadados do modelo

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

## Auto-configuração do proxy LiteLLM

Quando as variáveis de ambiente `LITELLM_BASE_URL` e `LITELLM_API_KEY` estiverem ambas definidas, o xcsh gerencia automaticamente a configuração do `models.yml` para o proxy LiteLLM.

### Geração automática na primeira execução

Se `models.yml` não existir e as variáveis de ambiente do LiteLLM forem detectadas, o xcsh o gerará automaticamente:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Um `config.yml` padrão também é gerado com configurações sensatas para provedores de imagem.

### Auto-reparo na inicialização

Em cada inicialização, `startupHealthCheck()` no registro do modelo executa as seguintes verificações:

| Condição | Ação |
|-----------|--------|
| `models.yml` ausente | Geração automática a partir de variáveis de ambiente |
| `models.yml` corrompido ou inanalisável | Fazer backup como `.bak`, regenerar |
| `baseUrl` não corresponde a `LITELLM_BASE_URL` | Fazer backup como `.bak`, regenerar com a nova URL |
| `configVersion` ausente ou desatualizado | Fazer backup como `.bak`, regenerar com a versão atual |
| Configuração é saudável | Nenhuma ação |

Todos os reparos criam backups `.bak` antes da sobrescrita. Todas as operações são idempotentes.

### Comando de CLI

```bash
xcsh setup litellm              # Gerar ou consertar configuração do LiteLLM
xcsh setup litellm --check      # Validar sem escrever
xcsh setup litellm --check --json  # Saída de validação legível por máquina
```

### Variáveis de ambiente obrigatórias

| Variável | Propósito |
|----------|---------|
| `LITELLM_BASE_URL` | URL do proxy LiteLLM (ex: `https://your-proxy.example.com`). Deve começar com `http://` ou `https://`. |
| `LITELLM_API_KEY` | Chave de API para o proxy. Referenciada por nome na configuração gerada, resolvida em tempo de execução. |

Se qualquer uma das variáveis estiver indefinida, a auto-configuração será ignorada silenciosamente.

### Versionamento de configuração

As configurações geradas incluem o campo `configVersion`. Quando o formato gerado mudar em versões futuras, o xcsh detectará configurações desatualizadas e as atualizará automaticamente (com backup).

### Advertência de consumidor legado

A maioria da configuração do modelo agora flui pelo `models.yml` via `ModelRegistry`.

Resta um caminho de legado notável: a resolução de autenticação de pesquisa na web da Anthropic ainda lê `~/.xcsh/agent/models.json` diretamente no `src/web/search/auth.ts`.

Se você depende desse caminho específico, tenha em mente a compatibilidade com JSON até que esse módulo seja migrado.

## Modo de falha

Se `models.yml` falhar no esquema ou nas validações:

- Se `LITELLM_BASE_URL` e `LITELLM_API_KEY` estiverem definidos, a verificação de integridade da inicialização tentará auto-reparo (fazer backup de arquivo corrompido, regenerar a partir de variáveis de ambiente). Se o reparo for bem-sucedido, o registro recarregará a configuração consertada.
- Se o auto-reparo não for possível (variáveis de ambiente indefinidas, falha de gravação), o registro continua operando com modelos integrados.
- O erro é exposto via `ModelRegistry.getError()` e aparece na IU/notificações.
