---
title: Componentes Internos do Runtime da Ferramenta Notebook
description: >-
  Runtime da ferramenta de notebook Jupyter com execução de células, ciclo de
  vida do kernel e renderização de saída.
sidebar:
  order: 2
  label: Ferramenta Notebook
i18n:
  sourceHash: c1bafcb245e4
  translator: machine
---

# Componentes internos do runtime da ferramenta Notebook

Este documento descreve a implementação atual da ferramenta `notebook` e sua relação com o runtime Python suportado por kernel.

A distinção crítica: **`notebook` é um editor JSON de notebooks, não um executor de notebooks**. Ela edita os fontes das células de arquivos `.ipynb` diretamente; não inicia nem se comunica com um kernel Python.

## Arquivos de implementação

- [`src/tools/notebook.ts`](../../packages/coding-agent/src/tools/notebook.ts)
- [`src/ipy/executor.ts`](../../packages/coding-agent/src/ipy/executor.ts)
- [`src/ipy/kernel.ts`](../../packages/coding-agent/src/ipy/kernel.ts)
- [`src/session/streaming-output.ts`](../../packages/coding-agent/src/session/streaming-output.ts)
- [`src/tools/python.ts`](../../packages/coding-agent/src/tools/python.ts)

## 1) Fronteira do runtime: edição vs. execução

## Ferramenta `notebook` (`src/tools/notebook.ts`)

- Suporta `action: edit | insert | delete` em um arquivo `.ipynb`.
- Resolve o caminho relativo ao CWD da sessão (`resolveToCwd`).
- Carrega o JSON do notebook, valida o array `cells`, valida os limites de `cell_index`.
- Aplica edições de fonte na memória e grava o JSON completo do notebook de volta com `JSON.stringify(notebook, null, 1)`.
- Retorna resumo textual + `details` estruturado (`action`, `cellIndex`, `cellType`, `totalCells`, `cellSource`).

Não existe ciclo de vida de kernel nesta ferramenta:

- nenhuma aquisição de gateway
- nenhum ID de sessão de kernel
- nenhum `execute_request`
- nenhum fragmento de stream proveniente de canais do kernel
- nenhuma captura de exibição rica (`image/png`, exibição JSON, status MIME)

## Caminho de execução similar a notebook (`src/tools/python.ts` + `src/ipy/*`)

Quando o agente precisa executar código Python no estilo de célula (células sequenciais, estado persistente, exibições ricas), isso passa pela ferramenta **`python`**, não pela `notebook`.

É nesse caminho que residem os modos de kernel, o comportamento de reinicialização/cancelamento, o streaming de fragmentos e o truncamento de artefatos de saída.

## 2) Semânticas de tratamento de células do notebook (ferramenta `notebook`)

## Normalização de fonte

`content` é dividido em `source: string[]` com preservação de quebras de linha:

- cada linha não-final mantém o `\n` ao final
- a linha final não tem quebra de linha forçada ao final

Isso espelha as convenções do JSON de notebooks e evita concatenação acidental de linhas em edições posteriores.

## Comportamento das ações

- `edit`
  - substitui `cells[cell_index].source`
  - preserva o `cell_type` existente
- `insert`
  - insere em `[0..cellCount]`
  - `cell_type` tem como padrão `code`
  - células de código inicializam `execution_count: null` e `outputs: []`
  - células markdown inicializam apenas `metadata` + `source`
- `delete`
  - remove `cells[cell_index]`
  - retorna o `source` removido em details para preview do renderizador

## Superfícies de erro

Falhas críticas são lançadas para:

- arquivo de notebook ausente
- JSON inválido
- `cells` ausente ou não-array
- índice fora do intervalo (inserção e não-inserção têm intervalos válidos diferentes)
- `content` ausente para `edit`/`insert`

Esses erros se tornam respostas de ferramenta `Error:` na camada superior; o renderizador usa o caminho do notebook + texto de erro formatado.

## 3) Semânticas de sessão de kernel (onde elas realmente existem)

As semânticas de kernel são implementadas em `executePython` / `PythonKernel` e se aplicam à ferramenta `python`.

## Modos

`PythonKernelMode`:

- `session` (padrão)
  - kernels armazenados em cache no mapa `kernelSessions`
  - máximo de 4 sessões; a mais antiga é removida ao ultrapassar o limite
  - limpeza de sessões ociosas/mortas a cada 30s, timeout após 5 minutos
  - fila por sessão serializa a execução (`session.queue`)
- `per-call`
  - cria kernel para a requisição
  - executa
  - sempre encerra o kernel no bloco `finally`

## Comportamento de reinicialização

A ferramenta `python` passa `reset` apenas para a primeira célula em uma chamada de múltiplas células; células posteriores sempre executam com `reset: false`.

## Morte/reinicialização/nova tentativa do kernel

No modo de sessão (`withKernelSession`):

- kernel morto detectado por heartbeat (verificação `kernel.isAlive()` a cada 5s) ou falha na execução.
- estado morto pré-execução aciona `restartKernelSession`.
- caminho de falha durante execução realiza nova tentativa uma vez: reinicia o kernel, reexecuta o handler.
- `restartCount > 1` na mesma sessão lança `Python kernel restarted too many times in this session`.

Comportamento de nova tentativa na inicialização:

- criação de kernel no gateway compartilhado realiza nova tentativa uma vez em `SharedGatewayCreateError` com HTTP 5xx.

Recuperação por esgotamento de recursos:

- detecta falhas do tipo `EMFILE`/`ENFILE`/"Too many open files"
- limpa as sessões rastreadas
- chama `shutdownSharedGateway()`
- realiza nova tentativa de criação de sessão de kernel uma vez

## 4) Injeção de variáveis de ambiente/sessão

A inicialização do kernel recebe mapa de ambiente opcional do executor:

- `PI_SESSION_FILE` (caminho do arquivo de estado da sessão)
- `ARTIFACTS` (diretório de artefatos)

`PythonKernel.#initializeKernelEnvironment(...)` então executa o script de inicialização dentro do kernel para:

- `os.chdir(cwd)`
- injetar entradas de ambiente em `os.environ`
- adicionar cwd ao início de `sys.path` se ausente

Implicação:

- helpers de prelúdio que leem contexto de sessão ou artefato dependem dessas variáveis de ambiente no estado do processo Python.

## 5) Tratamento de streaming/fragmentos e exibição (caminho com suporte a kernel)

O cliente de kernel processa mensagens do protocolo Jupyter por execução:

- `stream` -> fragmento de texto para `onChunk`
- `execute_result` / `display_data` ->
  - texto de exibição escolhido por precedência de MIME: `text/markdown` > `text/plain` > `text/html` convertido
  - saídas estruturadas capturadas separadamente:
    - `application/json` -> `{ type: "json" }`
    - `image/png` -> `{ type: "image" }`
    - `application/x-xcsh-status` -> `{ type: "status" }` (sem emissão de texto)
- `error` -> texto de traceback enviado ao stream de fragmentos + metadados de erro estruturados
- `input_request` -> emite texto de aviso de stdin, envia `input_reply` vazio, marca stdin como solicitado
- a conclusão aguarda tanto `execute_reply` quanto `status=idle` do kernel

Cancelamento/timeout:

- sinal de cancelamento aciona `interrupt()` (REST `/interrupt` + `interrupt_request` pelo canal de controle)
- resultado marca `cancelled=true`
- caminho de timeout anota a saída com `Command timed out after <n> seconds`

## 6) Comportamento de truncamento e artefatos

`OutputSink` em `src/session/streaming-output.ts` é utilizado pelos caminhos de execução de kernel (`executeWithKernel`):

- sanitiza cada fragmento (`sanitizeText`)
- rastreia total de linhas e bytes de saída
- arquivo de spill de artefato opcional (`artifactPath`, `artifactId`)
- quando o buffer em memória excede o limite (`DEFAULT_MAX_BYTES`, a menos que seja sobrescrito):
  - marca como truncado
  - mantém os bytes finais na memória (limite seguro UTF-8)
  - pode despejar o stream completo para o sink de artefato

`dump()` retorna:

- texto de saída visível (possivelmente truncado ao final)
- flag de truncamento + contagens
- ID do artefato (para referências `artifact://<id>`)

A ferramenta `python` converte esses metadados em avisos de truncamento de resultado e avisos na TUI.

A ferramenta `notebook` **não** utiliza `OutputSink`; ela não possui pipeline de stream/truncamento de artefatos porque não executa código.

## 7) Premissas do renderizador e formatação

## Renderizador de notebook (`notebookToolRenderer`)

- visão de chamada: linha de status com ação + caminho do notebook + metadados de célula/tipo
- visão de resultado:
  - resumo de sucesso derivado de `details`
  - `cellSource` renderizado via `renderCodeCell`
  - células markdown definem dica de linguagem `markdown`; outras células não têm substituição de linguagem explícita
  - limite de preview de código recolhido é `PREVIEW_LIMITS.COLLAPSED_LINES * 2`
  - suporta modo expandido via opções de renderização compartilhadas
  - utiliza cache de renderização com chave por largura + estado expandido

Premissa de renderização de erros:

- se o primeiro conteúdo de texto começa com `Error:`, o renderizador formata como bloco de erro de notebook.

## Renderizador Python (para saída de execução real)

A renderização de execução suportada por kernel espera:

- transições de status por célula (`pending/running/complete/error`)
- seção opcional de evento de status estruturado
- árvores de saída JSON opcionais
- avisos de truncamento + ponteiro opcional `artifact://<id>`

Esse comportamento do renderizador não tem relação com os resultados de edição JSON do `notebook`, exceto pelo fato de que ambos reutilizam primitivas TUI compartilhadas.

## 8) Divergência em relação ao comportamento da ferramenta Python simples

Se "ferramenta Python simples" significa o caminho de execução `python`:

- `python` executa código em um kernel, persiste estado por modo, faz streaming de fragmentos, captura exibições ricas, trata interrupções/timeouts e suporta truncamento de saída/artefatos.
- `notebook` realiza apenas mutações determinísticas de JSON de notebook; sem execução, sem estado de kernel, sem stream de fragmentos, sem saídas de exibição, sem pipeline de artefatos.

Se um fluxo de trabalho necessita de ambos:

1. editar o fonte do notebook com `notebook`
2. executar células de código via `python` (passando o código manualmente), não através do `notebook`

A implementação atual não fornece uma única ferramenta que tanto modifique o `.ipynb` quanto execute células do notebook através do contexto de kernel.
