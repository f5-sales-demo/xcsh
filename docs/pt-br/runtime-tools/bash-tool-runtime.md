---
title: Runtime da Ferramenta Bash
description: >-
  Bash tool runtime with shell process management, sandboxing, timeout, and
  output streaming.
sidebar:
  order: 1
  label: Ferramenta Bash
i18n:
  sourceHash: 18b12aa5dbd5
  translator: machine
---

# Runtime da ferramenta Bash

Este documento descreve o caminho de runtime da **ferramenta `bash`** utilizado por chamadas de ferramentas de agente, desde a normalização de comandos até a execução, truncamento/artefatos e renderização.

Também destaca onde o comportamento diverge no TUI interativo, modo de impressão, modo RPC e execução de shell iniciada pelo usuário com bang (`!`).

## Escopo e superfícies de runtime

Existem duas superfícies diferentes de execução bash no coding-agent:

1. **Superfície de chamada de ferramenta** (`toolName: "bash"`): usada quando o modelo chama a ferramenta bash.
   - Ponto de entrada: `BashTool.execute()`.
2. **Superfície de comando bang do usuário** (`!cmd` a partir de entrada interativa ou comando RPC `bash`): caminho auxiliar em nível de sessão.
   - Ponto de entrada: `AgentSession.executeBash()`.

Ambas eventualmente utilizam `executeBash()` em `src/exec/bash-executor.ts` para execução não-PTY, mas apenas o caminho de chamada de ferramenta executa a lógica de normalização/interceptação e renderização da ferramenta.

## Pipeline de chamada de ferramenta de ponta a ponta

## 1) Normalização de entrada e mesclagem de parâmetros

`BashTool.execute()` primeiro normaliza o comando bruto via `normalizeBashCommand()`:

- extrai `| head -n N`, `| head -N`, `| tail -n N`, `| tail -N` finais em limites estruturados,
- remove espaços em branco iniciais/finais,
- mantém espaços em branco internos intactos.

Em seguida, mescla os limites extraídos com argumentos explícitos da ferramenta:

- argumentos explícitos `head`/`tail` sobrescrevem valores extraídos,
- valores extraídos são apenas fallback.

### Ressalva

Os comentários em `bash-normalize.ts` mencionam a remoção de `2>&1`, mas a implementação atual não o remove. O comportamento em runtime ainda está correto (stdout/stderr já são mesclados), mas o comportamento de normalização é mais restrito do que os comentários sugerem.

## 2) Interceptação opcional (caminho de comando bloqueado)

Se `bashInterceptor.enabled` for verdadeiro, `BashTool` carrega regras das configurações e executa `checkBashInterception()` contra o comando normalizado.

Comportamento de interceptação:

- o comando é bloqueado **somente** quando:
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
- escritas por redirecionamento de shell (`echo ... > file`, redirecionamento heredoc)

### Ressalva

`InterceptionResult` inclui `suggestedTool`, mas `BashTool` atualmente expõe apenas o texto da mensagem (sem campo estruturado de ferramenta sugerida em `details`).

## 3) Validação de CWD e limitação de timeout

`cwd` é resolvido em relação ao cwd da sessão (`resolveToCwd`), então validado via `stat`:

- caminho inexistente -> `ToolError("Working directory does not exist: ...")`
- não é diretório -> `ToolError("Working directory is not a directory: ...")`

O timeout é limitado a `[1, 3600]` segundos e convertido para milissegundos.

## 4) Alocação de artefato

Antes da execução, a ferramenta aloca um caminho/id de artefato (melhor esforço) para armazenamento de saída truncada.

- falha na alocação de artefato não é fatal (a execução continua sem arquivo de despejo de artefato),
- id/caminho do artefato são passados ao caminho de execução para persistência da saída completa em caso de truncamento.

## 5) Seleção de execução PTY vs não-PTY

`BashTool` escolhe execução PTY somente quando todas as condições são verdadeiras:

- `bash.virtualTerminal === "on"`
- `PI_NO_PTY !== "1"`
- o contexto da ferramenta possui UI (`ctx.hasUI === true` e `ctx.ui` definido)

Caso contrário, utiliza `executeBash()` não interativo.

Isso significa que o modo de impressão e contextos RPC/ferramenta sem UI sempre usam não-PTY.

## Motor de execução não interativa (`executeBash`)

## Modelo de reutilização de sessão shell

`executeBash()` armazena em cache instâncias nativas de `Shell` em um mapa global por processo, com chave baseada em:

- caminho do shell,
- prefixo de comando configurado,
- caminho do snapshot,
- env do shell serializado,
- chave de sessão de agente opcional.

Para execuções em nível de sessão, `AgentSession.executeBash()` passa `sessionKey: this.sessionId`, isolando a reutilização por sessão.

O caminho de chamada de ferramenta **não** passa `sessionKey`, então o escopo de reutilização é baseado na configuração/snapshot/env do shell.

## Configuração do shell e comportamento de snapshot

A cada chamada, o executor carrega a configuração do shell das definições (`shell`, `env`, `prefix` opcional).

Se o shell selecionado inclui `bash`, ele tenta `getOrCreateSnapshot()`:

- o snapshot captura aliases/funções/opções do rc do usuário,
- a criação do snapshot é de melhor esforço,
- falha resulta em fallback sem snapshot.

Se `prefix` estiver configurado, o comando se torna:

```text
<prefix> <command>
```

## Streaming e cancelamento

`Shell.run()` transmite chunks via callback. O executor encaminha cada chunk para `OutputSink` e callback `onChunk` opcional.

Cancelamento:

- sinal de abort acionado dispara `shellSession.abort(...)`,
- timeout do resultado nativo é mapeado para `cancelled: true` + texto de anotação,
- cancelamento explícito similarmente retorna `cancelled: true` + anotação.

Nenhuma exceção é lançada dentro do executor para timeout/cancelamento; ele retorna `BashResult` estruturado e permite que o chamador mapeie a semântica de erro.

## Caminho PTY interativo (`runInteractiveBashPty`)

Quando PTY está habilitado, a ferramenta executa `runInteractiveBashPty()` que abre um componente de console overlay e conduz uma `PtySession` nativa.

Destaques do comportamento:

- terminal virtual xterm-headless renderiza a viewport no overlay,
- entrada de teclado é normalizada (incluindo sequências Kitty e tratamento do modo de cursor de aplicação),
- `esc` durante a execução mata a sessão PTY,
- redimensionamento do terminal é propagado para o PTY (`session.resize(cols, rows)`).

Padrões de endurecimento de ambiente são injetados para execuções não assistidas:

- pagers desabilitados (`PAGER=cat`, `GIT_PAGER=cat`, etc.),
- prompts de editor desabilitados (`GIT_EDITOR=true`, `EDITOR=true`, ...),
- prompts de terminal/autenticação reduzidos (`GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS=/usr/bin/false`, `CI=1`),
- flags de automação de gerenciador de pacotes/ferramentas para comportamento não interativo.

A saída PTY é normalizada (`CRLF`/`CR` para `LF`, `sanitizeText`) e escrita no `OutputSink`, incluindo suporte a despejo de artefato.

Em erro de inicialização/runtime do PTY, o sink recebe a linha `PTY error: ...` e o comando é finalizado com código de saída indefinido.

## Tratamento de saída: streaming, truncamento, despejo de artefato

Tanto os caminhos PTY quanto não-PTY usam `OutputSink`.

## Semântica do OutputSink

- mantém um buffer tail em memória seguro para UTF-8 (`DEFAULT_MAX_BYTES`, atualmente 50KB),
- rastreia total de bytes/linhas vistos,
- se o caminho do artefato existe e a saída excede o limite (ou o arquivo já está ativo), escreve o stream completo no arquivo de artefato,
- quando o limite de memória é excedido, corta o buffer em memória para o tail (seguro para fronteira UTF-8),
- marca `truncated` quando ocorre overflow/despejo em arquivo.

`dump()` retorna:

- `output` (possivelmente com prefixo anotado),
- `truncated`,
- `totalLines/totalBytes`,
- `outputLines/outputBytes`,
- `artifactId` se o arquivo de artefato estava ativo.

### Ressalva sobre saída longa

O truncamento em runtime é baseado em limite de bytes no `OutputSink` (50KB padrão). Ele não impõe um limite rígido de 2000 linhas neste caminho de código.

## Atualizações da ferramenta ao vivo

Para execução não-PTY, `BashTool` usa um `TailBuffer` separado para atualizações parciais e emite snapshots `onUpdate` enquanto o comando está em execução.

Para execução PTY, a renderização ao vivo é tratada pelo overlay de UI personalizado, não por chunks de texto `onUpdate`.

## Formatação de resultado, metadados e mapeamento de erros

Após a execução:

1. Tratamento de `cancelled`:
   - se o sinal de abort está abortado -> lança `ToolAbortError` (semântica de abort),
   - caso contrário -> lança `ToolError` (tratado como falha da ferramenta).
2. `timedOut` do PTY -> lança `ToolError`.
3. aplica filtros head/tail ao texto de saída final (`applyHeadTail`, head depois tail).
4. saída vazia se torna `(no output)`.
5. anexa metadados de truncamento via `toolResult(...).truncationFromSummary(result, { direction: "tail" })`.
6. mapeamento de código de saída:
   - código de saída ausente -> `ToolError("... missing exit status")`
   - saída diferente de zero -> `ToolError("... Command exited with code N")`
   - saída zero -> resultado de sucesso.

Estrutura do payload de sucesso:

- `content`: saída de texto,
- `details.meta.truncation` quando truncado, incluindo:
  - `direction`, `truncatedBy`, contagens de linhas+bytes total/saída,
  - `shownRange`,
  - `artifactId` quando disponível.

Como ferramentas integradas são envolvidas com `wrapToolWithMetaNotice()`, o texto de aviso de truncamento é automaticamente anexado ao conteúdo de texto final (por exemplo: `Full: artifact://<id>`).

## Caminhos de renderização

## Renderizador de chamada de ferramenta (`bashToolRenderer`)

`bashToolRenderer` é usado para mensagens de chamada de ferramenta (`toolCall` / `toolResult`):

- modo recolhido mostra prévia truncada por linhas visuais,
- modo expandido mostra todo o texto de saída atualmente disponível,
- linha de aviso inclui motivo do truncamento e `artifact://<id>` quando truncado,
- valor de timeout (dos argumentos) é mostrado na linha de metadados do rodapé.

### Ressalva: expansão completa de artefato

`BashRenderContext` tem `isFullOutput`, mas o construtor de contexto de renderização atual não o define para resultados da ferramenta bash. A visualização expandida ainda usa o texto já presente no conteúdo do resultado (saída tail/truncada) a menos que outro chamador forneça o conteúdo completo do artefato.

## Componente de comando bang do usuário (`BashExecutionComponent`)

`BashExecutionComponent` é para comandos `!` do usuário no modo interativo (não chamadas de ferramenta do modelo):

- transmite chunks ao vivo,
- prévia recolhida mantém as últimas 20 linhas lógicas,
- limite de linha em 4000 caracteres por linha,
- mostra avisos de truncamento + artefato quando metadados estão presentes,
- marca estados de cancelado/erro/saída separadamente.

Este componente é conectado por `CommandController.handleBashCommand()` e alimentado por `AgentSession.executeBash()`.

## Diferenças de comportamento específicas por modo

| Superfície                           | Caminho de entrada                                    | Elegível para PTY                                                        | UX de saída ao vivo                                                                 | Exposição de erros                                             |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Chamada de ferramenta interativa     | `BashTool.execute`                                    | Sim, quando `bash.virtualTerminal=on` e UI existe e `PI_NO_PTY!=1`      | Overlay PTY (interativo) ou atualizações de tail transmitidas                       | Erros de ferramenta se tornam `toolResult.isError`             |
| Chamada de ferramenta em modo print  | `BashTool.execute`                                    | Não (sem contexto de UI)                                                 | Sem overlay TUI; saída aparece no stream de eventos/fluxo de texto final do assistente | Mesmo mapeamento de erro de ferramenta                         |
| Chamada de ferramenta RPC (agente)   | `BashTool.execute`                                    | Geralmente sem UI -> não-PTY                                             | Eventos/resultados de ferramenta estruturados                                       | Mesmo mapeamento de erro de ferramenta                         |
| Comando bang interativo (`!`)        | `AgentSession.executeBash` + `BashExecutionComponent` | Não (usa executor diretamente)                                           | Componente dedicado de execução bash                                                | Controller captura exceções e mostra erro na UI                |
| Comando RPC `bash`                   | `rpc-mode` -> `session.executeBash`                   | Não                                                                      | Retorna `BashResult` diretamente                                                    | Consumidor trata campos retornados                             |

## Ressalvas operacionais

- O interceptador só bloqueia comandos quando a ferramenta sugerida está atualmente disponível no contexto.
- Se a alocação de artefato falhar, o truncamento ainda ocorre, mas nenhuma referência `artifact://` está disponível.
- O cache de sessão shell não possui evicção explícita neste módulo; o tempo de vida é no escopo do processo.
- As superfícies de timeout PTY e não-PTY diferem:
  - PTY expõe campo de resultado `timedOut` explícito,
  - não-PTY mapeia timeout para resumo `cancelled + annotation`.

## Arquivos de implementação

- [`src/tools/bash.ts`](../../packages/coding-agent/src/tools/bash.ts) — ponto de entrada da ferramenta, normalização/interceptação, seleção PTY/não-PTY, mapeamento de resultado/erro, renderizador da ferramenta bash.
- [`src/tools/bash-normalize.ts`](../../packages/coding-agent/src/tools/bash-normalize.ts) — normalização de comando e filtragem head/tail pós-execução.
- [`src/tools/bash-interceptor.ts`](../../packages/coding-agent/src/tools/bash-interceptor.ts) — correspondência de regras de interceptação e mensagens de comando bloqueado.
- [`src/exec/bash-executor.ts`](../../packages/coding-agent/src/exec/bash-executor.ts) — executor não-PTY, reutilização de sessão shell, conexão de cancelamento, integração com output sink.
- [`src/tools/bash-interactive.ts`](../../packages/coding-agent/src/tools/bash-interactive.ts) — runtime PTY, overlay de UI, normalização de entrada, padrões de env não interativo.
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts) — truncamento/despejo de artefato do `OutputSink` e metadados de resumo.
- [`src/tools/output-utils.ts`](../../packages/coding-agent/src/tools/output-utils.ts) — helpers de alocação de artefato e buffer tail de streaming.
- [`src/tools/output-meta.ts`](../../packages/coding-agent/src/tools/output-meta.ts) — forma dos metadados de truncamento + wrapper de injeção de aviso.
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts) — `executeBash` em nível de sessão, gravação de mensagens, ciclo de vida de abort.
- [`src/modes/components/bash-execution.ts`](../../packages/coding-agent/src/modes/components/bash-execution.ts) — componente de execução de comando `!` interativo.
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts) — conexão para stream/atualização/conclusão de UI de comando `!` interativo.
- [`src/modes/rpc/rpc-mode.ts`](../../packages/coding-agent/src/modes/rpc/rpc-mode.ts) — superfície de comando RPC `bash` e `abort_bash`.
- [`src/internal-urls/artifact-protocol.ts`](../../packages/coding-agent/src/internal-urls/artifact-protocol.ts) — resolução de `artifact://<id>`.
