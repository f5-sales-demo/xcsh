---
title: Pipeline de Geração de Handoff
description: >-
  Pipeline de geração de handoff para criação de resumos de sessão portáteis
  para colaboração em equipe.
sidebar:
  order: 8
  label: Pipeline de handoff
i18n:
  sourceHash: 03666084b5ac
  translator: machine
---

# Pipeline de geração `/handoff`

Este documento descreve como o coding-agent implementa o `/handoff` atualmente: caminho de disparo, prompt de geração, captura de conclusão, troca de sessão e reinjeção de contexto.

## Escopo

Abrange:

- Despacho interativo do comando `/handoff`
- Ciclo de vida e transições de estado de `AgentSession.handoff()`
- Como a saída do handoff é capturada a partir da saída do assistente
- Como sessões antigas/novas persistem dados de handoff de maneira diferente
- Comportamento da UI para sucesso, cancelamento e falha

Não abrange:

- Internos genéricos de navegação em árvore/branch
- Comandos de sessão não relacionados a handoff (`/new`, `/fork`, `/resume`)

## Arquivos de implementação

- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../../packages/coding-agent/src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)

## Caminho de disparo

1. `/handoff` é declarado nos metadados de comandos slash embutidos (`slash-commands.ts`) com dica inline opcional: `[focus instructions]`.
2. No tratamento de entrada interativa (`InputController`), texto submetido correspondendo a `/handoff` ou `/handoff ...` é interceptado antes do envio normal do prompt.
3. O editor é limpo e `handleHandoffCommand(customInstructions?)` é chamado.
4. `CommandController.handleHandoffCommand` realiza uma verificação prévia usando as entradas atuais:
   - Conta entradas do `type === "message"`.
   - Se `< 2`, exibe aviso: `Nothing to hand off (no messages yet)` e retorna.

A mesma verificação de conteúdo mínimo existe novamente dentro de `AgentSession.handoff()` e lança uma exceção se violada. Isso duplica a segurança nas camadas de UI e sessão.

## Ciclo de vida de ponta a ponta

### 1) Iniciar geração do handoff

`AgentSession.handoff(customInstructions?)`:

- Lê as entradas do branch atual (`sessionManager.getBranch()`)
- Valida a contagem mínima de mensagens (`>= 2`)
- Cria `#handoffAbortController`
- Constrói um prompt fixo e inline solicitando um documento de handoff estruturado (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Adiciona `Additional focus: ...` se instruções personalizadas forem fornecidas

O prompt é enviado via:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` impede a expansão de slash/prompt-template neste payload de instrução interna.

### 2) Captura da conclusão

Antes de enviar o prompt, `handoff()` se inscreve nos eventos da sessão e aguarda `agent_end`.

No `agent_end`, extrai o texto do handoff do estado do agente escaneando de trás para frente em busca da mensagem mais recente do `assistant`, depois concatenando todos os blocos `content` onde `type === "text"` com `\n`.

Suposições importantes da extração:

- Apenas blocos de texto são utilizados; conteúdo não-texto é ignorado.
- Assume que a mensagem mais recente do assistente corresponde à geração do handoff.
- Não analisa seções markdown nem valida conformidade de formato.
- Se a saída do assistente não tiver blocos de texto, o handoff é tratado como ausente.

### 3) Verificações de cancelamento

`handoff()` retorna `undefined` quando qualquer uma das condições é verdadeira:

- nenhum texto de handoff capturado, ou
- `#handoffAbortController.signal.aborted` é verdadeiro

Sempre limpa `#handoffAbortController` no `finally`.

### 4) Criação de nova sessão

Se o texto foi capturado e não foi abortado:

1. Descarrega o writer da sessão atual (`sessionManager.flush()`)
2. Inicia uma sessão totalmente nova (`sessionManager.newSession()`)
3. Reseta o estado do agente em memória (`agent.reset()`)
4. Vincula novamente `agent.sessionId` ao id da nova sessão
5. Limpa os arrays de contexto enfileirados (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Reseta o contador de lembrete de tarefas

`newSession()` cria um cabeçalho novo e uma lista de entradas vazia (leaf resetado para `null`). No caminho de handoff, nenhum `parentSession` é passado.

### 5) Injeção de contexto do handoff

O documento de handoff gerado é encapsulado e adicionado à nova sessão como uma entrada `custom_message`:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Chamada de inserção:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semântica:

- `customType`: `"handoff"`
- `display`: `true` (visível na reconstrução da TUI)
- Tipo da entrada: `custom_message` (participa do contexto do LLM)

### 6) Reconstruir contexto ativo do agente

Após a injeção:

1. `sessionManager.buildSessionContext()` resolve a lista de mensagens para o leaf atual
2. `agent.replaceMessages(sessionContext.messages)` torna a mensagem de handoff injetada o contexto ativo
3. O método retorna `{ document: handoffText }`

Neste ponto, o contexto ativo do LLM na nova sessão contém a mensagem de handoff injetada, não a transcrição antiga.

## Modelo de persistência: sessão antiga vs nova sessão

### Sessão antiga

Durante a geração, a persistência normal de mensagens permanece ativa. A resposta de handoff do assistente é persistida como uma entrada regular `message` no `message_end`.

Resultado: a sessão original contém o handoff gerado visível como parte da transcrição histórica.

### Nova sessão

Após o reset da sessão, o handoff é persistido como `custom_message` com `customType: "handoff"`.

`buildSessionContext()` converte esta entrada em uma mensagem de contexto custom/user em tempo de execução via `createCustomMessage(...)`, de modo que ela é incluída em futuros prompts da nova sessão.

## Comportamento do Controller/UI

Comportamento de `CommandController.handleHandoffCommand`:

- Chama `await session.handoff(customInstructions)`
- Se o resultado for `undefined`: `showError("Handoff cancelled")`
- Em caso de sucesso:
  - `rebuildChatFromMessages()` (carrega o contexto da nova sessão, incluindo o handoff injetado)
  - invalida a linha de status e a borda superior do editor
  - recarrega as tarefas
  - adiciona linha de sucesso no chat: `New session started with handoff context`
- Em caso de exceção:
  - se a mensagem for `"Handoff cancelled"` ou o nome do erro for `AbortError`: `showError("Handoff cancelled")`
  - caso contrário: `showError("Handoff failed: <message>")`
- Solicita renderização ao final

## Semântica de cancelamento (comportamento atual)

### Primitiva de cancelamento no nível da sessão

`AgentSession` expõe:

- `abortHandoff()` → aborta `#handoffAbortController`
- `isGeneratingHandoff` → verdadeiro enquanto o controller existir

Quando este caminho de abort é utilizado, o subscriber do handoff rejeita com `Error("Handoff cancelled")`, e o command controller o mapeia para a UI de cancelamento.

### Limitação do caminho interativo `/handoff`

Na fiação atual do controller interativo, `/handoff` não instala um handler dedicado de Escape que chame `abortHandoff()` (diferentemente dos caminhos de compactação/resumo de branch que temporariamente sobrescrevem `editor.onEscape`).

Impacto prático:

- Há suporte a cancelamento no nível da sessão, mas nenhum hook de keybinding específico para handoff no caminho do comando `/handoff`.
- A interrupção pelo usuário ainda pode ocorrer através de caminhos mais amplos de abort do agente, mas esse não é o mesmo canal de cancelamento explícito utilizado por `abortHandoff()`.

## Handoff abortado vs falho

Classificação atual da UI:

- **Abortado/cancelado**
  - O caminho `abortHandoff()` dispara `"Handoff cancelled"`, ou
  - `AbortError` lançado
  - A UI exibe `Handoff cancelled`

- **Falho**
  - qualquer outro erro lançado por `handoff()` / pipeline de prompt (erros de validação de modelo/API, exceções em tempo de execução, etc.)
  - A UI exibe `Handoff failed: ...`

Nuance adicional: se a geração é concluída mas nenhum texto é extraído, `handoff()` retorna `undefined` e o controller atualmente reporta **cancelado**, não **falho**.

## Proteções de sessão curta e conteúdo mínimo

Duas proteções impedem handoffs com baixo sinal informacional:

- Camada de UI (`handleHandoffCommand`): avisa e retorna antecipadamente para `< 2` entradas de mensagem
- Camada de sessão (`handoff()`): lança a mesma condição como um erro

Isso evita criar uma nova sessão com contexto de handoff vazio/quase vazio.

## Resumo das transições de estado

Fluxo de estado de alto nível:

1. Comando slash interativo interceptado
2. Verificação prévia de contagem de mensagens
3. `#handoffAbortController` criado (`isGeneratingHandoff = true`)
4. Prompt interno de handoff submetido (visível no chat como geração normal do assistente)
5. No `agent_end`, último texto do assistente extraído
6. Se ausente/abortado → retorna `undefined` ou caminho de erro de cancelamento
7. Se presente:
   - descarrega sessão antiga
   - cria nova sessão vazia
   - reseta filas/contadores em tempo de execução
   - adiciona `custom_message(handoff)`
   - reconstrói e substitui mensagens ativas do agente
8. Controller reconstrói a UI do chat e anuncia sucesso
9. `#handoffAbortController` limpo (`isGeneratingHandoff = false`)

## Suposições e limitações conhecidas

- A extração do handoff é heurística: "últimos blocos de texto do assistente"; sem validação estrutural.
- Não há verificação rígida de que o markdown gerado segue o formato de seções solicitado.
- Texto extraído ausente é reportado como cancelamento na UX do controller.
- O fluxo interativo do `/handoff` atualmente não possui uma vinculação dedicada de Escape→`abortHandoff()`.
- Metadados de linhagem da nova sessão (`parentSession`) não são definidos por este caminho.
