---
title: Internos do Runtime da TUI
description: >-
  Internos do runtime da interface de terminal cobrindo pipeline de
  renderização, tratamento de entrada e gerenciamento de estado.
sidebar:
  order: 2
  label: Internos do runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Internos do runtime da TUI

Este documento mapeia o caminho do runtime não relacionado a tema, desde a entrada do terminal até a saída renderizada no modo interativo. Ele foca no comportamento em `packages/tui` e sua integração com os controladores de `packages/coding-agent`.

## Camadas do runtime e responsabilidades

- **Engine `packages/tui`**: ciclo de vida do terminal, normalização de stdin, roteamento de foco, agendamento de renderização, pintura diferencial, composição de overlays, posicionamento do cursor de hardware.
- **Modo interativo `packages/coding-agent`**: constrói a árvore de componentes, vincula callbacks e keymaps do editor, reage a eventos do agente/sessão e traduz estado do domínio (streaming, execução de ferramentas, retentativas, modo de planejamento) em componentes de UI.

Regra de fronteira: o engine da TUI é agnóstico a mensagens. Ele conhece apenas `Component.render(width)`, `handleInput(data)`, foco e overlays. A semântica do agente permanece nos controladores interativos.

## Arquivos de implementação

- [`../src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`../src/modes/controllers/event-controller.ts`](../../packages/coding-agent/src/modes/controllers/event-controller.ts)
- [`../src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`../src/modes/components/custom-editor.ts`](../../packages/coding-agent/src/modes/components/custom-editor.ts)
- [`../../tui/src/tui.ts`](../../packages/tui/src/tui.ts)
- [`../../tui/src/terminal.ts`](../../packages/tui/src/terminal.ts)
- [`../../tui/src/editor-component.ts`](../../packages/tui/src/editor-component.ts)
- [`../../tui/src/stdin-buffer.ts`](../../packages/tui/src/stdin-buffer.ts)
- [`../../tui/src/components/loader.ts`](../../packages/tui/src/components/loader.ts)

## Boot e montagem da árvore de componentes

`InteractiveMode` constrói `TUI(new ProcessTerminal(), showHardwareCursor)` e cria contêineres persistentes:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contém `CustomEditor`)

`init()` conecta a árvore nessa ordem, foca o editor, registra handlers de entrada via `InputController`, inicia a TUI e solicita uma renderização forçada.

Uma renderização forçada (`requestRender(true)`) reseta caches de linhas anteriores e controle de cursor antes de repintar.

## Ciclo de vida do terminal e normalização de stdin

`ProcessTerminal.start()`:

1. Ativa modo raw e bracketed paste.
2. Anexa handler de redimensionamento.
3. Cria um `StdinBuffer` para dividir chunks parciais de escape em sequências completas.
4. Consulta suporte ao protocolo de teclado Kitty (`CSI ? u`), depois ativa flags do protocolo se suportado.
5. No Windows, tenta ativar entrada VT via flags de modo do `kernel32`.

Comportamento do `StdinBuffer`:

- Faz buffer de sequências de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` apenas quando uma sequência está completa ou quando o timeout expira.
- Detecta bracketed paste e emite um evento `paste` com o texto colado bruto.

Isso previne que chunks parciais de escape sejam mal interpretados como teclas normais.

## Roteamento de entrada e modelo de foco

Caminho da entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalhes do roteamento:

1. A TUI executa listeners de entrada registrados primeiro (`addInputListener`), permitindo comportamento de consumo/transformação.
2. A TUI trata o atalho global de debug (`shift+ctrl+d`) antes do despacho para componentes.
3. Se o componente focado pertence a um overlay que agora está oculto/invisível, a TUI reatribui o foco para o próximo overlay visível ou o foco pré-overlay salvo.
4. Eventos de liberação de tecla são filtrados a menos que o componente focado defina `wantsKeyRelease = true`.
5. Após o despacho, a TUI agenda renderização.

`setFocus()` também alterna `Focusable.focused`, que controla se os componentes emitem `CURSOR_MARKER` para posicionamento do cursor de hardware.

## Divisão do tratamento de teclas: editor vs controlador

`CustomEditor` intercepta combos de alta prioridade primeiro (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-up, teclas customizadas de extensão) e delega o restante para o comportamento base do `Editor` (edição de texto, histórico, autocomplete, movimentação de cursor).

`InputController.setupKeyHandlers()` então vincula callbacks do editor a ações do modo:

- cancelamento / saída de modos no `Escape`
- encerramento em duplo `Ctrl+C` ou `Ctrl+D` com editor vazio
- suspensão/retomada no `Ctrl+Z`
- slash-commands e atalhos de seleção
- toggles de follow-up/dequeue e toggles de expansão

Isso mantém o parsing de teclas/mecânica do editor em `packages/tui` e a semântica de modo nos controladores do coding-agent.

## Loop de renderização e estratégia de diffing

`TUI.requestRender()` é debounced para uma renderização por tick usando `process.nextTick`. Múltiplas mudanças de estado no mesmo turno são coalescidas.

Pipeline de `#doRender()`:

1. Renderiza a árvore de componentes raiz para `newLines`.
2. Compõe overlays visíveis (se houver).
3. Extrai e remove `CURSOR_MARKER` das linhas visíveis do viewport.
4. Adiciona sufixos de reset de segmento para linhas que não são imagem.
5. Escolhe repintura completa vs patch diferencial:
   - primeiro frame
   - mudança de largura
   - encolhimento com `clearOnShrink` ativado e sem overlays
   - edições acima do viewport anterior
6. Para atualizações diferenciais, aplica patch apenas no intervalo de linhas alteradas e limpa linhas residuais quando necessário.
7. Reposiciona o cursor de hardware para suporte a IME.

As escritas de renderização usam modo de saída sincronizada (`CSI ? 2026 h/l`) para reduzir cintilação/tearing.

## Restrições de segurança da renderização

Verificações críticas de segurança na TUI:

- Linhas renderizadas que não são imagem não devem exceder a largura do terminal; overflow lança exceção e escreve diagnósticos de crash.
- A composição de overlays inclui truncamento defensivo e verificação de largura pós-composição.
- Mudanças de largura forçam redesenho completo porque a semântica de quebra de linha muda.
- A posição do cursor é limitada antes da movimentação.

Essas restrições são enforcement em tempo de execução, não apenas convenções.

## Tratamento de redimensionamento

Eventos de redimensionamento são orientados a eventos do `ProcessTerminal` para `TUI.requestRender()`.

Efeitos:

- Qualquer mudança de largura dispara redesenho completo.
- Rastreamento de viewport/topo (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos relativos de cursor inválidos quando o conteúdo ou o tamanho do terminal muda.
- A visibilidade do overlay pode depender das dimensões do terminal (`OverlayOptions.visible`); o foco é corrigido quando overlays tornam-se não visíveis após redimensionamento.

## Streaming e atualizações incrementais de UI

`EventController` se inscreve em `AgentSessionEvent` e atualiza a UI incrementalmente:

- `agent_start`: inicia loader no `statusContainer`.
- `message_start` assistant: cria `streamingComponent` e o monta.
- `message_update`: atualiza conteúdo de streaming do assistente; cria/atualiza componentes de execução de ferramentas conforme chamadas de ferramentas aparecem.
- `tool_execution_update/end`: atualiza componentes de resultado de ferramenta e estado de conclusão.
- `message_end`: finaliza stream do assistente, trata anotações de aborto/erro, marca argumentos pendentes de ferramenta como completos em parada normal.
- `agent_end`: para loaders, limpa estado transiente de stream, aplica troca de modelo adiada, emite notificação de conclusão se em segundo plano.

O agrupamento de ferramentas de leitura é intencionalmente stateful (`#lastReadGroup`) para coalescer chamadas consecutivas de ferramentas de leitura em um bloco visual até que ocorra uma interrupção de não-leitura.

## Orquestração de status e loader

Responsabilidade da faixa de status:

- `statusContainer` contém loaders transientes (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores persistentes de status/hooks/planejamento e direciona atualizações da borda superior do editor.

Comportamento do loader:

- `Loader` atualiza a cada 80ms via intervalo e solicita renderização a cada frame.
- Handlers de escape são temporariamente sobrescritos durante auto-compactação e auto-retentativa para cancelar essas operações.
- Nos caminhos de fim/cancelamento, os controladores restauram handlers de escape anteriores e param/limpam componentes de loader.

## Transições de modo e execução em segundo plano

### Modos de entrada Bash/Python

Prefixos de texto de entrada alternam flags de modo da borda do editor:

- `!` -> modo bash
- `$` (prefixo que não é template literal) -> modo python

Escape sai do modo inativo limpando o texto do editor e restaurando a cor da borda; quando a execução está ativa, escape aborta a tarefa em execução.

### Modo de planejamento

`InteractiveMode` rastreia flags do modo de planejamento, estado da linha de status, ferramentas ativas e troca de modelo. Entrar/sair atualiza entradas de modo da sessão e estado de status/UI, incluindo troca de modelo adiada se streaming estiver ativo.

### Suspensão/retomada (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra handler `SIGCONT` de uso único para reiniciar a TUI e forçar renderização.
2. Para a TUI antes da suspensão.
3. Envia `SIGTSTP` para o grupo de processos.

### Modo de segundo plano (`/background` ou `/bg`)

`handleBackgroundCommand()`:

- Rejeita quando ocioso.
- Muda o contexto de UI de ferramentas para não-interativo (`hasUI=false`) para que ferramentas de UI interativa falhem rapidamente.
- Para loaders/linha de status e cancela inscrição do handler de evento de primeiro plano.
- Inscreve handler de evento de segundo plano (primariamente aguarda `agent_end`).
- Para a TUI e envia `SIGTSTP` (caminho de controle de jobs POSIX).

No `agent_end` em segundo plano sem trabalho enfileirado, o controlador envia notificação de conclusão e encerra.

## Caminhos de cancelamento

Entradas primárias de cancelamento:

- `Escape` durante loader de stream ativo: restaura mensagens enfileiradas para o editor e aborta o agente.
- `Escape` durante execução bash/python: aborta o comando em execução.
- `Escape` durante auto-compactação/retentativa: invoca métodos dedicados de aborto através de handlers de escape temporários.
- `Ctrl+C` pressão única: limpa editor; dupla pressão em 500ms: encerramento.

O cancelamento é condicional ao estado; a mesma tecla pode significar abortar, sair de modo, acionar seletor ou no-op dependendo do estado em tempo de execução.

## Comportamento orientado a eventos vs throttled

Atualizações orientadas a eventos:

- Eventos de sessão do agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamento do terminal
- Observadores de tema/branch no `InteractiveMode`

Caminhos throttled/debounced:

- A renderização da TUI é debounced por tick (coalescimento de `requestRender`).
- A animação do loader é de intervalo fixo (80ms), cada frame solicitando renderização.
- Atualizações de autocomplete do editor (dentro de `Editor`) usam timers de debounce, reduzindo recomputação excessiva durante digitação.

O runtime, portanto, mistura transições de estado orientadas a eventos com cadência de renderização limitada para manter a interatividade responsiva sem tempestades de repintura.
