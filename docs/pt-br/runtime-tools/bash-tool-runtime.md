---
title: Runtime da Ferramenta Bash
description: >-
  Runtime da ferramenta bash com gerenciamento de processos shell, sandboxing,
  timeout e streaming de saída.
sidebar:
  order: 1
  label: Ferramenta Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Runtime da ferramenta bash

Este documento descreve o caminho de runtime da **ferramenta `bash`** utilizado pelas chamadas de ferramentas do agente, desde a normalização de comandos até a execução, truncamento/artefatos e renderização.

Também destaca onde o comportamento diverge no TUI interativo, modo de impressão (print mode), modo RPC e execução shell iniciada pelo usuário com bang (`!`).

## Escopo e superfícies de runtime

Existem duas superfícies de execução bash diferentes no coding-agent:

1. **Superfície de chamada de ferramenta** (`toolName: "bash"`): utilizada quando o modelo chama a ferramenta bash.
   - Ponto de entrada: `BashTool.execute()`.
2. **Superfície de comando bang do usuário** (`!cmd` a partir de entrada interativa ou comando RPC `bash`): caminho auxiliar em nível de sessão.
   - Ponto de entrada: `AgentSession.executeBash()`.

Ambos eventualmente utilizam `executeBash()` em `src/exec/bash-executor.ts` para execução sem PTY, mas apenas o caminho de chamada de ferramenta executa a lógica de normalização/interceptação e renderização de ferramentas.

## Pipeline de chamada de ferramenta ponta a ponta

## 1) Normalização de entrada e mesclagem de parâmetros

`BashTool.execute()` primeiro normaliza o comando bruto via `normalizeBashCommand()`:

- extrai `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` finais em limites estruturados,
- remove espaços em branco iniciais/finais,
- mantém espaços em branco internos intactos.

Em seguida, mescla os limites extraídos com argumentos explícitos da ferramenta:

- argumentos explícitos de `head`/`tail` sobrescrevem valores extraídos,
- valores extraídos são apenas fallback.

### Ressalva

Os comentários em `bash-normalize.ts` mencionam a remoção de `2>&1`, mas a implementação atual não o remove. O comportamento em runtime ainda está correto (stdout/stderr já são mesclados), mas o comportamento de normalização é mais restrito do que os comentários sugerem.

## 2) Interceptação opcional (caminho de comando bloqueado)

Se `bashInterceptor.enabled` estiver ativo, `BashTool` carrega as regras das configurações e executa `checkBashInterception()` contra o comando normalizado.

Comportamento de interceptação:

- o comando é bloqueado **apenas** quando:
  - a regra regex corresponde, e
  - a ferramenta sugerida está presente em `ctx.toolNames`.
- regras regex inválidas são silenciosamente ignoradas.
- ao bloquear, `BashTool` lança `ToolError` com mensagem:
  - `Blocked: ...`
  - comando original incluído.

Padrões de regras padrão (definidos no código) visam usos indevidos comuns:

- leitores de arquivo (`cat`, `head`, `tail`, ...)
- ferramentas de busca (`grep`, `rg`, ...)
- localizadores de arquivo (`find`, `fd`, ...)
- editores in-place (`sed -i`, `perl -i`, `awk -i inplace`)
- escritas por redirecionamento shell (`echo ... > file`, redirecionamento heredoc)

### Ressalva

`InterceptionResult` inclui `suggestedTool`, mas `BashTool` atualmente expõe apenas o texto da mensagem (sem campo estruturado de ferramenta sugerida em `details`).

## 3) Validação de CWD e limitação de timeout

`cwd` é resolvido relativo ao cwd da sessão (`resolveToCwd`), então validado via `stat`:

- caminho inexistente -> `ToolError("Working directory does not exist: ...")`
- não é diretório -> `ToolError("Working directory is not a directory: ...")`

O timeout é limitado a `[1, 3600]` segundos e convertido para milissegundos.

## 4) Alocação de artefato

Antes da execução, a ferramenta aloca um caminho/id de artefato (melhor esforço) para armazenamento de saída truncada.

- falha na alocação de artefato não é fatal (a execução continua sem arquivo de despejo de artefato),
- id/caminho do artefato são passados para o caminho de execução para persistência de saída completa em caso de truncamento.

## 5) Seleção de execução PTY vs não-PTY

`BashTool` escolhe execução PTY somente quando todas as condições são verdadeiras:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- contexto da ferramenta possui UI (`ctx.hasUI === true` e `ctx.ui` definido)

Caso contrário, utiliza `executeBash()` não interativo.

Isso significa que o modo de impressão e contextos RPC/ferramenta sem UI sempre utilizam não-PTY.

## Motor de execução não interativo (`executeBash`)

## Modelo de reutilização de sessão shell

`executeBash()` armazena em cache instâncias nativas de `Shell` em um mapa global de processo, indexado por:

- caminho do shell,
- prefixo de comando configurado,
- caminho do snapshot,
- env do shell serializado,
- chave opcional de sessão do agente.

Para execuções em nível de sessão, `AgentSession.executeBash()` passa `sessionKey: this.sessionId`, isolando a reutilização por sessão.

O caminho de chamada de ferramenta **não** passa `sessionKey`, então o escopo de reutilização é baseado na configuração/snapshot/env do shell.

## Configuração do shell e comportamento de snapshot

Em cada chamada, o executor carrega a configuração shell das definições (`shell`, `env`, `prefix` opcional).

Se o shell selecionado inclui `bash`, ele tenta `getOrCreateSnapshot()`:

- o snapshot captura aliases/funções/opções do rc do usuário,
- a criação do snapshot é de melhor esforço,
- falha faz fallback para sem snapshot.

Se `prefix` estiver configurado, o comando se torna:

```text
<prefix> <command>
```

## Streaming e cancelamento

`Shell.run()` transmite chunks via callback. O executor direciona cada chunk para `OutputSink` e callback opcional `onChunk`.

Cancelamento:

- sinal abortado dispara `shellSession.abort(...)`,
- timeout do resultado nativo é mapeado para `cancelled: true` + texto de anotação,
- cancelamento explícito similarmente retorna `cancelled: true` + anotação.

Nenhuma exceção é lançada dentro do executor para timeout/cancelamento; ele retorna um `BashResult` estruturado e deixa o chamador mapear a semântica de erro.

## Caminho PTY interativo (`runInteractiveBashPty`)

Quando PTY está habilitado, a ferramenta executa `runInteractiveBashPty()` que abre um componente de console em sobreposição e controla uma `PtySession` nativa.

Destaques do comportamento:

- terminal virtual xterm-headless renderiza viewport na sobreposição,
- entrada de teclado é normalizada (incluindo sequências Kitty e tratamento de modo cursor de aplicação),
- `esc` durante a execução encerra a sessão PTY,
- redimensionamento do terminal propaga para PTY (`session.resize(cols, rows)`).

Padrões de hardening de ambiente são injetados para execuções não assistidas:

- pagers desabilitados (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- prompts de editor desabilitados (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompts de terminal/autenticação reduzidos (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flags de automação de gerenciadores de pacotes/ferramentas para comportamento não interativo.

A saída do PTY é normalizada (`CRLF`/`CR` para `LF`, `sanitizeText`) e escrita no `OutputSink`, incluindo suporte a despejo de artefato.

Em erro de inicialização/runtime do PTY, o sink recebe linha `PTY error: ...` e o comando finaliza com código de saída indefinido.

## Tratamento de saída: streaming, truncamento, despejo de artefato

Tanto os caminhos PTY quanto não-PTY utilizam `OutputSink`.

## Semântica do OutputSink

- mantém um buffer tail em memória seguro para UTF-8 (`DEFAULT_MAX_BYTES`, atualmente 50KB),
- rastreia total de bytes/linhas vistos,
- se o caminho do artefato existe e a saída excede o limite (ou arquivo já está ativo), grava o fluxo completo no arquivo de artefato,
- quando o limite de memória é excedido, reduz o buffer em memória para o tail (seguro nos limites UTF-8),
- marca `truncated` quando ocorre overflow/despejo em arquivo.

`dump()` retorna:

- `output` (prefixo possivelmente anotado),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` se arquivo de artefato estava ativo.

### Ressalva de saída longa

O truncamento em runtime é baseado em limite de bytes no `OutputSink` (50KB padrão). Ele não impõe um limite rígido de 2000 linhas neste caminho de código.

## Atualizações ao vivo da ferramenta

Para execução não-PTY, `BashTool` utiliza um `TailBuffer` separado para atualizações parciais e emite snapshots `onUpdate` enquanto o comando está em execução.

Para execução PTY, a renderização ao vivo é tratada pela sobreposição de UI customizada, não por chunks de texto `onUpdate`.

## Formatação de resultado, metadados e mapeamento de erros

Após a execução:

1. Tratamento de `cancelled`:
   - se o sinal de aborto está abortado -> lança `ToolAbortError` (semântica de aborto),
   - caso contrário -> lança `ToolError` (tratado como falha de ferramenta).
2. `timedOut` do PTY -> lança `ToolError`.
3. aplica filtros head/tail ao texto de saída final (`applyHeadTail`, head depois tail).
4. saída vazia se torna `(no output)`.
5. anexa metadados de truncamento via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapeamento de código de saída:
   - código de saída ausente -> `ToolError("... missing exit status")`
   - saída não-zero -> `ToolError("... Command exited with code N")`
   - saída zero -> resultado de sucesso.

Estrutura do payload de sucesso:

- `content`: saída de texto,
- `details.meta.truncation` quando truncado, incluindo:
  - `direction`, `truncatedBy`, contagens de linhas+bytes total/saída,
  - `shownRange`,
  - `artifactId` quando disponível.

Como ferramentas integradas são encapsuladas com `wrapToolWithMetaNotice()`, o texto de aviso de truncamento é automaticamente adicionado ao conteúdo de texto final (por exemplo: `Full: artifact://<id>`).

## Caminhos de renderização

## Renderizador de chamada de ferramenta (`bashToolRenderer`)

`bashToolRenderer` é utilizado para mensagens de chamada de ferramenta (`toolCall` / `toolResult`):

- modo recolhido mostra pré-visualização truncada por linhas visuais,
- modo expandido mostra todo o texto de saída atualmente disponível,
- linha de aviso inclui motivo do truncamento e `artifact://<id>` quando truncado,
- valor de timeout (dos argumentos) é mostrado na linha de metadados do rodapé.

### Ressalva: expansão completa de artefato

`BashRenderContext` possui `isFullOutput`, mas o construtor de contexto do renderizador atual não o define para resultados da ferramenta bash. A visualização expandida ainda utiliza o texto já presente no conteúdo do resultado (saída tail/truncada) a menos que outro chamador forneça o conteúdo completo do artefato.

## Componente de comando bang do usuário (`BashExecutionComponent`)

`BashExecutionComponent` é para comandos `!` do usuário no modo interativo (não chamadas de ferramenta do modelo):

- transmite chunks ao vivo,
- pré-visualização recolhida mantém as últimas 20 linhas lógicas,
- limite de linha em 4000 caracteres por linha,
- mostra avisos de truncamento + artefato quando metadados estão presentes,
- marca estados de cancelado/erro/saída separadamente.

Este componente é conectado por `CommandController.handleBashCommand()` e alimentado por `AgentSession.executeBash()`.

## Diferenças de comportamento específicas por modo

| Superfície                     | Caminho de entrada                                    | Elegível para PTY                                                    | UX de saída ao vivo                                                      | Exposição de erros                               |
| ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| Chamada de ferramenta interativa | `BashTool.execute`                                  | Sim, quando `bash.virtualTerminal=on` e UI existe e `PI_NO_PTY!=1`   | Sobreposição PTY (interativa) ou atualizações tail por streaming         | Erros de ferramenta tornam-se `toolResult.isError` |
| Chamada de ferramenta em modo impressão | `BashTool.execute`                             | Não (sem contexto de UI)                                             | Sem sobreposição TUI; saída aparece no fluxo de eventos/texto final do assistente | Mesmo mapeamento de erro de ferramenta           |
| Chamada de ferramenta RPC (ferramental do agente) | `BashTool.execute`                        | Geralmente sem UI -> não-PTY                                         | Eventos/resultados de ferramenta estruturados                            | Mesmo mapeamento de erro de ferramenta           |
| Comando bang interativo (`!`)  | `AgentSession.executeBash` + `BashExecutionComponent` | Não (usa executor diretamente)                                       | Componente dedicado de execução bash                                     | Controller captura exceções e mostra erro na UI  |
| Comando RPC `bash`             | `rpc-mode` -> `session.executeBash`                   | Não                                                                  | Retorna `BashResult` diretamente                                         | Consumidor trata campos retornados               |

## Ressalvas operacionais

- O interceptor apenas bloqueia comandos quando a ferramenta sugerida está atualmente disponível no contexto.
- Se a alocação de artefato falhar, o truncamento ainda ocorre mas nenhuma referência `artifact://` está disponível.
- O cache de sessão shell não possui evição explícita neste módulo; o tempo de vida é no escopo do processo.
- As superfícies de timeout PTY e não-PTY diferem:
  - PTY expõe campo de resultado `timedOut` explícito,
  - não-PTY mapeia timeout para resumo `cancelled + annotation`.

## Arquivos de implementação

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — ponto de entrada da ferramenta, normalização/interceptação, seleção PTY/não-PTY, mapeamento de resultado/erro, renderizador da ferramenta bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalização de comando e filtragem head/tail pós-execução.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondência de regras de interceptação e mensagens de comando bloqueado.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor não-PTY, reutilização de sessão shell, conexão de cancelamento, integração com output sink.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — runtime PTY, UI de sobreposição, normalização de entrada, padrões de env não interativo.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — truncamento/despejo de artefato do `OutputSink` e metadados de resumo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — auxiliares de alocação de artefato e buffer tail de streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — formato de metadados de truncamento + wrapper de injeção de aviso.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` em nível de sessão, gravação de mensagens, ciclo de vida de aborto.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente de execução de comando `!` interativo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — conexão para streaming/conclusão de atualização da UI do comando `!` interativo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superfície de comando RPC `bash` e `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolução de `artifact://<id>`.
