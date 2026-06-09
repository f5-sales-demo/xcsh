---
title: Execução e Cancelamento de Tarefas Nativas em Rust
description: >-
  Modelo de execução de tarefas assíncronas em Rust com cancelamento cooperativo
  e semântica de limpeza.
sidebar:
  order: 5
  label: Cancelamento de tarefas
i18n:
  sourceHash: 0fbf45c6d463
  translator: machine
---

# Execução e cancelamento de tarefas nativas em Rust (`pi-natives`)

Este documento descreve como `crates/pi-natives` agenda trabalho nativo e como o cancelamento flui das opções JS (`timeoutMs`, `AbortSignal`) para a execução em Rust.

## Arquivos de implementação

- `crates/pi-natives/src/task.rs`
- `crates/pi-natives/src/grep.rs`
- `crates/pi-natives/src/glob.rs`
- `crates/pi-natives/src/fd.rs`
- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/html.rs`
- `crates/pi-natives/src/image.rs`
- `crates/pi-natives/src/clipboard.rs`
- `crates/pi-natives/src/text.rs`
- `crates/pi-natives/src/ps.rs`

## Primitivas centrais (`task.rs`)

`task.rs` define três peças centrais:

1. `task::blocking(tag, cancel_token, work)`
   - Encapsula `napi::AsyncTask` / `Task`.
   - `compute()` executa em threads de trabalho do libuv (para chamadas de sistema bloqueantes/síncronas ou intensivas em CPU).
   - Retorna uma JS `Promise<T>`.

2. `task::future(env, tag, work)`
   - Encapsula `env.spawn_future(...)`.
   - Executa trabalho assíncrono no runtime Tokio.
   - Retorna `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combina deadline + `AbortSignal` opcional.
   - `CancelToken::heartbeat()` é o cancelamento cooperativo para loops bloqueantes.
   - `CancelToken::wait()` é a espera de cancelamento assíncrono (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permite que código externo solicite abort (`abort(reason)`).

## `blocking` vs `future`: modelo de execução e seleção

### Use `task::blocking`

Use quando o trabalho é intensivo em CPU ou fundamentalmente síncrono/bloqueante:

- varredura de regex/arquivos (`grep`, `glob`, `fuzzy_find`)
- internos do loop síncrono de PTY (`run_pty_sync` via `spawn_blocking`)
- conversões de clipboard/imagem/html

Comportamento:

- A closure de trabalho recebe um `CancelToken` clonado.
- O cancelamento só é observado onde o código verifica `ct.heartbeat()?`.
- `Err(...)` na closure rejeita a promise JS.

### Use `task::future`

Use quando o trabalho precisa fazer `await` em operações assíncronas:

- orquestração de sessão shell (`shell.run`, `executeShell`)
- corrida de tarefas (`tokio::select!`) entre conclusão e cancelamento

Comportamento:

- O future pode fazer corrida entre conclusão normal e `ct.wait()`.
- No caminho de cancelamento, implementações assíncronas tipicamente propagam o cancelamento para subsistemas internos (ex.: `tokio_util::CancellationToken`) e opcionalmente forçam abort após tempo de tolerância.

## Mapeamento API JS ↔ exportação Rust (relevante para task/cancel)

| API voltada ao JS | Exportação Rust (`#[napi]`) | Agendador | Conexão de cancelamento |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` no loop de filtro |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` no loop de pontuação |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` em corrida contra a tarefa de execução; faz ponte com Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | mesmo que acima |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interno | `CancelToken` verificado no loop síncrono de PTY via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | nenhum (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | nenhum (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | nenhum (token `()`) |

`text.rs` e `ps.rs` atualmente não usam `task::blocking`/`task::future` e portanto não participam deste caminho de cancelamento.

## Ciclo de vida do cancelamento e transições de estado

### Ciclo de vida do `CancelToken`

`CancelToken` é cooperativo e com estado:

```text
Created
  ├─ no signal + no timeout  -> passive token (never aborts unless externally emplaced)
  ├─ signal registered        -> waits for AbortSignal callback
  └─ deadline set             -> timeout check becomes active

Running
  ├─ heartbeat()/wait() sees signal   -> AbortReason::Signal
  ├─ heartbeat()/wait() sees deadline -> AbortReason::Timeout
  ├─ wait() sees Ctrl-C               -> AbortReason::User
  └─ no abort                         -> continue

Aborted (terminal)
  └─ first abort reason wins (atomic flag + notifier)
```

### Cancelamento antes do início vs durante a execução

- **Antes do início / antes da primeira verificação de cancelamento**:
  - Usuários de `task::future` que fazem corrida em `ct.wait()` podem resolver o cancelamento imediatamente após entrarem no `select!`.
  - Usuários de `task::blocking` só observam o cancelamento quando o código da closure alcança `heartbeat()`. Se a closure não fizer heartbeat cedo, o cancelamento é atrasado.

- **Durante a execução**:
  - `blocking`: o próximo `heartbeat()` retorna `Err("Aborted: ...")`.
  - `future`: o branch `ct.wait()` vence o `select!`, então o código cancela a maquinaria assíncrona subordinada (para shell: cancela o token Tokio, aguarda até 2s, então aborta a tarefa).

## Expectativas de heartbeat para loops de longa duração

`heartbeat()` deve executar em cadência previsível em loops com conjuntos de trabalho ilimitados ou grandes.

Padrões observados:

- `glob::filter_entries`: verifica cada entrada antes de filtrar/corresponder.
- `fd::score_entries`: verifica cada candidato varrido.
- `grep_sync`: verificação explícita de cancelamento antes da fase pesada de busca, além de chamadas de cache de sistema de arquivos que também recebem o token.
- `run_pty_sync`: verifica a cada tick do loop (~16ms de cadência de sleep) e mata o processo filho ao cancelar.

Regra prática: nenhum loop sobre entrada de tamanho externo deve exceder um intervalo curto limitado sem um heartbeat.

## Comportamento de falha e propagação de erros para JS

### Tarefas bloqueantes

Caminho de erro:

1. A closure retorna `Err(napi::Error)` (incluindo abort do `heartbeat()`).
2. `Task::compute()` retorna `Err`.
3. `AsyncTask` rejeita a promise JS.

Strings de erro típicas:

- `Aborted: Timeout`
- `Aborted: Signal`
- erros de domínio (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tarefas future

Caminho de erro:

1. O corpo assíncrono retorna `Err(napi::Error)` ou falha de join é mapeada (`... task failed: {err}`).
2. A promise criada por `task::future` rejeita.
3. Algumas APIs intencionalmente retornam resultados estruturados de cancelamento em vez de rejeição (`ShellRunResult`/`ShellExecuteResult` com flags `cancelled`/`timed_out` e `exit_code: None`).

### Divisão de reporte de cancelamento

- **Abort como erro**: maioria das exportações bloqueantes usando `heartbeat()?`.
- **Abort como resultado tipado**: APIs estilo shell/pty que modelam cancelamento em structs de resultado.

Escolha um modelo por API e documente-o explicitamente.

## Armadilhas comuns

1. **Heartbeat ausente em loops bloqueantes**
   - Sintoma: timeout/signal parece ser ignorado até o loop terminar.
   - Correção: adicione `ct.heartbeat()?` no topo do loop e antes de passos caros por item.

2. **Seções longas não canceláveis**
   - Sintoma: picos de latência de cancelamento durante uma única chamada grande (decode, sort, compressão, etc.).
   - Correção: divida o trabalho em blocos com fronteiras de heartbeat; se impossível, documente a latência.

3. **Bloqueando o executor assíncrono**
   - Sintoma: API assíncrona trava quando código pesado em sync executa diretamente no future.
   - Correção: mova blocos CPU/sync para `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Semântica de cancelamento inconsistente**
   - Sintoma: uma API rejeita ao cancelar, outra resolve com flags, confundindo os chamadores.
   - Correção: padronize por domínio e mantenha a documentação dos wrappers alinhada.

5. **Esquecendo a ponte de cancelamento em tarefas assíncronas aninhadas**
   - Sintoma: token externo é cancelado, mas tarefas internas de leitura/subprocesso continuam executando.
   - Correção: faça a ponte do cancelamento para o token/signal interno e aplique tempo de tolerância + fallback de abort forçado.

## Checklist para novas exportações canceláveis

1. Classifique o trabalho corretamente:
   - Intensivo em CPU ou bloqueio síncrono -> `task::blocking`
   - I/O assíncrono / orquestração com `await` -> `task::future`

2. Exponha entradas de cancelamento quando necessário:
   - inclua `timeoutMs` e `signal` nas options do `#[napi(object)]`
   - crie `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Propague o cancelamento por todas as camadas:
   - loops bloqueantes: `ct.heartbeat()?` em intervalos estáveis
   - orquestração assíncrona: faça corrida com `ct.wait()` e cancele sub-tarefas/tokens

4. Decida o contrato de cancelamento:
   - rejeitar promise com erro de abort, ou
   - resolver com tipo `{ cancelled, timedOut, ... }`
   - mantenha esse contrato consistente para a família de APIs

5. Propague falhas com contexto:
   - mapeie erros via `Error::from_reason(format!("...: {err}"))`
   - inclua prefixos específicos de estágio (`spawn`, `decode`, `wait`, etc.)

6. Trate cancelamento antes do início e durante a execução:
   - verificação/await de cancelamento deve acontecer antes do corpo custoso e durante a execução longa

7. Valide que não há uso incorreto do executor:
   - nenhum trabalho síncrono longo diretamente dentro de futures assíncronos sem `spawn_blocking`/wrapper de tarefa bloqueante
