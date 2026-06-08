---
title: Notebook Tool Runtime Internals
description: >-
  Jupyter notebook tool runtime with cell execution, kernel lifecycle, and
  output rendering.
sidebar:
  order: 2
  label: Notebook tool
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Internos do runtime da ferramenta notebook

Este documento descreve a implementação atual da ferramenta `notebook` e sua relação com o runtime Python apoiado por kernel.

A distinção crítica: **`notebook` é um editor JSON de notebooks, não um executor de notebooks**. Ele edita diretamente as fontes de células `.ipynb`; ele não inicia nem se comunica com um kernel Python.

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
- Carrega o JSON do notebook, valida o array `cells`, valida os limites de `cell_index`.
- Aplica edições de fonte em memória e escreve o JSON completo do notebook de volta com `JSON.stringify(notebook, null, 1)`.
- Retorna resumo textual + `details` estruturado (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Nenhum ciclo de vida de kernel existe nesta ferramenta:

- nenhuma aquisição de gateway
- nenhum ID de sessão de kernel
- nenhum `execute_request`
- nenhum chunk de stream dos canais do kernel
- nenhuma captura de exibição rica (`image/png`, exibição JSON, MIME de status)

## Caminho de execução estilo notebook (`src/tools/python.ts` + `src/ipy/*`)

Quando o agente precisa executar código Python estilo célula (células sequenciais, estado persistente, exibições ricas), isso passa pela **ferramenta `python`**, não pela `notebook`.

Esse caminho é onde vivem os modos de kernel, comportamento de reinício/cancelamento, streaming de chunks e truncamento de artefatos de saída.

## 2) Semânticas de manipulação de células do notebook (ferramenta `notebook`)

## Normalização de fonte

`content` é dividido em `source: string[]` com preservação de quebras de linha:

- cada linha não-final mantém o `\n` final
- a linha final não tem quebra de linha final forçada

Isso espelha as convenções de JSON de notebook e evita concatenação acidental de linhas em edições posteriores.

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
  - retorna o `source` removido nos detalhes para preview do renderizador

## Superfícies de erro

Falhas críticas são lançadas para:

- arquivo de notebook ausente
- JSON inválido
- `cells` ausente/não-array
- índice fora do intervalo (insert e não-insert têm intervalos válidos diferentes)
- `content` ausente para `edit`/`insert`

Estas se tornam respostas de ferramenta `Error:` no upstream; o renderizador usa o caminho do notebook + texto de erro formatado.

## 3) Semânticas de sessão do kernel (onde elas realmente existem)

As semânticas de kernel são implementadas em `executePython` / `PythonKernel` e se aplicam à ferramenta `python`.

## Modos

`PythonKernelMode`:

- `session` (padrão)
  - kernels cacheados no mapa `kernelSessions`
  - máximo de 4 sessões; a mais antiga é despejada no overflow
  - limpeza de inativos/mortos a cada 30s, timeout após 5 minutos
  - fila por sessão serializa a execução (`session.queue`)
- `per-call`
  - cria kernel para a requisição
  - executa
  - sempre desliga o kernel no `finally`

## Comportamento de reset

A ferramenta `python` passa `reset` apenas para a primeira célula em uma chamada multi-célula; células posteriores sempre executam com `reset: false`.

## Morte / reinício / nova tentativa do kernel

No modo sessão (`withKernelSession`):

- kernel morto detectado por heartbeat (verificação `kernel.isAlive()` a cada 5s) ou falha de execução.
- estado morto pré-execução aciona `restartKernelSession`.
- caminho de crash em tempo de execução tenta novamente uma vez: reinicia o kernel, reexecuta o handler.
- `restartCount > 1` na mesma sessão lança `Python kernel restarted too many times in this session`.

Comportamento de nova tentativa na inicialização:

- criação de kernel de gateway compartilhado tenta novamente uma vez em `SharedGatewayCreateError` com HTTP 5xx.

Recuperação de esgotamento de recursos:

- detecta falhas estilo `EMFILE`/`ENFILE`/"Too many open files"
- limpa sessões rastreadas
- chama `shutdownSharedGateway()`
- tenta criar a sessão do kernel novamente uma vez

## 4) Injeção de variáveis de ambiente/sessão

A inicialização do kernel recebe mapa opcional de env do executor:

- `PI_SESSION_FILE` (caminho do arquivo de estado da sessão)
- `ARTIFACTS` (diretório de artefatos)

`PythonKernel.#initializeKernelEnvironment(...)` então executa script de inicialização dentro do kernel para:

- `os.chdir(cwd)`
- injetar entradas de env em `os.environ`
- adicionar cwd ao início de `sys.path` se ausente

Implicação:

- helpers de prelúdio que leem contexto de sessão ou artefatos dependem dessas variáveis de ambiente no estado do processo Python.

## 5) Tratamento de streaming/chunks e exibição (caminho apoiado por kernel)

O cliente do kernel processa mensagens do protocolo Jupyter por execução:

- `stream` -> chunk de texto para `onChunk`
- `execute_result` / `display_data` ->
  - texto de exibição escolhido por precedência MIME: `text/markdown` > `text/plain` > `text/html` convertido
  - saídas estruturadas capturadas separadamente:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (sem emissão de texto)
- `error` -> texto de traceback enviado ao stream de chunks + metadados de erro estruturados
- `input_request` -> emite texto de aviso de stdin, envia `input_reply` vazio, marca stdin como solicitado
- conclusão aguarda tanto `execute_reply` quanto `status=idle` do kernel

Cancelamento/timeout:

- sinal de abort aciona `interrupt()` (REST `/interrupt` + `interrupt_request` no canal de controle)
- resultado marca `cancelled=true`
- caminho de timeout anota saída com `Command timed out after <n> seconds`

## 6) Comportamento de truncamento e artefatos

`OutputSink` em `src/session/streaming-output.ts` é usado pelos caminhos de execução do kernel (`executeWithKernel`):

- sanitiza cada chunk (`sanitizeText`)
- rastreia total de linhas/saída e bytes
- arquivo de spillover de artefato opcional (`artifactPath`, `artifactId`)
- quando o buffer em memória excede o limiar (`DEFAULT_MAX_BYTES` a menos que sobrescrito):
  - marca como truncado
  - mantém bytes finais em memória (fronteira segura UTF-8)
  - pode fazer spillover do stream completo para o sink de artefatos

`dump()` retorna:

- texto de saída visível (possivelmente truncado no final)
- flag de truncamento + contagens
- ID de artefato (para referências `artifact://<id>`)

A ferramenta `python` converte esses metadados em avisos de truncamento de resultado e avisos da TUI.

A ferramenta `notebook` **não** usa `OutputSink`; ela não possui pipeline de truncamento de stream/artefato porque não executa código.

## 7) Suposições do renderizador e formatação

## Renderizador de notebook (`notebookToolRenderer`)

- visão de chamada: linha de status com ação + caminho do notebook + metadados de célula/tipo
- visão de resultado:
  - resumo de sucesso derivado de `details`
  - `cellSource` renderizado via `renderCodeCell`
  - células markdown definem dica de linguagem `markdown`; outras células não têm override de linguagem explícito
  - limite de preview colapsado é `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - suporta modo expandido via opções de renderização compartilhadas
  - usa cache de renderização indexado por largura + estado expandido

Suposição de renderização de erro:

- se o primeiro conteúdo textual começa com `Error:`, o renderizador formata como bloco de erro de notebook.

## Renderizador Python (para saída de execução real)

A renderização de execução apoiada por kernel espera:

- transições de status por célula (`pending/running/complete/error`)
- seção opcional de evento de status estruturado
- árvores de saída JSON opcionais
- avisos de truncamento + ponteiro `artifact://<id>` opcional

Este comportamento do renderizador não está relacionado aos resultados de edição JSON do `notebook`, exceto que ambos reutilizam primitivas compartilhadas da TUI.

## 8) Divergência do comportamento da ferramenta Python simples

Se "ferramenta Python simples" significa o caminho de execução `python`:

- `python` executa código em um kernel, persiste estado por modo, faz streaming de chunks, captura exibições ricas, trata interrupções/timeouts e suporta truncamento de saída/artefatos.
- `notebook` realiza apenas mutações determinísticas no JSON do notebook; sem execução, sem estado de kernel, sem stream de chunks, sem saídas de exibição, sem pipeline de artefatos.

Se um fluxo de trabalho precisa de ambos:

1. editar fonte do notebook com `notebook`
2. executar células de código via `python` (passando código manualmente), não através de `notebook`

A implementação atual não fornece uma única ferramenta que tanto modifica `.ipynb` quanto executa células do notebook através de contexto de kernel.
