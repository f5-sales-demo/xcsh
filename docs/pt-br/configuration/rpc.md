---
title: Referência do Protocolo RPC
description: >-
  Referência do protocolo JSON-RPC para comunicação entre processos dos
  componentes do xcsh.
sidebar:
  order: 5
  label: Protocolo RPC
i18n:
  sourceHash: b4a3ddaf08ab
  translator: machine
---

# Referência do Protocolo RPC

O modo RPC executa o agente de codificação como um protocolo JSON delimitado por nova linha sobre stdio.

- **stdin**: comandos (`RpcCommand`) e respostas de UI de extensão
- **stdout**: respostas de comandos (`RpcResponse`), eventos de sessão/agente, requisições de UI de extensão

Implementação principal:

- `src/modes/rpc/rpc-mode.ts`
- `src/modes/rpc/rpc-types.ts`
- `src/session/agent-session.ts`
- `packages/agent/src/agent.ts`
- `packages/agent/src/agent-loop.ts`

## Inicialização

```bash
xcsh --mode rpc [regular CLI options]
```

Notas de comportamento:

- Argumentos CLI com `@file` são rejeitados no modo RPC.
- O modo RPC desabilita a geração automática de título de sessão por padrão para evitar uma chamada extra ao modelo.
- O modo RPC redefine as configurações `todo.*`, `task.*` e `async.*` que alteram o fluxo de trabalho para seus padrões integrados em vez de herdar substituições do usuário.
- O processo lê stdin como JSONL (`readJsonl(Bun.stdin.stream())`).
- Quando o stdin é fechado, o processo encerra com código `0`.
- Respostas/eventos são escritos como um objeto JSON por linha.

## Transporte e Enquadramento

Cada frame é um único objeto JSON seguido por `\n`.

Não há envelope além da forma do próprio objeto.

### Categorias de frames de saída (stdout)

1. `RpcResponse` (`{ type: "response", ... }`)
2. Objetos `AgentSessionEvent` (`agent_start`, `message_update`, etc.)
3. `RpcExtensionUIRequest` (`{ type: "extension_ui_request", ... }`)
4. Erros de extensão (`{ type: "extension_error", extensionPath, event, error }`)

### Categorias de frames de entrada (stdin)

1. `RpcCommand`
2. `RpcExtensionUIResponse` (`{ type: "extension_ui_response", ... }`)

## Correlação de Requisição/Resposta

Todos os comandos aceitam `id?: string` opcional.

- Se fornecido, as respostas normais de comando ecoam o mesmo `id`.
- `RpcClient` depende disso para resolução de requisições pendentes.

Comportamento de borda importante do runtime:

- Respostas de comandos desconhecidos são emitidas com `id: undefined` (mesmo se a requisição tinha um `id`).
- Exceções de parse/handler no loop de entrada emitem `command: "parse"` com `id: undefined`.
- `prompt` e `abort_and_prompt` retornam sucesso imediato, e podem emitir uma resposta de erro posterior com o **mesmo** id se o agendamento assíncrono do prompt falhar.

## Schema de Comandos (canônico)

`RpcCommand` é definido em `src/modes/rpc/rpc-types.ts`:

### Prompting

- `{ id?, type: "prompt", message: string, images?: ImageContent[], streamingBehavior?: "steer" | "followUp" }`
- `{ id?, type: "steer", message: string, images?: ImageContent[] }`
- `{ id?, type: "follow_up", message: string, images?: ImageContent[] }`
- `{ id?, type: "abort" }`
- `{ id?, type: "abort_and_prompt", message: string, images?: ImageContent[] }`
- `{ id?, type: "new_session", parentSession?: string }`

### Estado

- `{ id?, type: "get_state" }`
- `{ id?, type: "set_todos", phases: TodoPhase[] }`
- `{ id?, type: "set_host_tools", tools: RpcHostToolDefinition[] }`

### Modelo

- `{ id?, type: "set_model", provider: string, modelId: string }`
- `{ id?, type: "cycle_model" }`
- `{ id?, type: "get_available_models" }`

### Raciocínio

- `{ id?, type: "set_thinking_level", level: ThinkingLevel }`
- `{ id?, type: "cycle_thinking_level" }`

### Modos de fila

- `{ id?, type: "set_steering_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_follow_up_mode", mode: "all" | "one-at-a-time" }`
- `{ id?, type: "set_interrupt_mode", mode: "immediate" | "wait" }`

### Compactação

- `{ id?, type: "compact", customInstructions?: string }`
- `{ id?, type: "set_auto_compaction", enabled: boolean }`

### Retentativa

- `{ id?, type: "set_auto_retry", enabled: boolean }`
- `{ id?, type: "abort_retry" }`

### Bash

- `{ id?, type: "bash", command: string }`
- `{ id?, type: "abort_bash" }`

### Sessão

- `{ id?, type: "get_session_stats" }`
- `{ id?, type: "export_html", outputPath?: string }`
- `{ id?, type: "switch_session", sessionPath: string }`
- `{ id?, type: "branch", entryId: string }`
- `{ id?, type: "get_branch_messages" }`
- `{ id?, type: "get_last_assistant_text" }`
- `{ id?, type: "set_session_name", name: string }`

### Mensagens

- `{ id?, type: "get_messages" }`

## Schema de Resposta

Todos os resultados de comandos usam `RpcResponse`:

- Sucesso: `{ id?, type: "response", command: <command>, success: true, data?: ... }`
- Falha: `{ id?, type: "response", command: string, success: false, error: string }`

Os payloads de dados são específicos por comando e definidos em `rpc-types.ts`.

### Payload de `get_state`

```json
{
  "model": { "provider": "...", "id": "..." },
  "thinkingLevel": "off|minimal|low|medium|high|xhigh",
  "isStreaming": false,
  "isCompacting": false,
  "steeringMode": "all|one-at-a-time",
  "followUpMode": "all|one-at-a-time",
  "interruptMode": "immediate|wait",
  "sessionFile": "...",
  "sessionId": "...",
  "sessionName": "...",
  "autoCompactionEnabled": true,
  "messageCount": 0,
  "queuedMessageCount": 0,
  "todoPhases": [
    {
      "id": "phase-1",
      "name": "Todos",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the tool surface",
          "status": "in_progress"
        }
      ]
    }
  ]
}
```

### Payload de `set_todos`

Substitui o estado de tarefas em memória para a sessão atual e retorna a lista de fases normalizada:

```json
{
  "id": "req_2",
  "type": "set_todos",
  "phases": [
    {
      "id": "phase-1",
      "name": "Evaluation",
      "tasks": [
        {
          "id": "task-1",
          "content": "Map the read tool surface",
          "status": "in_progress"
        },
        {
          "id": "task-2",
          "content": "Exercise edit operations",
          "status": "pending"
        }
      ]
    }
  ]
}
```

Isso é útil para hosts que desejam pré-popular um plano antes do primeiro prompt.

### Payload de `set_host_tools`

Substitui o conjunto atual de ferramentas pertencentes ao host que o servidor RPC pode chamar de volta via stdio:

```json
{
  "id": "req_3",
  "type": "set_host_tools",
  "tools": [
    {
      "name": "echo_host",
      "label": "Echo Host",
      "description": "Echo a value from the embedding host",
      "parameters": {
        "type": "object",
        "properties": {
          "message": { "type": "string" }
        },
        "required": ["message"],
        "additionalProperties": false
      }
    }
  ]
}
```

O payload de resposta é:

```json
{
  "toolNames": ["echo_host"]
}
```

Essas ferramentas são adicionadas ao registro de ferramentas da sessão ativa antes da próxima chamada ao modelo. Reenviar `set_host_tools` substitui o conjunto anterior pertencente ao host.

## Schema do Fluxo de Eventos

O modo RPC encaminha objetos `AgentSessionEvent` de `AgentSession.subscribe(...)`.

Tipos de eventos comuns:

- `agent_start`, `agent_end`
- `turn_start`, `turn_end`
- `message_start`, `message_update`, `message_end`
- `tool_execution_start`, `tool_execution_update`, `tool_execution_end`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`
- `todo_auto_clear`

Erros do executor de extensões são emitidos separadamente como:

```json
{ "type": "extension_error", "extensionPath": "...", "event": "...", "error": "..." }
```

`message_update` inclui deltas de streaming em `assistantMessageEvent` (deltas de texto/raciocínio/chamada de ferramenta).

## Concorrência e Ordenação de Prompt/Fila

Este é o comportamento operacional mais importante.

### Confirmação imediata vs conclusão

`prompt` e `abort_and_prompt` são **confirmados imediatamente**:

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
```

Isso significa:

- aceitação do comando != conclusão da execução
- a conclusão final é observada via `agent_end`

### Durante streaming

`AgentSession.prompt()` requer `streamingBehavior` durante streaming ativo:

- `"steer"` => mensagem de direcionamento enfileirada (caminho de interrupção)
- `"followUp"` => mensagem de acompanhamento enfileirada (caminho pós-turno)

Se omitido durante streaming, o prompt falha.

### Padrões da fila

Do schema de configurações do agente de codificação (`packages/coding-agent/src/config/settings-schema.ts`):

- `steeringMode`: `"one-at-a-time"`
- `followUpMode`: `"one-at-a-time"`
- `interruptMode`: `"wait"`

### Semântica dos modos

- `set_steering_mode` / `set_follow_up_mode`
  - `"one-at-a-time"`: desenfileira uma mensagem por turno
  - `"all"`: desenfileira toda a fila de uma vez
- `set_interrupt_mode`
  - `"immediate"`: a execução de ferramentas verifica o direcionamento entre chamadas de ferramenta; direcionamento pendente pode abortar chamadas de ferramenta restantes no turno
  - `"wait"`: adia o direcionamento até a conclusão do turno

## Sub-Protocolo de UI de Extensão

Extensões no modo RPC usam frames de requisição/resposta de UI.

### Requisição de saída

Métodos de `RpcExtensionUIRequest` (`type: "extension_ui_request"`):

- `select`, `confirm`, `input`, `editor`
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`

Nota de runtime:

- A geração automática de título de sessão é desabilitada no modo RPC, e requisições de UI `setTitle` também são suprimidas por padrão porque a maioria dos hosts não possui uma superfície significativa de título de terminal. Defina `PI_RPC_EMIT_TITLE=1` para reativar apenas o evento de UI.

Exemplo:

```json
{ "type": "extension_ui_request", "id": "123", "method": "confirm", "title": "Confirm", "message": "Continue?", "timeout": 30000 }
```

### Resposta de entrada

`RpcExtensionUIResponse` (`type: "extension_ui_response"`):

- `{ type: "extension_ui_response", id: string, value: string }`
- `{ type: "extension_ui_response", id: string, confirmed: boolean }`
- `{ type: "extension_ui_response", id: string, cancelled: true }`

Se um diálogo tem timeout, o modo RPC resolve para um valor padrão quando o timeout/abort é disparado.

## Sub-Protocolo de Ferramentas do Host

Hosts RPC podem expor ferramentas personalizadas ao agente enviando `set_host_tools`, e então servindo requisições de execução pelo mesmo transporte.

### Requisição de saída

Quando o agente deseja que o host execute uma dessas ferramentas, o modo RPC emite:

```json
{
  "type": "host_tool_call",
  "id": "host_1",
  "toolCallId": "toolu_123",
  "toolName": "echo_host",
  "arguments": { "message": "hello" }
}
```

Se a execução da ferramenta for abortada posteriormente, o modo RPC emite:

```json
{
  "type": "host_tool_cancel",
  "id": "host_cancel_1",
  "targetId": "host_1"
}
```

### Atualizações de entrada e conclusão

Hosts podem opcionalmente transmitir progresso:

```json
{
  "type": "host_tool_update",
  "id": "host_1",
  "partialResult": {
    "content": [{ "type": "text", "text": "working" }]
  }
}
```

A conclusão usa:

```json
{
  "type": "host_tool_result",
  "id": "host_1",
  "result": {
    "content": [{ "type": "text", "text": "done" }]
  }
}
```

Defina `isError: true` em `host_tool_result` para exibir o conteúdo retornado como um erro de ferramenta.

## Modelo de Erros e Recuperabilidade

### Falhas em nível de comando

Falhas são `success: false` com `error` como string.

```json
{ "id": "req_2", "type": "response", "command": "set_model", "success": false, "error": "Model not found: provider/model" }
```

### Expectativas de recuperabilidade

- A maioria das falhas de comando são recuperáveis; o processo permanece ativo.
- JSONL malformado / exceções no loop de parse emitem uma resposta de erro `parse` e continuam lendo linhas subsequentes.
- `set_session_name` vazio é rejeitado (`Session name cannot be empty`).
- Respostas de UI de extensão com `id` desconhecido são ignoradas.
- Condições de encerramento do processo são fechamento do stdin ou shutdown explícito acionado por extensão.

## Fluxos Compactos de Comandos

### 1) Prompt e streaming

stdin:

```json
{ "id": "req_1", "type": "prompt", "message": "Summarize this repo" }
```

Sequência stdout (típica):

```json
{ "id": "req_1", "type": "response", "command": "prompt", "success": true }
{ "type": "agent_start" }
{ "type": "message_update", "assistantMessageEvent": { "type": "text_delta", "delta": "..." }, "message": { "role": "assistant", "content": [] } }
{ "type": "agent_end", "messages": [] }
```

### 2) Prompt durante streaming com política de fila explícita

stdin:

```json
{ "id": "req_2", "type": "prompt", "message": "Also include risks", "streamingBehavior": "followUp" }
```

### 3) Inspecionar e ajustar comportamento da fila

stdin:

```json
{ "id": "q1", "type": "get_state" }
{ "id": "q2", "type": "set_steering_mode", "mode": "all" }
{ "id": "q3", "type": "set_interrupt_mode", "mode": "wait" }
```

### 4) Ida e volta de UI de extensão

stdout:

```json
{ "type": "extension_ui_request", "id": "ui_7", "method": "input", "title": "Branch name", "placeholder": "feature/..." }
```

stdin:

```json
{ "type": "extension_ui_response", "id": "ui_7", "value": "feature/rpc-host" }
```

## Notas sobre o helper `RpcClient`

`src/modes/rpc/rpc-client.ts` é um wrapper de conveniência, não a definição do protocolo.

Características atuais do helper:

- Inicia `bun <cliPath> --mode rpc`
- Correlaciona respostas por ids gerados `req_<n>`
- Despacha apenas tipos reconhecidos de `AgentEvent` para listeners
- Suporta ferramentas personalizadas pertencentes ao host via `setCustomTools()` e tratamento automático de `host_tool_call` / `host_tool_cancel`
- **Não** expõe métodos helper para todos os comandos do protocolo (por exemplo, `set_interrupt_mode` e `set_session_name` estão nos tipos do protocolo mas não são encapsulados como métodos dedicados)

Use frames brutos do protocolo se precisar de cobertura completa da superfície.
