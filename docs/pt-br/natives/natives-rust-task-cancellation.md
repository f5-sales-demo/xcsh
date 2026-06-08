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
   - `compute()` executa em threads de trabalho do libuv (para chamadas de sistema CPU-bound ou bloqueantes/síncronas).
   - Retorna uma JS `Promise<T>`.

2. `task::future(env, tag, work)`
   - Encapsula `env.spawn_future(...)`.
   - Executa trabalho assíncrono no runtime Tokio.
   - Retorna `PromiseRaw<'env, T>`.

3. `CancelToken` / `AbortToken` / `AbortReason`
   - `CancelToken::new(timeout_ms, signal)` combina deadline + `AbortSignal` opcional.
   - `CancelToken::heartbeat()` é cancelamento cooperativo para loops bloqueantes.
   - `CancelToken::wait()` é espera assíncrona de cancelamento (`Signal` / `Timeout` / `User` Ctrl-C).
   - `AbortToken` permite que código externo solicite abort (`abort(reason)`).

## `blocking` vs `future`: modelo de execução e seleção

### Use `task::blocking`

Use quando o trabalho é intensivo em CPU ou fundamentalmente síncrono/bloqueante:

- varredura de regex/arquivos (`grep`, `glob`, `fuzzy_find`)
- internos de loop PTY síncrono (`run_pty_sync` via `spawn_blocking`)
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

- A future pode competir conclusão normal contra `ct.wait()`.
- No caminho de cancelamento, implementações assíncronas tipicamente propagam o cancelamento para subsistemas internos (ex.: `tokio_util::CancellationToken`) e opcionalmente forçam abort após timeout de tolerância.

## Mapeamento API JS ↔ export Rust (relevante para task/cancel)

| API voltada para JS | Export Rust (`#[napi]`) | Agendador | Conexão de cancelamento |
|---|---|---|---|
| `grep(options, onMatch?)` | `grep` | `task::blocking("grep", ct, ...)` | `CancelToken::new(options.timeoutMs, options.signal)` + `ct.heartbeat()` |
| `glob(options, onMatch?)` | `glob` | `task::blocking("glob", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` no loop de filtro |
| `fuzzyFind(options)` | `fuzzy_find` | `task::blocking("fuzzy_find", ct, ...)` | `CancelToken::new(...)` + `ct.heartbeat()` no loop de pontuação |
| `shell.run(options, onChunk?)` | `Shell::run` | `task::future(env, "shell.run", ...)` | `ct.wait()` competindo contra task de execução; faz ponte com Tokio `CancellationToken` |
| `executeShell(options, onChunk?)` | `execute_shell` | `task::future(env, "shell.execute", ...)` | mesmo que acima |
| `pty.start(options, onChunk?)` | `PtySession::start` | `task::future(env, "pty.start", ...)` + `spawn_blocking` interno | `CancelToken` verificado no loop PTY síncrono via `heartbeat()` |
| `htmlToMarkdown(html, options?)` | `html_to_markdown` | `task::blocking("html_to_markdown", (), ...)` | nenhum (token `()`) |
| `PhotonImage.parse/encode/resize` | `PhotonImage::{parse,encode,resize}` | `task::blocking(...)` | nenhum (token `()`) |
| `copyToClipboard/readImageFromClipboard` | `copy_to_clipboard` / `read_image_from_clipboard` | `task::blocking(...)` | nenhum (token `()`) |

`text.rs` e `ps.rs` atualmente não utilizam `task::blocking`/`task::future` e, portanto, não participam deste caminho de cancelamento.

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
  - Usuários de `task::future` que competem em `ct.wait()` podem resolver o cancelamento imediatamente ao entrar no `select!`.
  - Usuários de `task::blocking` só observam o cancelamento quando o código da closure alcança `heartbeat()`. Se a closure não fizer heartbeat cedo, o cancelamento é atrasado.

- **Durante a execução**:
  - `blocking`: o próximo `heartbeat()` retorna `Err("Aborted: ...")`.
  - `future`: o branch `ct.wait()` vence o `select!`, então o código cancela a maquinaria assíncrona subordinada (para shell: cancela o token Tokio, espera até 2s, então aborta a task).

## Expectativas de heartbeat para loops de longa duração

`heartbeat()` deve executar em cadência previsível em loops com conjuntos de trabalho ilimitados ou grandes.

Padrões observados:

- `glob::filter_entries`: verifica cada entrada antes de filtrar/corresponder.
- `fd::score_entries`: verifica cada candidato varrido.
- `grep_sync`: verificação explícita de cancelamento antes da fase pesada de busca, mais chamadas ao fs-cache que também recebem o token.
- `run_pty_sync`: verifica a cada tick do loop (cadência de ~16ms de sleep) e mata o processo filho ao cancelar.

Regra prática: nenhum loop sobre entrada de tamanho externo deve exceder um intervalo curto limitado sem um heartbeat.

## Comportamento de falha e propagação de erros para JS

### Tarefas bloqueantes

Caminho de erro:

1. A closure retorna `Err(napi::Error)` (incluindo abort de `heartbeat()`).
2. `Task::compute()` retorna `Err`.
3. `AsyncTask` rejeita a promise JS.

Strings de erro típicas:

- `Aborted: Timeout`
- `Aborted: Signal`
- erros de domínio (`Failed to decode image: ...`, `Conversion error: ...`, etc.)

### Tarefas future

Caminho de erro:

1. O corpo assíncrono retorna `Err(napi::Error)` ou falha de join é mapeada (`... task failed: {err}`).
2. A promise gerada por `task::future` rejeita.
3. Algumas APIs intencionalmente retornam resultados de cancelamento estruturados em vez de rejeição (`ShellRunResult`/`ShellExecuteResult` com flags `cancelled`/`timed_out` e `exit_code: None`).

### Divisão de reporte de cancelamento

- **Abort como erro**: a maioria dos exports bloqueantes usando `heartbeat()?`.
- **Abort como resultado tipado**: APIs estilo shell/pty de comando que modelam cancelamento em structs de resultado.

Escolha um modelo por API e documente-o explicitamente.

## Armadilhas comuns

1. **Heartbeat ausente em loops bloqueantes**
   - Sintoma: timeout/signal parece ser ignorado até o loop terminar.
   - Correção: adicione `ct.heartbeat()?` no topo do loop e antes de passos caros por item.

2. **Seções longas não-canceláveis**
   - Sintoma: picos de latência de cancelamento durante uma única chamada grande (decode, sort, compressão, etc.).
   - Correção: divida o trabalho em pedaços com limites de heartbeat; se impossível, documente a latência.

3. **Bloqueando o executor assíncrono**
   - Sintoma: API assíncrona trava quando código pesado de sync executa diretamente na future.
   - Correção: mova blocos CPU/sync para `task::blocking` ou `tokio::task::spawn_blocking`.

4. **Semântica de cancelamento inconsistente**
   - Sintoma: uma API rejeita no cancelamento, outra resolve com flags, confundindo os chamadores.
   - Correção: padronize por domínio e mantenha os docs dos wrappers alinhados.

5. **Esquecendo a ponte de cancelamento em tarefas assíncronas aninhadas**
   - Sintoma: token externo é cancelado mas tasks internas de leitura/subprocesso continuam executando.
   - Correção: faça ponte do cancelamento para o token/signal interno e aplique timeout de tolerância + fallback de abort forçado.

## Checklist para novos exports canceláveis

1. Classifique o trabalho corretamente:
   - CPU-bound ou bloqueante síncrono -> `task::blocking`
   - I/O assíncrono / orquestração com `await` -> `task::future`

2. Exponha entradas de cancelamento quando necessário:
   - inclua `timeoutMs` e `signal` nas options `#[napi(object)]`
   - crie `let ct = task::CancelToken::new(timeout_ms, signal);`

3. Conecte o cancelamento por todas as camadas:
   - loops bloqueantes: `ct.heartbeat()?` em intervalos estáveis
   - orquestração assíncrona: compita com `ct.wait()` e cancele sub-tasks/tokens

4. Decida o contrato de cancelamento:
   - rejeitar a promise com erro de abort, ou
   - resolver com resultado tipado `{ cancelled, timedOut, ... }`
   - mantenha este contrato consistente para a família de APIs

5. Propague falhas com contexto:
   - mapeie erros via `Error::from_reason(format!("...: {err}"))`
   - inclua prefixos específicos de estágio (`spawn`, `decode`, `wait`, etc.)

6. Trate cancelamento antes do início e durante a execução:
   - verificação/await de cancelamento deve acontecer antes do corpo custoso e durante execução longa

7. Valide que não há uso indevido do executor:
   - nenhum trabalho síncrono longo diretamente dentro de futures assíncronas sem wrapper `spawn_blocking`/blocking task
