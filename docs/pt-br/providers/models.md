---
title: Configuração de Modelos e Provedores
description: >-
  Registro de modelos e configuração de provedores via models.yml com
  roteamento, fallback e precificação.
sidebar:
  order: 1
  label: Modelos e provedores
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# Configuração de Modelos e Provedores (`models.yml`)

Este documento descreve como o coding-agent atualmente carrega modelos, aplica substituições, resolve credenciais e escolhe modelos em tempo de execução.

## O que controla o comportamento dos modelos

Arquivos de implementação principais:

- `src/config/model-registry.ts` — carrega modelos integrados + personalizados, substituições de provedores, descoberta em tempo de execução, integração de autenticação
- `src/config/model-resolver.ts` — analisa padrões de modelos e seleciona modelos initial/smol/slow
- `src/config/settings-schema.ts` — configurações relacionadas a modelos (`modelRoles`, preferências de transporte de provedores)
- `src/session/auth-storage.ts` — ordem de resolução de chave de API + OAuth
- `packages/ai/src/models.ts` e `packages/ai/src/types.ts` — provedores/modelos integrados e tipos `Model`/`compat`

## Localização do arquivo de configuração e comportamento legado

Caminho padrão de configuração:

- `~/.xcsh/agent/models.yml`

Comportamento legado ainda presente:

- Se `models.yml` estiver ausente e `models.json` existir no mesmo local, ele é migrado para `models.yml`.
- Caminhos de configuração explícitos `.json` / `.jsonc` ainda são suportados quando passados programaticamente para `ModelRegistry`.

## Estrutura do `models.yml`

```yaml
configVersion: 1  # opcional — escrito pela auto-configuração, usado para detecção de migração
providers:
  <provider-id>:
    # configuração a nível de provedor
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` é um inteiro opcional escrito pelo sistema de auto-configuração. Quando presente, o xcsh o utiliza para detectar configurações desatualizadas e atualizá-las automaticamente.

`provider-id` é a chave canônica do provedor usada em toda seleção e busca de autenticação.

`equivalence` é opcional e configura o agrupamento canônico de modelos sobre os modelos concretos do provedor:

- `overrides` mapeia um seletor concreto exato (`provider/modelId`) para um id canônico oficial upstream
- `exclude` remove um seletor concreto do agrupamento canônico

## Campos a nível de provedor

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

### Provedor personalizado completo (`models` não vazio)

Obrigatórios:

- `baseUrl`
- `apiKey` a menos que `auth: none`
- `api` a nível de provedor ou em cada modelo

### Provedor apenas de substituição (`models` ausente ou vazio)

Deve definir pelo menos um dos seguintes:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Descoberta

- `discovery` requer `api` a nível de provedor.

### Verificações de valores do modelo

- `id` obrigatório
- `contextWindow` e `maxTokens` devem ser positivos se fornecidos

## Ordem de mesclagem e substituição

Pipeline do ModelRegistry (ao atualizar):

1. Carregar provedores/modelos integrados de `@f5xc-salesdemos/pi-ai`.
2. Carregar configuração personalizada `models.yml`.
3. Aplicar substituições de provedor (`baseUrl`, `headers`) aos modelos integrados.
4. Aplicar `modelOverrides` (por provedor + id do modelo).
5. Mesclar `models` personalizados:
   - mesmo `provider + id` substitui o existente
   - caso contrário, adiciona ao final
6. Aplicar modelos descobertos em tempo de execução (atualmente Ollama e LM Studio), depois reaplicar substituições de modelo.

## Equivalência canônica de modelos e coalescência

O registro mantém cada modelo concreto de provedor e então constrói uma camada canônica acima deles.

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

Ordem de construção para agrupamento canônico:

1. substituição exata do usuário em `equivalence.overrides`
2. correspondências de id oficial empacotadas dos metadados do modelo integrado
3. normalização heurística conservadora para variantes de gateway/provedor
4. fallback para o próprio id do modelo concreto

As heurísticas atuais são intencionalmente restritas:

- prefixos upstream incorporados podem ser removidos quando presentes, por exemplo `anthropic/...` ou `openai/...`
- variantes de versão com pontos e hífens podem normalizar apenas quando mapeiam para um id oficial existente, por exemplo `4.6 -> 4-6`
- famílias ou versões ambíguas não são mescladas sem uma correspondência empacotada ou substituição explícita

### Comportamento de resolução canônica

Quando múltiplas variantes concretas compartilham um id canônico, a resolução usa:

1. disponibilidade e autenticação
2. `modelProviderOrder` do `config.yml`
3. ordem existente do registro/provedor se `modelProviderOrder` não estiver definido

Provedores desabilitados ou não autenticados são ignorados.

O estado da sessão e as transcrições continuam registrando o provedor/modelo concreto que realmente executou o turno.

Padrões do provedor vs substituições por modelo:

- `headers` do provedor são a base.
- `headers` do modelo substituem as chaves de cabeçalho do provedor.
- `modelOverrides` pode substituir metadados do modelo (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` é mesclado em profundidade para blocos de roteamento aninhados (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integração de descoberta em tempo de execução

### Descoberta implícita do Ollama

Se `ollama` não estiver configurado explicitamente, o registro adiciona um provedor descobrível implícito:

- provedor: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` ou `http://127.0.0.1:11434`
- modo de autenticação: sem chave (comportamento `auth: none`)

A descoberta em tempo de execução chama `GET /api/tags` no Ollama e sintetiza entradas de modelo com padrões locais.

### Descoberta implícita do llama.cpp

Se `llama.cpp` não estiver configurado explicitamente, o registro adiciona um provedor descobrível implícito:
Nota: está usando a API anthropic messages mais recente em vez de openai-completions.

- provedor: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` ou `http://127.0.0.1:8080`
- modo de autenticação: sem chave (comportamento `auth: none`)

A descoberta em tempo de execução chama `GET models` no llama.cpp e sintetiza entradas de modelo com padrões locais.

### Descoberta implícita do LM Studio

Se `lm-studio` não estiver configurado explicitamente, o registro adiciona um provedor descobrível implícito:

- provedor: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` ou `http://127.0.0.1:1234/v1`
- modo de autenticação: sem chave (comportamento `auth: none`)

A descoberta em tempo de execução busca modelos (`GET /models`) e sintetiza entradas de modelo com padrões locais.

### Descoberta explícita de provedor

Você pode configurar a descoberta manualmente:

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

### Registro de provedor por extensão

Extensões podem registrar provedores em tempo de execução (`pi.registerProvider(...)`), incluindo:

- substituição/adição de modelo para um provedor
- registro de handler de stream personalizado para novos IDs de API
- registro de provedor OAuth personalizado

## Ordem de resolução de autenticação e chave de API

Ao solicitar uma chave para um provedor, a ordem efetiva é:

1. Substituição em tempo de execução (CLI `--api-key`)
2. Credencial de chave de API armazenada em `agent.db`
3. Credencial OAuth armazenada em `agent.db` (com atualização)
4. Mapeamento de variável de ambiente (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Resolvedor de fallback do ModelRegistry (`apiKey` do provedor em `models.yml`, semântica de nome-de-env-ou-literal)

Comportamento de `apiKey` no `models.yml`:

- O valor é primeiro tratado como um nome de variável de ambiente.
- Se nenhuma variável de ambiente existir, a string literal é usada como token.

Se `authHeader: true` e `apiKey` do provedor estiver definido, os modelos recebem:

- Cabeçalho `Authorization: Bearer <chave-resolvida>` injetado.

Provedores sem chave:

- Provedores marcados com `auth: none` são tratados como disponíveis sem credenciais.
- `getApiKey*` retorna `kNoAuth` para eles.

## Disponibilidade de modelos vs todos os modelos

- `getAll()` retorna o registro de modelos carregado (integrados + personalizados mesclados + descobertos).
- `getAvailable()` filtra para modelos que não precisam de chave ou têm autenticação resolvível.

Portanto, um modelo pode existir no registro mas não ser selecionável até que a autenticação esteja disponível.

## Resolução de modelos em tempo de execução

### CLI e análise de padrões

`model-resolver.ts` suporta:

- `provider/modelId` exato
- id canônico de modelo exato
- id de modelo exato (provedor inferido)
- correspondência fuzzy/substring
- padrões de escopo glob em `--models` (ex.: `openai/*`, `*sonnet*`)
- sufixo opcional `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` é legado; `--model` é preferido.

Precedência de resolução para seletores exatos:

1. `provider/modelId` exato ignora coalescência
2. id canônico exato resolve através do índice canônico
3. id concreto bare exato ainda funciona
4. correspondência fuzzy e glob executa após os caminhos exatos

### Prioridade de seleção do modelo inicial

`findInitialModel(...)` usa esta ordem:

1. provedor+modelo explícito do CLI
2. primeiro modelo no escopo (se não estiver retomando)
3. provedor/modelo padrão salvo
4. padrões de provedor conhecidos (ex.: OpenAI/Anthropic/etc.) entre modelos disponíveis
5. primeiro modelo disponível

### Aliases de papel e configurações

Papéis de modelo suportados:

- `default`, `smol`, `slow`, `plan`, `commit`

Aliases de papel como `pi/smol` expandem através de `settings.modelRoles`. Cada valor de papel também pode adicionar um seletor de pensamento como `:minimal`, `:low`, `:medium` ou `:high`.

Se um papel aponta para outro papel, o modelo alvo ainda herda normalmente e qualquer sufixo explícito no papel referenciador prevalece para aquele uso específico do papel.

Configurações relacionadas:

- `modelRoles` (registro)
- `enabledModels` (lista de padrões com escopo)
- `modelProviderOrder` (precedência global de provedor canônico)
- `providers.kimiApiFormat` (formato de requisição `openai` ou `anthropic`)
- `providers.openaiWebsockets` (preferência de websocket `auto|off|on` para transporte OpenAI Codex)

`modelRoles` pode armazenar:

- `provider/modelId` para fixar uma variante concreta de provedor
- um id canônico como `gpt-5.3-codex` para permitir coalescência de provedores

Para `enabledModels` e CLI `--models`:

- ids canônicos exatos expandem para todas as variantes concretas naquele grupo canônico
- entradas explícitas `provider/modelId` permanecem exatas
- globs e correspondências fuzzy ainda operam em modelos concretos

## `/model` e `--list-models`

Ambas as interfaces mantêm modelos com prefixo de provedor visíveis e selecionáveis.

Agora também expõem modelos canônicos/coalescidos:

- `/model` inclui uma visualização canônica junto com abas de provedor
- `--list-models` imprime uma seção canônica mais as linhas de provedor concreto

Selecionar uma entrada canônica armazena o seletor canônico. Selecionar uma linha de provedor armazena o `provider/modelId` explícito.

## Promoção de contexto (cadeias de fallback a nível de modelo)

A promoção de contexto é um mecanismo de recuperação de estouro para variantes de contexto pequeno (por exemplo `*-spark`) que promove automaticamente para um modelo irmão de contexto maior quando a API rejeita uma requisição com erro de comprimento de contexto.

### Gatilho e ordem

Quando um turno falha com erro de estouro de contexto (ex.: `context_length_exceeded`), `AgentSession` tenta a promoção **antes** de recorrer à compactação:

1. Se `contextPromotion.enabled` for true, resolver um alvo de promoção (veja abaixo).
2. Se um alvo for encontrado, mudar para ele e tentar novamente a requisição — sem necessidade de compactação.
3. Se nenhum alvo estiver disponível, prosseguir para auto-compactação no modelo atual.

### Seleção do alvo

A seleção é orientada por modelo, não por papel:

1. `currentModel.contextPromotionTarget` (se configurado)
2. menor modelo de contexto maior no mesmo provedor + API

Candidatos são ignorados a menos que as credenciais sejam resolvidas (`ModelRegistry.getApiKey(...)`).

### Transferência de websocket OpenAI Codex

Se mudar de/para `openai-codex-responses`, a chave de estado do provedor de sessão `openai-codex-responses` é fechada antes da troca de modelo. Isso descarta o estado de transporte websocket para que o próximo turno comece limpo no modelo promovido.

### Comportamento de persistência

A promoção usa troca temporária (`setModelTemporary`):

- registrada como uma `model_change` temporária no histórico da sessão
- não reescreve o mapeamento de papel salvo

### Configurando cadeias de fallback explícitas

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

O gerador de modelo integrado também atribui isso automaticamente para modelos `*-spark` quando um modelo base do mesmo provedor existe.

## Campos de compatibilidade e roteamento

`models.yml` suporta este subconjunto de `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` ou `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Estes são consumidos pela lógica de transporte OpenAI-completions e combinados com auto-detecção baseada em URL.

## Exemplos práticos

### Endpoint local compatível com OpenAI (sem autenticação)

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

### Substituir rota de provedor integrado + metadados do modelo

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

Quando ambas as variáveis de ambiente `LITELLM_BASE_URL` e `LITELLM_API_KEY` estão definidas, o xcsh gerencia automaticamente a configuração do `models.yml` para o proxy LiteLLM.

### Geração automática na primeira execução

Se `models.yml` não existir e as variáveis de ambiente do LiteLLM forem detectadas, o xcsh o gera automaticamente:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

Um `config.yml` padrão também é gerado com configurações sensatas de provedor de imagem.

### Auto-correção na inicialização

Em cada inicialização, `startupHealthCheck()` no registro de modelos executa as seguintes verificações:

| Condição | Ação |
|----------|------|
| `models.yml` ausente | Auto-gerar a partir das variáveis de ambiente |
| `models.yml` corrompido ou não analisável | Backup para `.bak`, regenerar |
| `baseUrl` não corresponde a `LITELLM_BASE_URL` | Backup para `.bak`, regenerar com nova URL |
| `configVersion` ausente ou desatualizado | Backup para `.bak`, regenerar com versão atual |
| Configuração saudável | Nenhuma ação |

Todos os reparos criam backups `.bak` antes de sobrescrever. Todas as operações são idempotentes.

### Comando CLI

```bash
xcsh setup litellm              # Gerar ou corrigir configuração LiteLLM
xcsh setup litellm --check      # Validar sem escrever
xcsh setup litellm --check --json  # Saída de validação legível por máquina
```

### Variáveis de ambiente obrigatórias

| Variável | Propósito |
|----------|-----------|
| `LITELLM_BASE_URL` | URL do proxy LiteLLM (ex.: `https://your-proxy.example.com`). Deve começar com `http://` ou `https://`. |
| `LITELLM_API_KEY` | Chave de API para o proxy. Referenciada por nome na configuração gerada, resolvida em tempo de execução. |

Se qualquer variável não estiver definida, a auto-configuração é silenciosamente ignorada.

### Versionamento de configuração

Configurações geradas incluem um campo `configVersion`. Quando o formato gerado muda em versões futuras, o xcsh detecta configurações desatualizadas e as atualiza automaticamente (com backup).

## Ressalva sobre consumidor legado

A maioria das configurações de modelo agora flui através do `models.yml` via `ModelRegistry`.

Um caminho legado notável permanece: a resolução de autenticação Anthropic para busca web ainda lê `~/.xcsh/agent/models.json` diretamente em `src/web/search/auth.ts`.

Se você depende desse caminho específico, mantenha a compatibilidade JSON em mente até que esse módulo seja migrado.

## Modo de falha

Se `models.yml` falhar nas verificações de schema ou validação:

- Se `LITELLM_BASE_URL` e `LITELLM_API_KEY` estiverem definidos, a verificação de saúde na inicialização tenta auto-reparo (faz backup do arquivo corrompido, regenera a partir das variáveis de ambiente). Se o reparo for bem-sucedido, o registro recarrega a configuração corrigida.
- Se o auto-reparo não for possível (variáveis de ambiente não definidas, falha de escrita), o registro continua operando com modelos integrados.
- O erro é exposto via `ModelRegistry.getError()` e exibido na interface/notificações.
