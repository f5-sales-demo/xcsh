---
title: Funcionamento interno do runtime TUI
description: >-
  Funcionamento interno do runtime de interface de terminal (TUI), cobrindo
  pipeline de renderização, tratamento de entrada e gerenciamento de estado.
sidebar:
  order: 2
  label: Funcionamento interno do runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Funcionamento interno do runtime TUI

Este documento mapeia o caminho de runtime (excluindo temas) desde a entrada no terminal até a saída renderizada no modo interativo. O foco está no comportamento em `packages/tui` e em sua integração com os controladores de `packages/coding-agent`.

## Camadas de runtime e responsabilidades

- **Motor de `packages/tui`**: ciclo de vida do terminal, normalização de stdin, roteamento de foco, agendamento de renderização, pintura diferencial, composição de overlays e posicionamento de cursor por hardware.
- **Modo interativo de `packages/coding-agent`**: constrói a árvore de componentes, vincula callbacks de editor e keymaps, reage a eventos de agente/sessão e traduz o estado do domínio (streaming, execução de ferramentas, tentativas repetidas, modo de plano) em componentes de UI.

Regra de fronteira: o motor TUI é agnóstico em relação a mensagens. Ele conhece apenas `Component.render(width)`, `handleInput(data)`, foco e overlays. A semântica do agente permanece nos controladores interativos.

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

## Inicialização e montagem da árvore de componentes

`InteractiveMode` constrói `TUI(new ProcessTerminal(), showHardwareCursor)` e cria contêineres persistentes:

- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `todoContainer`
- `statusLine`
- `editorContainer` (contém `CustomEditor`)

`init()` monta a árvore nessa ordem, foca o editor, registra os manipuladores de entrada via `InputController`, inicia o TUI e solicita uma renderização forçada.

Uma renderização forçada (`requestRender(true)`) redefine os caches de linhas anteriores e o controle de cursor antes de redesenhar.

## Ciclo de vida do terminal e normalização do stdin

`ProcessTerminal.start()`:

1. Ativa o modo raw e paste entre colchetes (bracketed paste).
2. Registra o manipulador de redimensionamento.
3. Cria um `StdinBuffer` para dividir fragmentos parciais de escape em sequências completas.
4. Consulta o suporte ao protocolo de teclado Kitty (`CSI ? u`) e, em seguida, ativa os flags do protocolo se suportado.
5. No Windows, tenta ativar a entrada VT via flags de modo `kernel32`.

Comportamento do `StdinBuffer`:

- Armazena em buffer sequências de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` somente quando uma sequência está completa ou é descarregada por timeout.
- Detecta paste entre colchetes e emite um evento `paste` com o texto colado bruto.

Isso evita que fragmentos parciais de escape sejam interpretados incorretamente como teclas normais.

## Roteamento de entrada e modelo de foco

Caminho de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalhes do roteamento:

1. O TUI executa primeiro os listeners de entrada registrados (`addInputListener`), permitindo comportamento de consumo/transformação.
2. O TUI trata o atalho global de depuração (`shift+ctrl+d`) antes do despacho para componentes.
3. Se o componente com foco pertence a um overlay que está oculto/invisível, o TUI reatribui o foco ao próximo overlay visível ou ao foco salvo antes do overlay.
4. Eventos de liberação de tecla são filtrados, a menos que o componente com foco defina `wantsKeyRelease = true`.
5. Após o despacho, o TUI agenda a renderização.

`setFocus()` também alterna `Focusable.focused`, que controla se os componentes emitem `CURSOR_MARKER` para o posicionamento do cursor por hardware.

## Divisão do tratamento de teclas: editor vs. controlador

`CustomEditor` intercepta primeiro as combinações de alta prioridade (escape, ctrl-c/d/z, ctrl-v, variantes de ctrl-p, ctrl-t, alt-up, teclas personalizadas de extensão) e delega o restante ao comportamento base do `Editor` (edição de texto, histórico, autocomplete, movimentação de cursor).

`InputController.setupKeyHandlers()` então vincula callbacks do editor a ações de modo:

- cancelamento / saída de modo com `Escape`
- encerramento com duplo `Ctrl+C` ou `Ctrl+D` com editor vazio
- suspensão/retomada com `Ctrl+Z`
- teclas de atalho para slash-command e seletor
- alternância de acompanhamento/desenfileiramento e expansão

Isso mantém a análise de teclas/mecânica do editor em `packages/tui` e a semântica de modo nos controladores do coding-agent.

## Loop de renderização e estratégia de diff

`TUI.requestRender()` é limitado por debounce a uma renderização por tick usando `process.nextTick`. Múltiplas mudanças de estado na mesma iteração são coalescidas.

Pipeline de `#doRender()`:

1. Renderiza a árvore de componentes raiz em `newLines`.
2. Compõe os overlays visíveis (se houver).
3. Extrai e remove o `CURSOR_MARKER` das linhas do viewport visível.
4. Acrescenta sufixos de reset de segmento para linhas que não são imagens.
5. Escolhe entre repintura total ou patch diferencial:
   - primeiro frame
   - mudança de largura
   - redução com `clearOnShrink` ativado e sem overlays
   - edições acima do viewport anterior
6. Para atualizações diferenciais, corrige apenas o intervalo de linhas alterado e limpa as linhas finais obsoletas quando necessário.
7. Reposiciona o cursor por hardware para suporte a IME.

As gravações de renderização utilizam o modo de saída sincronizada (`CSI ? 2026 h/l`) para reduzir cintilação/tearing.

## Restrições de segurança de renderização

Verificações de segurança críticas no `TUI`:

- Linhas renderizadas que não são imagens não devem exceder a largura do terminal; overflow lança exceção e grava diagnósticos de falha.
- A composição de overlays inclui truncamento defensivo e verificação de largura pós-composição.
- Mudanças de largura forçam um redesenho completo porque a semântica de quebra de linha muda.
- A posição do cursor é limitada antes da movimentação.

Essas restrições são aplicadas em tempo de execução, não apenas convenções.

## Tratamento de redimensionamento

Eventos de redimensionamento são orientados a eventos, de `ProcessTerminal` para `TUI.requestRender()`.

Efeitos:

- Qualquer mudança de largura aciona um redesenho completo.
- O rastreamento de viewport/topo (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos inválidos de cursor relativo quando o conteúdo ou o tamanho do terminal muda.
- A visibilidade de overlays pode depender das dimensões do terminal (`OverlayOptions.visible`); o foco é corrigido quando overlays ficam invisíveis após o redimensionamento.

## Streaming e atualizações incrementais de UI

`EventController` assina `AgentSessionEvent` e atualiza a UI de forma incremental:

- `agent_start`: inicia o loader em `statusContainer`.
- `message_start` de assistente: cria `streamingComponent` e o monta.
- `message_update`: atualiza o conteúdo do assistente em streaming; cria/atualiza componentes de execução de ferramentas conforme as chamadas de ferramentas aparecem.
- `tool_execution_update/end`: atualiza os componentes de resultado de ferramentas e o estado de conclusão.
- `message_end`: finaliza o stream do assistente, trata anotações de cancelamento/erro, marca os argumentos de ferramentas pendentes como completos em parada normal.
- `agent_end`: para os loaders, limpa o estado de stream transitório, executa a troca de modelo adiada e emite notificação de conclusão se estiver em segundo plano.

O agrupamento de ferramentas de leitura é intencionalmente stateful (`#lastReadGroup`) para coalescencer chamadas consecutivas de ferramentas de leitura em um único bloco visual até que ocorra uma quebra por ferramenta não-leitura.

## Orquestração de status e loader

Responsabilidade da faixa de status:

- `statusContainer` contém loaders transitórios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores persistentes de status/hooks/plano e gerencia as atualizações da borda superior do editor.

Comportamento do loader:

- `Loader` atualiza a cada 80ms via intervalo e solicita renderização a cada frame.
- Os manipuladores de Escape são temporariamente substituídos durante a compactação automática e a nova tentativa automática para cancelar essas operações.
- Nos caminhos de encerramento/cancelamento, os controladores restauram os manipuladores de Escape anteriores e param/limpam os componentes de loader.

## Transições de modo e execução em segundo plano

### Modos de entrada Bash/Python

Prefixos no texto de entrada alternam os flags de modo de borda do editor:

- `!` -> modo bash
- `$` (prefixo que não é template literal) -> modo python

Escape sai do modo inativo ao limpar o texto do editor e restaurar a cor da borda; quando a execução está ativa, o Escape cancela a tarefa em execução.

### Modo de plano

`InteractiveMode` rastreia flags de modo de plano, estado da linha de status, ferramentas ativas e troca de modelo. A entrada/saída atualiza as entradas de modo de sessão e o estado de status/UI, incluindo a troca de modelo adiada se o streaming estiver ativo.

### Suspensão/retomada (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra um manipulador `SIGCONT` de disparo único para reiniciar o TUI e forçar a renderização.
2. Para o TUI antes da suspensão.
3. Envia `SIGTSTP` ao grupo de processos.

### Modo de segundo plano (`/background` ou `/bg`)

`handleBackgroundCommand()`:

- Rejeita quando ocioso.
- Muda o contexto de UI de ferramentas para não interativo (`hasUI=false`), de modo que as ferramentas de UI interativas falhem rapidamente.
- Para loaders/linha de status e cancela a assinatura do manipulador de eventos em primeiro plano.
- Assina o manipulador de eventos em segundo plano (aguarda principalmente `agent_end`).
- Para o TUI e envia `SIGTSTP` (caminho de controle de jobs POSIX).

Em `agent_end` em segundo plano sem trabalho enfileirado, o controlador envia a notificação de conclusão e encerra.

## Caminhos de cancelamento

Entradas primárias de cancelamento:

- `Escape` durante loader de stream ativo: restaura as mensagens enfileiradas para o editor e cancela o agente.
- `Escape` durante execução bash/python: cancela o comando em execução.
- `Escape` durante compactação automática/nova tentativa: invoca métodos de cancelamento dedicados por meio de manipuladores de Escape temporários.
- `Ctrl+C` pressionado uma vez: limpa o editor; pressionado duas vezes em 500ms: encerramento.

O cancelamento é condicional ao estado; a mesma tecla pode significar cancelar, sair de modo, acionar o seletor ou não fazer nada, dependendo do estado em tempo de execução.

## Comportamento orientado a eventos vs. com throttle

Atualizações orientadas a eventos:

- Eventos de sessão do agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamento do terminal
- Observadores de tema/branch em `InteractiveMode`

Caminhos com throttle/debounce:

- A renderização do TUI é limitada por debounce por tick (coalescência de `requestRender`).
- A animação do loader é de intervalo fixo (80ms), com cada frame solicitando renderização.
- As atualizações de autocomplete do editor (dentro do `Editor`) usam timers de debounce, reduzindo o reprocessamento excessivo durante a digitação.

O runtime, portanto, combina transições de estado orientadas a eventos com uma cadência de renderização limitada para manter a interatividade responsiva sem tempestades de repintura.
