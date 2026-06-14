---
title: Internos do Runtime TUI
description: >-
  Internos do runtime de interface de terminal (TUI) cobrindo pipeline de
  renderização, tratamento de entrada e gerenciamento de estado.
sidebar:
  order: 2
  label: Internos do runtime
i18n:
  sourceHash: cc8f7dcce46a
  translator: machine
---

# Internos do runtime TUI

Este documento mapeia o caminho de runtime sem tema, desde a entrada do terminal até a saída renderizada no modo interativo. O foco está no comportamento em `packages/tui` e em sua integração a partir dos controladores de `packages/coding-agent`.

## Camadas de runtime e responsabilidades

- **Engine `packages/tui`**: ciclo de vida do terminal, normalização de stdin, roteamento de foco, agendamento de renderização, pintura diferencial, composição de sobreposições, posicionamento do cursor de hardware.
- **Modo interativo `packages/coding-agent`**: constrói a árvore de componentes, vincula callbacks do editor e mapeamentos de teclas, reage a eventos do agente/sessão e traduz o estado do domínio (streaming, execução de ferramentas, retentativas, modo de plano) em componentes de UI.

Regra de fronteira: o engine TUI é agnóstico a mensagens. Ele conhece apenas `Component.render(width)`, `handleInput(data)`, foco e sobreposições. A semântica do agente permanece nos controladores interativos.

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

`init()` conecta a árvore nessa ordem, foca o editor, registra manipuladores de entrada via `InputController`, inicia o TUI e solicita uma renderização forçada.

Uma renderização forçada (`requestRender(true)`) redefine os caches de linha anterior e o rastreamento do cursor antes de repintar.

## Ciclo de vida do terminal e normalização do stdin

`ProcessTerminal.start()`:

1. Habilita o modo raw e o bracketed paste.
2. Anexa o manipulador de redimensionamento.
3. Cria um `StdinBuffer` para dividir fragmentos de escape parciais em sequências completas.
4. Consulta o suporte ao protocolo de teclado Kitty (`CSI ? u`) e, em seguida, habilita os flags do protocolo se suportado.
5. No Windows, tenta a habilitação de entrada VT via flags de modo `kernel32`.

Comportamento do `StdinBuffer`:

- Armazena em buffer sequências de escape fragmentadas (CSI/OSC/DCS/APC/SS3).
- Emite `data` apenas quando uma sequência está completa ou é descarregada por timeout.
- Detecta bracketed paste e emite um evento `paste` com o texto colado bruto.

Isso impede que fragmentos de escape parciais sejam interpretados erroneamente como pressionamentos de tecla normais.

## Roteamento de entrada e modelo de foco

Caminho de entrada:

`stdin -> ProcessTerminal -> StdinBuffer -> TUI.#handleInput -> focusedComponent.handleInput`

Detalhes do roteamento:

1. O TUI executa primeiro os listeners de entrada registrados (`addInputListener`), permitindo comportamento de consumo/transformação.
2. O TUI trata o atalho global de depuração (`shift+ctrl+d`) antes do despacho para o componente.
3. Se o componente focado pertencer a uma sobreposição que agora está oculta/invisível, o TUI reatribui o foco para a próxima sobreposição visível ou para o foco pré-sobreposição salvo.
4. Eventos de liberação de tecla são filtrados, a menos que o componente focado defina `wantsKeyRelease = true`.
5. Após o despacho, o TUI agenda uma renderização.

`setFocus()` também alterna `Focusable.focused`, que controla se os componentes emitem `CURSOR_MARKER` para posicionamento do cursor de hardware.

## Divisão do tratamento de teclas: editor vs controlador

`CustomEditor` intercepta primeiro as combinações de alta prioridade (escape, ctrl-c/d/z, ctrl-v, variantes ctrl-p, ctrl-t, alt-up, teclas personalizadas de extensão) e delega o restante ao comportamento base do `Editor` (edição de texto, histórico, autocompletar, movimentação do cursor).

`InputController.setupKeyHandlers()` então vincula os callbacks do editor às ações do modo:

- cancelamento / saída de modo no `Escape`
- encerramento no `Ctrl+C` duplo ou `Ctrl+D` com editor vazio
- suspender/retomar no `Ctrl+Z`
- teclas de atalho para slash-command e seletor
- alternâncias de acompanhamento/desenfileiramento e alternâncias de expansão

Isso mantém a análise de teclas/mecânicas do editor em `packages/tui` e a semântica do modo nos controladores do coding-agent.

## Loop de renderização e estratégia de diff

`TUI.requestRender()` é debounced para uma renderização por tick usando `process.nextTick`. Múltiplas mudanças de estado no mesmo turno são coalescidas.

Pipeline de `#doRender()`:

1. Renderiza a árvore de componentes raiz em `newLines`.
2. Compõe as sobreposições visíveis (se houver).
3. Extrai e remove `CURSOR_MARKER` das linhas do viewport visível.
4. Acrescenta sufixos de reset de segmento para linhas sem imagem.
5. Escolhe entre repintura completa ou patch diferencial:
   - primeiro frame
   - mudança de largura
   - redução com `clearOnShrink` habilitado e sem sobreposições
   - edições acima do viewport anterior
6. Para atualizações diferenciais, aplica patch apenas no intervalo de linhas alteradas e limpa as linhas finais obsoletas quando necessário.
7. Reposiciona o cursor de hardware para suporte a IME.

As escritas de renderização usam o modo de saída sincronizado (`CSI ? 2026 h/l`) para reduzir oscilação/rasgamento.

## Restrições de segurança na renderização

Verificações críticas de segurança no `TUI`:

- Linhas renderizadas sem imagem não devem exceder a largura do terminal; overflow lança erro e grava diagnósticos de falha.
- A composição de sobreposições inclui truncamento defensivo e verificação de largura pós-composição.
- Mudanças de largura forçam redesenho completo porque a semântica de quebra de linha muda.
- A posição do cursor é limitada antes do movimento.

Essas restrições são imposições em tempo de execução, não apenas convenções.

## Tratamento de redimensionamento

Eventos de redimensionamento são orientados a eventos, de `ProcessTerminal` para `TUI.requestRender()`.

Efeitos:

- Qualquer mudança de largura aciona redesenho completo.
- O rastreamento de viewport/topo (`#previousViewportTop`, `#maxLinesRendered`) evita cálculos de cursor relativo inválidos quando o conteúdo ou o tamanho do terminal muda.
- A visibilidade da sobreposição pode depender das dimensões do terminal (`OverlayOptions.visible`); o foco é corrigido quando as sobreposições se tornam não visíveis após o redimensionamento.

## Streaming e atualizações incrementais de UI

`EventController` se inscreve em `AgentSessionEvent` e atualiza a UI incrementalmente:

- `agent_start`: inicia o loader em `statusContainer`.
- `message_start` do assistente: cria `streamingComponent` e o monta.
- `message_update`: atualiza o conteúdo do assistente em streaming; cria/atualiza componentes de execução de ferramentas conforme as chamadas de ferramenta aparecem.
- `tool_execution_update/end`: atualiza os componentes de resultado de ferramenta e o estado de conclusão.
- `message_end`: finaliza o stream do assistente, trata anotações de erro/interrupção, marca os argumentos de ferramentas pendentes como completos na parada normal.
- `agent_end`: para os loaders, limpa o estado transiente de stream, executa o switch de modelo adiado, emite notificação de conclusão se em segundo plano.

O agrupamento de ferramentas de leitura é intencionalmente com estado (`#lastReadGroup`) para coalescir chamadas consecutivas de ferramentas de leitura em um único bloco visual até que ocorra uma quebra por uma não-leitura.

## Orquestração de status e loader

Responsabilidade da faixa de status:

- `statusContainer` contém loaders transitórios (`loadingAnimation`, `autoCompactionLoader`, `retryLoader`).
- `statusLine` renderiza indicadores persistentes de status/hooks/plano e aciona atualizações da borda superior do editor.

Comportamento do loader:

- `Loader` atualiza a cada 80ms via intervalo e solicita renderização em cada frame.
- Os manipuladores de escape são temporariamente sobrescritos durante a compactação automática e a retentativa automática para cancelar essas operações.
- Nos caminhos de encerramento/cancelamento, os controladores restauram os manipuladores de escape anteriores e param/limpam os componentes do loader.

## Transições de modo e segundo plano

### Modos de entrada Bash/Python

Prefixos de texto de entrada alternam os flags de modo de borda do editor:

- `!` -> modo bash
- `$` (prefixo que não é template literal) -> modo python

O Escape sai do modo inativo limpando o texto do editor e restaurando a cor da borda; quando a execução está ativa, o Escape aborta a tarefa em execução.

### Modo de plano

`InteractiveMode` rastreia flags de modo de plano, estado da linha de status, ferramentas ativas e troca de modelo. Entrada/saída atualiza as entradas de modo da sessão e o estado de status/UI, incluindo troca de modelo adiada se o streaming estiver ativo.

### Suspender/retomar (`Ctrl+Z`)

`InputController.handleCtrlZ()`:

1. Registra um manipulador `SIGCONT` de disparo único para reiniciar o TUI e forçar renderização.
2. Para o TUI antes de suspender.
3. Envia `SIGTSTP` para o grupo de processos.

### Modo em segundo plano (`/background` ou `/bg`)

`handleBackgroundCommand()`:

- Rejeita quando ocioso.
- Muda o contexto de UI de ferramentas para não interativo (`hasUI=false`) para que ferramentas de UI interativas falhem rapidamente.
- Para loaders/linha de status e cancela a inscrição do manipulador de eventos em primeiro plano.
- Inscreve o manipulador de eventos em segundo plano (aguarda principalmente por `agent_end`).
- Para o TUI e envia `SIGTSTP` (caminho de controle de job POSIX).

Em `agent_end` em segundo plano sem trabalho enfileirado, o controlador envia notificação de conclusão e encerra.

## Caminhos de cancelamento

Entradas principais de cancelamento:

- `Escape` durante o loader de stream ativo: restaura as mensagens enfileiradas para o editor e aborta o agente.
- `Escape` durante a execução bash/python: aborta o comando em execução.
- `Escape` durante compactação automática/retentativa: invoca métodos de aborto dedicados através de manipuladores de escape temporários.
- `Ctrl+C` pressionado uma vez: limpa o editor; pressionado duas vezes em 500ms: encerramento.

O cancelamento é condicional ao estado; a mesma tecla pode significar abortar, sair do modo, acionar o seletor ou não fazer nada, dependendo do estado em tempo de execução.

## Comportamento orientado a eventos vs. com limitação de taxa

Atualizações orientadas a eventos:

- Eventos de sessão do agente (`EventController`)
- Callbacks de entrada de teclas (`InputController`)
- Callback de redimensionamento do terminal
- Observadores de tema/branch em `InteractiveMode`

Caminhos com throttle/debounce:

- A renderização do TUI é debounced por tick (coalescimento de `requestRender`).
- A animação do loader é de intervalo fixo (80ms), com cada frame solicitando renderização.
- As atualizações de autocompletar do editor (dentro de `Editor`) usam timers de debounce, reduzindo o reprocessamento durante a digitação.

O runtime, portanto, combina transições de estado orientadas a eventos com cadência de renderização limitada para manter a interatividade responsiva sem explosões de repintura.
