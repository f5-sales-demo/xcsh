---
title: Compactação e Resumos de Branch
description: >-
  Compactação da janela de contexto e geração de resumos de branch para sessões
  de longa duração.
sidebar:
  order: 5
  label: Compactação
i18n:
  sourceHash: dae425a900d8
  translator: machine
---

# Compactação e Resumos de Branch

Compactação e resumos de branch são os dois mecanismos que mantêm sessões longas utilizáveis sem perder o contexto de trabalho anterior.

- **Compactação** reescreve o histórico antigo em um resumo na branch atual.
- **Resumo de branch** captura o contexto de branches abandonadas durante a navegação com `/tree`.

Ambos são persistidos como entradas de sessão e convertidos de volta em mensagens de contexto do usuário ao reconstruir a entrada do LLM.

## Arquivos de implementação principais

- `src/session/compaction/compaction.ts`
- `src/session/compaction/branch-summarization.ts`
- `src/session/compaction/pruning.ts`
- `src/session/compaction/utils.ts`
- `src/session/session-manager.ts`
- `src/session/agent-session.ts`
- `src/session/messages.ts`
- `src/extensibility/hooks/types.ts`
- `src/config/settings-schema.ts`

## Modelo de entrada de sessão

Compactação e resumos de branch são entradas de sessão de primeira classe, não simples mensagens de assistente/usuário.

- `CompactionEntry`
  - `type: "compaction"`
  - `summary`, opcional `shortSummary`
  - `firstKeptEntryId` (fronteira da compactação)
  - `tokensBefore`
  - opcional `details`, `preserveData`, `fromExtension`
- `BranchSummaryEntry`
  - `type: "branch_summary"`
  - `fromId`, `summary`
  - opcional `details`, `fromExtension`

Quando o contexto é reconstruído (`buildSessionContext`):

1. A compactação mais recente no caminho ativo é convertida em uma mensagem `compactionSummary`.
2. As entradas mantidas de `firstKeptEntryId` até o ponto de compactação são reincluídas.
3. As entradas posteriores no caminho são adicionadas.
4. As entradas `branch_summary` são convertidas em mensagens `branchSummary`.
5. As entradas `custom_message` são convertidas em mensagens `custom`.

Esses papéis personalizados são então transformados em mensagens de usuário voltadas ao LLM em `convertToLlm()` usando os templates estáticos:

- `prompts/compaction/compaction-summary-context.md`
- `prompts/compaction/branch-summary-context.md`

## Pipeline de compactação

### Gatilhos

A compactação pode ser executada de três formas:

1. **Manual**: `/compact [instruções]` chama `AgentSession.compact(...)`.
2. **Recuperação automática de overflow**: após um erro do assistente que corresponde a overflow de contexto.
3. **Compactação automática por limiar**: após um turno bem-sucedido quando o contexto excede o limiar.

### Forma da compactação (visual)

```text
Antes da compactação:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

Após a compactação (nova entrada adicionada):

  entry:  0     1     2     3      4     5     6      7      8     9      10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬──────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool │ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴──────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 não enviado ao LLM                 enviado ao LLM
                                                         ↑
                                              começa em firstKeptEntryId

O que o LLM vê:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   de cmp          mensagens a partir de firstKeptEntryId
```

### Compactação por overflow-retry vs por limiar

Os dois caminhos automáticos são intencionalmente diferentes:

- **Compactação por overflow-retry**
  - Gatilho: erro do assistente no modelo atual é detectado como overflow de contexto.
  - A mensagem de erro do assistente que falhou é removida do estado ativo do agente antes da retentativa.
  - A compactação automática é executada com `reason: "overflow"` e `willRetry: true`.
  - Em caso de sucesso, o agente continua automaticamente (`agent.continue()`) após a compactação.

- **Compactação por limiar**
  - Gatilho: `contextTokens > contextWindow - compaction.reserveTokens`.
  - Executada com `reason: "threshold"` e `willRetry: false`.
  - Em caso de sucesso, se `compaction.autoContinue !== false`, injeta um prompt sintético:
    - `"Continue if you have next steps."`

### Poda pré-compactação

Antes das verificações de compactação, a poda de resultados de ferramentas pode ser executada (`pruneToolOutputs`).

Política de poda padrão:

- Proteger os `40_000` tokens mais recentes de saída de ferramentas.
- Exigir pelo menos `20_000` de economia total estimada.
- Nunca podar resultados de ferramentas de `skill` ou `read`.

Resultados de ferramentas podados são substituídos por:

- `[Output truncated - N tokens]`

Se a poda alterar entradas, o armazenamento da sessão é reescrito e o estado de mensagens do agente é atualizado antes das decisões de compactação.

### Lógica de fronteira e ponto de corte

`prepareCompaction()` considera apenas entradas desde a última entrada de compactação (se existir).

1. Encontrar o índice da compactação anterior.
2. Calcular `boundaryStart = prevCompactionIndex + 1`.
3. Adaptar `keepRecentTokens` usando a razão de uso medida quando disponível.
4. Executar `findCutPoint()` sobre a janela de fronteira.

Pontos de corte válidos incluem:

- entradas de mensagem com papéis: `user`, `assistant`, `bashExecution`, `hookMessage`, `branchSummary`, `compactionSummary`
- entradas `custom_message`
- entradas `branch_summary`

Regra rígida: nunca cortar em `toolResult`.

Se houver entradas de metadados não-mensagem imediatamente antes do ponto de corte (`model_change`, `thinking_level_change`, labels, etc.), elas são puxadas para a região mantida movendo o índice de corte para trás até que uma mensagem ou fronteira de compactação seja encontrada.

### Tratamento de turno dividido

Se o ponto de corte não estiver no início de um turno do usuário, a compactação o trata como um turno dividido.

A detecção de início de turno trata estes como fronteiras de turno do usuário:

- `message.role === "user"`
- `message.role === "bashExecution"`
- entrada `custom_message`
- entrada `branch_summary`

A compactação de turno dividido gera dois resumos:

1. Resumo do histórico (`messagesToSummarize`)
2. Resumo do prefixo do turno (`turnPrefixMessages`)

O resumo final armazenado é mesclado como:

```markdown
<history summary>

---

**Turn Context (split turn):**

<turn prefix summary>
```

### Geração de resumo

`compact(...)` constrói resumos a partir de texto de conversa serializado:

1. Converte mensagens via `convertToLlm()`.
2. Serializa com `serializeConversation()`.
3. Envolve em `<conversation>...</conversation>`.
4. Opcionalmente inclui `<previous-summary>...</previous-summary>`.
5. Opcionalmente injeta contexto de hook como lista `<additional-context>`.
6. Executa o prompt de sumarização com `SUMMARIZATION_SYSTEM_PROMPT`.

Seleção de prompt:

- primeira compactação: `compaction-summary.md`
- compactação iterativa com resumo anterior: `compaction-update-summary.md`
- segunda passagem de turno dividido: `compaction-turn-prefix.md`
- resumo curto para UI: `compaction-short-summary.md`

Modo de sumarização remota:

- Se `compaction.remoteEndpoint` estiver definido, a compactação faz POST com:
  - `{ systemPrompt, prompt }`
- Espera JSON contendo pelo menos `{ summary }`.

### Contexto de operações de arquivo nos resumos

A compactação rastreia a atividade cumulativa de arquivos usando chamadas de ferramenta do assistente:

- `read(path)` → conjunto de leitura
- `write(path)` → conjunto de modificação
- `edit(path)` → conjunto de modificação

Comportamento cumulativo:

- Inclui detalhes da compactação anterior somente quando a entrada anterior é gerada internamente (`fromExtension !== true`).
- Em turnos divididos, inclui também as operações de arquivo do prefixo do turno.
- `readFiles` exclui arquivos que também foram modificados.

O texto do resumo recebe tags de arquivo anexadas via template de prompt:

```xml
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>
```

### Persistência e recarga

Após a geração do resumo (ou resumo fornecido por hook), a sessão do agente:

1. Adiciona `CompactionEntry` com `appendCompaction(...)`.
2. Reconstrói o contexto via `buildSessionContext()`.
3. Substitui as mensagens ativas do agente pelo contexto reconstruído.
4. Emite o evento de hook `session_compact`.

## Pipeline de sumarização de branch

A sumarização de branch está vinculada à navegação em árvore, não ao overflow de tokens.

### Gatilho

Durante `navigateTree(...)`:

1. Calcula as entradas abandonadas da folha antiga até o ancestral comum usando `collectEntriesForBranchSummary(...)`.
2. Se o chamador solicitou resumo (`options.summarize`), gera o resumo antes de trocar a folha.
3. Se o resumo existir, anexa-o no alvo de navegação usando `branchWithSummary(...)`.

Operacionalmente, isso é comumente acionado pelo fluxo `/tree` quando `branchSummary.enabled` está habilitado.

### Forma da troca de branch (visual)

```text
Árvore antes da navegação:

         ┌─ B ─ C ─ D (folha antiga, sendo abandonada)
    A ───┤
         └─ E ─ F (alvo)

Ancestral comum: A
Entradas a resumir: B, C, D

Após navegação com resumo:

         ┌─ B ─ C ─ D ─ [resumo de B,C,D]
    A ───┤
         └─ E ─ F (nova folha)
```

### Preparação e orçamento de tokens

`generateBranchSummary(...)` calcula o orçamento como:

- `tokenBudget = model.contextWindow - branchSummary.reserveTokens`

`prepareBranchEntries(...)` então:

1. Primeira passagem: coleta operações de arquivo cumulativas de todas as entradas resumidas, incluindo detalhes anteriores de `branch_summary` gerados internamente.
2. Segunda passagem: percorre do mais recente ao mais antigo, adicionando mensagens até que o orçamento de tokens seja atingido.
3. Prefere preservar contexto recente.
4. Pode ainda incluir entradas de resumo grandes perto do limite do orçamento para continuidade.

Entradas de compactação são incluídas como mensagens (`compactionSummary`) durante a entrada da sumarização de branch.

### Geração e persistência do resumo

Sumarização de branch:

1. Converte e serializa as mensagens selecionadas.
2. Envolve em `<conversation>`.
3. Usa instruções personalizadas se fornecidas, caso contrário `branch-summary.md`.
4. Chama o modelo de sumarização com `SUMMARIZATION_SYSTEM_PROMPT`.
5. Prepende `branch-summary-preamble.md`.
6. Anexa tags de operação de arquivo.

O resultado é armazenado como `BranchSummaryEntry` com detalhes opcionais (`readFiles`, `modifiedFiles`).

## Pontos de extensão e hooks

### `session_before_compact`

Hook pré-compactação.

Pode:

- cancelar a compactação (`{ cancel: true }`)
- fornecer payload de compactação personalizado completo (`{ compaction: CompactionResult }`)

### `session.compacting`

Hook de personalização de prompt/contexto para compactação padrão.

Pode retornar:

- `prompt` (substituir o prompt base do resumo)
- `context` (linhas de contexto extra injetadas em `<additional-context>`)
- `preserveData` (armazenado na entrada de compactação)

### `session_compact`

Notificação pós-compactação com `compactionEntry` salva e flag `fromExtension`.

### `session_before_tree`

Executado na navegação em árvore antes da geração padrão de resumo de branch.

Pode:

- cancelar a navegação
- fornecer `{ summary: { summary, details } }` personalizado usado quando o usuário solicitou sumarização

### `session_tree`

Evento pós-navegação expondo nova/antiga folha e entrada de resumo opcional.

## Comportamento em tempo de execução e semântica de falha

- A compactação manual aborta a operação atual do agente primeiro.
- `abortCompaction()` cancela tanto os controladores de compactação manual quanto automática.
- A compactação automática emite eventos de sessão de início/fim para atualizações de UI/estado.
- A compactação automática pode tentar múltiplos modelos candidatos e retentar falhas transitórias.
- Erros de overflow são excluídos do caminho genérico de retentativa porque são tratados pela compactação.
- Se a compactação automática falhar:
  - o caminho de overflow emite `Context overflow recovery failed: ...`
  - o caminho de limiar emite `Auto-compaction failed: ...`
- A sumarização de branch pode ser cancelada via sinal de aborto (ex.: Escape), retornando resultado de navegação cancelado/abortado.

## Configurações e padrões

De `settings-schema.ts`:

- `compaction.enabled` = `true`
- `compaction.reserveTokens` = `16384`
- `compaction.keepRecentTokens` = `20000`
- `compaction.autoContinue` = `true`
- `compaction.remoteEndpoint` = `undefined`
- `branchSummary.enabled` = `false`
- `branchSummary.reserveTokens` = `16384`

Esses valores são consumidos em tempo de execução por `AgentSession` e pelos módulos de compactação/sumarização de branch.
