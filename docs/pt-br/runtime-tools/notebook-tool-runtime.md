---
title: Internals do Runtime da Ferramenta Notebook
description: >-
  Runtime da ferramenta de notebooks Jupyter com execução de células, ciclo de
  vida do kernel e renderização de saída.
sidebar:
  order: 2
  label: Ferramenta Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Internals do runtime da ferramenta Notebook

Este documento descreve a implementação atual da ferramenta `notebook` e sua relação com o runtime Python suportado por kernel.

A distinção crítica: **`notebook` é um editor de notebooks JSON, não um executor de notebooks**. Ela edita os sources das células de arquivos `.ipynb` diretamente; não inicializa nem se comunica com um kernel Python.

## Arquivos de implementação

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Fronteira do runtime: edição vs execução

## Ferramenta `notebook` (`src/tools/notebook.ts`)

- Suporta `action: edit | insert | delete` em um arquivo `.ipynb`.
- Resolve o caminho relativo ao CWD da sessão (`resolveToCwd`).
- Carrega o JSON do notebook, valida o array `cells` e os limites de `cell_index`.
- Aplica edições de source em memória e grava o JSON completo do notebook com `JSON.stringify(notebook, null, 1)`.
- Retorna resumo textual + `details` estruturados (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Nenhum ciclo de vida de kernel existe nesta ferramenta:

- sem aquisição de gateway
- sem ID de sessão de kernel
- sem `execute_request`
- sem chunks de stream dos canais do kernel
- sem captura de display rico (`image/png`, JSON display, status MIME)

## Caminho de execução similar a notebook (`src/tools/python.ts` + `src/ipy/*`)

Quando o agente precisa executar código Python no estilo de células (células sequenciais, estado persistente, displays ricos), isso passa pela ferramenta **`python`**, não pela `notebook`.

É nesse caminho que residem os modos de kernel, o comportamento de restart/cancelamento, o streaming de chunks e a truncagem de artefatos de saída.

## 2) Semânticas de manipulação de células do notebook (ferramenta `notebook`)

## Normalização de source

O `content` é dividido em `source: string[]` com preservação de quebras de linha:

- cada linha não-final mantém o `\n` final
- a linha final não possui quebra de linha forçada

Isso espelha as convenções do JSON de notebooks e evita concatenação acidental de linhas em edições posteriores.

## Comportamento das ações

- `edit`
  - substitui `cells[cell_index].source`
  - preserva o `cell_type` existente
- `insert`
  - insere em `[0..cellCount]`
  - `cell_type` padrão é `code`
  - células de código inicializam `execution_count: null` e `outputs: []`
  - células markdown inicializam apenas `metadata` + `source`
- `delete`
  - remove `cells[cell_index]`
  - retorna o `source` removido nos details para preview do renderer

## Superfícies de erro

Falhas críticas são lançadas para:

- arquivo de notebook ausente
- JSON inválido
- `cells` ausente ou não-array
- índice fora do intervalo (insert e não-insert possuem intervalos válidos diferentes)
- `content` ausente para `edit`/`insert`

Esses erros se tornam respostas de ferramenta `Error:` upstream; o renderer usa o caminho do notebook + texto de erro formatado.

## 3) Semânticas de sessão de kernel (onde elas realmente existem)

As semânticas de kernel são implementadas em `executePython` / `PythonKernel` e se aplicam à ferramenta `python`.

## Modos

`PythonKernelMode`:

- `session` (padrão)
  - kernels armazenados em cache no mapa `kernelSessions`
  - máximo de 4 sessões; a mais antiga é removida em caso de overflow
  - limpeza de idle/dead a cada 30s, timeout após 5 minutos
  - fila por sessão serializa a execução (`session.queue`)
- `per-call`
  - cria kernel para a requisição
  - executa
  - sempre encerra o kernel em `finally`

## Comportamento de reset

A ferramenta `python` passa `reset` somente para a primeira célula em uma chamada de múltiplas células; células posteriores sempre executam com `reset: false`.

## Morte do kernel / restart / retry

No modo de sessão (`withKernelSession`):

- kernel morto detectado por heartbeat (verificação `kernel.isAlive()` a cada 5s) ou falha de execução.
- estado morto pré-execução aciona `restartKernelSession`.
- caminho de crash em tempo de execução tenta novamente uma vez: reinicia o kernel, reexecuta o handler.
- `restartCount > 1` na mesma sessão lança `Python kernel restarted too many times in this session`.

Comportamento de retry na inicialização:

- criação de kernel de gateway compartilhado tenta novamente uma vez em `SharedGatewayCreateError` com HTTP 5xx.

Recuperação de esgotamento de recursos:

- detecta falhas no estilo `EMFILE`/`ENFILE`/"Too many open files"
- limpa as sessões rastreadas
- chama `shutdownSharedGateway()`
- tenta criar a sessão de kernel novamente uma vez

## 4) Injeção de variáveis de ambiente/sessão

A inicialização do kernel recebe um mapa de env opcional do executor:

- `PI_SESSION_FILE` (caminho do arquivo de estado da sessão)
- `ARTIFACTS` (diretório de artefatos)

`PythonKernel.#initializeKernelEnvironment(...)` então executa o script de inicialização dentro do kernel para:

- `os.chdir(cwd)`
- injetar entradas de env em `os.environ`
- acrescentar cwd ao `sys.path` se ausente

Implicação:

- helpers de prelúdio que leem o contexto de sessão ou artefato dependem dessas variáveis de env no estado do processo Python.

## 5) Manipulação de streaming/chunk e display (caminho suportado por kernel)

O cliente de kernel processa mensagens do protocolo Jupyter por execução:

- `stream` -> chunk de texto para `onChunk`
- `execute_result` / `display_data` ->
  - texto de display escolhido por precedência MIME: `text/markdown` > `text/plain` > `text/html` convertido
  - saídas estruturadas capturadas separadamente:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (sem emissão de texto)
- `error` -> texto de traceback enviado ao stream de chunks + metadados de erro estruturados
- `input_request` -> emite texto de aviso de stdin, envia `input_reply` vazio, marca stdin como solicitado
- a conclusão aguarda tanto `execute_reply` quanto o `status=idle` do kernel

Cancelamento/timeout:

- sinal de abort aciona `interrupt()` (REST `/interrupt` + `interrupt_request` no canal de controle)
- resultado marca `cancelled=true`
- caminho de timeout anota a saída com `Command timed out after <n> seconds`

## 6) Truncagem e comportamento de artefatos

`OutputSink` em `src/session/streaming-output.ts` é utilizado pelos caminhos de execução de kernel (`executeWithKernel`):

- sanitiza cada chunk (`sanitizeText`)
- rastreia total de linhas/bytes de saída
- arquivo de spill de artefato opcional (`artifactPath`, `artifactId`)
- quando o buffer em memória excede o limite (`DEFAULT_MAX_BYTES` a menos que seja sobrescrito):
  - marca como truncado
  - mantém os bytes finais em memória (limite seguro UTF-8)
  - pode fazer spill do stream completo para o sink de artefato

`dump()` retorna:

- texto de saída visível (possivelmente truncado pela cauda)
- flag de truncagem + contagens
- ID do artefato (para referências `artifact://<id>`)

A ferramenta `python` converte esses metadados em avisos de truncagem de resultado e avisos de TUI.

A ferramenta `notebook` **não** usa `OutputSink`; ela não possui pipeline de stream/truncagem de artefatos porque não executa código.

## 7) Premissas e formatação do renderer

## Renderer de notebook (`notebookToolRenderer`)

- view de chamada: linha de status com ação + caminho do notebook + metadados de célula/tipo
- view de resultado:
  - resumo de sucesso derivado de `details`
  - `cellSource` renderizado via `renderCodeCell`
  - células markdown definem hint de linguagem `markdown`; outras células não possuem override de linguagem explícito
  - limite de preview de código recolhido é `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - suporta modo expandido via opções de renderização compartilhadas
  - usa cache de renderização com chave por largura + estado expandido

Premissa de renderização de erros:

- se o primeiro conteúdo textual começa com `Error:`, o renderer formata como bloco de erro de notebook.

## Renderer Python (para saída de execução real)

A renderização de execução suportada por kernel espera:

- transições de status por célula (`pending/running/complete/error`)
- seção de evento de status estruturado opcional
- árvores de saída JSON opcionais
- avisos de truncagem + ponteiro `artifact://<id>` opcional

Esse comportamento do renderer não tem relação com os resultados de edição JSON do `notebook`, exceto pelo fato de ambos reutilizarem primitivas TUI compartilhadas.

## 8) Divergência do comportamento da ferramenta Python simples

Se "ferramenta Python simples" significa o caminho de execução `python`:

- `python` executa código em um kernel, persiste estado por modo, faz streaming de chunks, captura displays ricos, lida com interrupções/timeouts e suporta truncagem de saída/artefatos.
- `notebook` realiza apenas mutações determinísticas no JSON do notebook; sem execução, sem estado de kernel, sem stream de chunks, sem saídas de display, sem pipeline de artefatos.

Se um fluxo de trabalho necessitar de ambos:

1. editar o source do notebook com `notebook`
2. executar células de código via `python` (passando o código manualmente), não por meio do `notebook`

A implementação atual não fornece uma única ferramenta que tanto mute o `.ipynb` quanto execute células do notebook através do contexto de kernel.
