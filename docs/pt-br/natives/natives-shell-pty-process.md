---
title: 'Internos de Shell, PTY, Processos e Teclas Nativos'
description: >-
  Execução de shell, gerenciamento de PTY, ciclo de vida de processos e
  tratamento de eventos de tecla na camada nativa.
sidebar:
  order: 4
  label: 'Shell, PTY e processos'
i18n:
  sourceHash: 286fe5a58bfc
  translator: machine
---

# Internos de Shell, PTY, Processos e Teclas Nativos

Este documento cobre as **primitivas de execução/processo/terminal** em `@f5xc-salesdemos/pi-natives`: `shell`, `pty`, `ps` e `keys`, utilizando os termos de arquitetura de `docs/natives-architecture.md`.

## Arquivos de implementação

- `crates/pi-natives/src/shell.rs`
- `crates/pi-natives/src/shell/windows.rs` (somente Windows)
- `crates/pi-natives/src/pty.rs`
- `crates/pi-natives/src/ps.rs`
- `crates/pi-natives/src/keys.rs`
- `crates/pi-natives/src/task.rs` (comportamento de cancelamento compartilhado usado por shell/pty)
- `packages/natives/src/shell/index.ts`
- `packages/natives/src/shell/types.ts`
- `packages/natives/src/pty/index.ts`
- `packages/natives/src/pty/types.ts`
- `packages/natives/src/ps/index.ts`
- `packages/natives/src/ps/types.ts`
- `packages/natives/src/keys/index.ts`
- `packages/natives/src/keys/types.ts`
- `packages/natives/src/bindings.ts`

## Responsabilidade das camadas

- **Camada de wrapper/API TS** (`packages/natives/src/*`): pontos de entrada tipados, superfície de cancelamento (`timeoutMs`, `AbortSignal`) e ergonomia JS.
- **Camada de módulo Rust N-API** (`crates/pi-natives/src/*`): execução de processos shell/PTY, travessia/terminação de árvore de processos e análise de sequências de teclas.
- **Portão de validação** (`native.ts`, nível de arquitetura): garante que as exportações necessárias (`Shell`, `executeShell`, `PtySession`, `killTree`, `listDescendants`, helpers de teclas) existam antes que os wrappers sejam utilizados.

## Subsistema Shell (`shell`)

### Modelo de API

Dois modos de execução são expostos:

1. **Execução única** via `executeShell(options, onChunk?)`.
2. **Sessão persistente** via `new Shell(options?)` e depois `shell.run(...)` repetidamente.

Ambos transmitem a saída através de um callback threadsafe e retornam `{ exitCode?, cancelled, timedOut }`.

### Criação de sessão e modelo de ambiente

O Rust cria `brush_core::Shell` com:

- modo não interativo,
- `do_not_inherit_env: true`,
- reconstrução explícita do ambiente a partir do env do host,
- lista de exclusão para variáveis sensíveis ao shell (`PS1`, `PWD`, `SHLVL`, exportações de funções bash, etc.).

Comportamento do ambiente de sessão:

- `ShellOptions.sessionEnv` é aplicado uma vez na criação da sessão.
- `ShellRunOptions.env` tem escopo de comando (`EnvironmentScope::Command`) e é removido após cada execução.
- `PATH` é mesclado de forma especial no Windows com deduplicação case-insensitive.

Enriquecimento de caminhos exclusivo do Windows (`shell/windows.rs`): caminhos descobertos do Git-for-Windows (`cmd`, `bin`, `usr/bin`) são adicionados se presentes e não já incluídos.

### Ciclo de vida de execução e transições de estado

O shell persistente (`Shell.run`) utiliza esta máquina de estados:

- **Ocioso/Não inicializado**: `session: None`.
- **Em execução**: o primeiro `run()` cria a sessão preguiçosamente, armazena o token `current_abort`, executa o comando.
- **Concluído + keepalive**: se o fluxo de controle da execução é `Normal`, `current_abort` é limpo e a sessão é reutilizada.
- **Concluído + teardown**: se o fluxo de controle é relacionado a loop/script/saída do shell (`BreakLoop`, `ContinueLoop`, `ReturnFromFunctionOrScript`, `ExitShell`), a sessão é descartada (`session: None`).
- **Cancelado/Tempo esgotado**: a tarefa de execução é cancelada, espera de cortesia (2s), depois aborto forçado; a sessão é descartada.
- **Erro**: a sessão é descartada.

O shell de execução única (`executeShell`) sempre cria e descarta uma sessão nova por chamada.

### Comportamento de streaming/saída

- Stdout/stderr são roteados para um pipe compartilhado e lidos concorrentemente.
- O leitor decodifica UTF-8 incrementalmente; sequências de bytes inválidas emitem chunks de substituição `U+FFFD`.
- Após a conclusão do processo, a drenagem de saída tem guardas de ociosidade/máximo (`250ms` de ociosidade, `2s` máximo) para evitar travamento em jobs em segundo plano mantendo descritores abertos.

### Cancelamento, timeout e jobs em segundo plano

- `CancelToken` é construído a partir de `timeoutMs` e `AbortSignal` opcional.
- No cancelamento/timeout, o token de cancelamento do shell é acionado, depois a tarefa recebe uma janela de cortesia de 2s antes do aborto forçado.
- Se o cancelamento ocorrer, jobs em segundo plano são terminados (`TERM`, depois `KILL` com atraso) usando metadados de jobs do brush.

Comportamento de `Shell.abort()`:

- aborta apenas o comando em execução atual para aquela instância de `Shell`,
- sucesso sem operação quando nada está em execução.

### Comportamento de falha

Erros comuns expostos incluem:

- falhas na inicialização da sessão (`Failed to initialize shell`),
- erros de cwd (`Failed to set cwd`),
- falhas ao definir/remover env,
- falhas de source de snapshot,
- falhas na criação/clonagem de pipe,
- falha de execução (`Shell execution failed: ...`),
- falhas do wrapper de tarefa (`Shell execution task failed: ...`).

Flags de cancelamento no nível do resultado:

- timeout -> `exitCode: undefined`, `timedOut: true`.
- sinal de aborto -> `exitCode: undefined`, `cancelled: true`.

## Subsistema PTY (`pty`)

### Modelo de API

`new PtySession()` expõe:

- `start(options, onChunk?) -> Promise<{ exitCode?, cancelled, timedOut }>`
- `write(data)`
- `resize(cols, rows)`
- `kill()`

### Ciclo de vida de execução e transições de estado

Máquina de estados de `PtySession`:

- **Ocioso**: `core: None`.
- **Reservado**: `start()` instala o canal de controle sincronamente (`core: Some`) antes do trabalho assíncrono iniciar, então `write/resize/kill` se tornam imediatamente válidos.
- **Em execução**: o loop bloqueante do PTY trata o estado do processo filho, eventos do leitor, heartbeat de cancelamento e mensagens de controle.
- **Terminal fechado**: saída do processo filho + conclusão do leitor.
- **Finalizado**: `core` é sempre redefinido para `None` após a conclusão da tarefa de start (sucesso ou erro).

Guarda de concorrência:

- iniciar enquanto já está em execução retorna `PTY session already running`.

### Padrões de spawn/attach/write/read/terminate

- PTY aberto via `portable_pty::native_pty_system().openpty(...)`.
- O comando atualmente executa como `sh -lc <command>` com `cwd` opcional e substituições de env.
- `write()` envia bytes brutos para o stdin do PTY.
- `resize()` limita as dimensões (`cols 20..400`, `rows 5..200`) e chama o resize do master.
- `kill()` marca a execução como cancelada e mata o processo filho.

Caminho de saída:

- thread de leitura dedicada lê o stream master,
- decodificação incremental de UTF-8 com substituição `U+FFFD` em bytes inválidos,
- chunks encaminhados através de callback threadsafe N-API.

### Semântica de cancelamento e timeout

- `timeoutMs` e `AbortSignal` alimentam um `CancelToken`.
- O loop chama `ct.heartbeat()` periodicamente; o aborto aciona a morte do processo filho.
- A classificação de timeout é baseada em string (substring `"Timeout"` no erro de heartbeat).

### Comportamento de falha

Superfícies de erro incluem:

- falha na alocação/abertura do PTY,
- falha no spawn do PTY,
- falha na aquisição do writer/reader,
- falhas no status/espera do processo filho,
- envenenamento de lock,
- desconexão do canal de controle (`PTY session is no longer available`).

Falhas em chamadas de controle quando não está em execução:

- `write/resize/kill` retornam `PTY session is not running`.

## Subsistema de árvore de processos (`ps`)

### Modelo de API

- `killTree(pid, signal) -> number`
- `listDescendants(pid) -> number[]`

O wrapper TS também registra a integração nativa de kill-tree nos utilitários compartilhados via `setNativeKillTree(native.killTree)`.

### Implementação específica por plataforma

- **Linux**: lê recursivamente `/proc/<pid>/task/<pid>/children`.
- **macOS**: usa `libproc` `proc_listchildpids`.
- **Windows**: captura snapshot da tabela de processos com `CreateToolhelp32Snapshot`, constrói mapa pai->filhos, termina com `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`.

### Comportamento do kill-tree

- Descendentes são coletados recursivamente.
- A ordem de kill é de baixo para cima (descendentes mais profundos primeiro) para reduzir re-atribuição de órfãos.
- O pid raiz é morto por último.
- O valor de retorno é a contagem de terminações bem-sucedidas.

Comportamento de sinal:

- POSIX: o `signal` fornecido é passado para `kill`.
- Windows: `signal` é ignorado; a terminação é um encerramento incondicional do processo.

### Comportamento de falha

Este módulo é intencionalmente não-lançador na superfície da API:

- ramos de árvore de processos ausentes/inacessíveis são ignorados,
- falhas de kill por pid são contadas como não bem-sucedidas (não erros),
- busca sem resultado tipicamente retorna `[]` de `listDescendants` e `0` de `killTree`.

## Subsistema de análise de teclas (`keys`)

### Modelo de API

Helpers expostos:

- `parseKey(data, kittyProtocolActive)`
- `matchesKey(data, keyId, kittyProtocolActive)`
- `parseKittySequence(data)`
- `matchesKittySequence(data, expectedCodepoint, expectedModifier)`
- `matchesLegacySequence(data, keyName)`

### Modelo de análise

O parser combina:

- mapeamentos diretos de byte único (`enter`, `tab`, `ctrl+<letra>`, ASCII imprimível),
- busca O(1) de sequência de escape legada (mapa PHF),
- análise de `modifyOtherKeys` do xterm,
- análise do protocolo Kitty (`CSI u`, `CSI ~`, `CSI 1;...<letra>`),
- normalização para IDs de tecla (`ctrl+c`, `shift+tab`, `pageUp`, `f5`, etc.).

Tratamento de modificadores:

- apenas os bits de shift/alt/ctrl são comparados para correspondência de teclas,
- bits de lock são mascarados antes das comparações.

Comportamento de layout:

- o fallback de layout base é intencionalmente restrito para que layouts remapeados não criem correspondências falsas para letras/símbolos ASCII.

### Comportamento de falha

- Sequências não reconhecidas ou inválidas produzem `null` das funções de análise.
- Funções de correspondência retornam `false` em falha de análise ou incompatibilidade.
- Nenhuma superfície de erro lançado para entrada de tecla malformada.

## Mapeamento API wrapper JS ↔ exportação Rust

### Shell + PTY + Processos

| API wrapper TS | Exportação Rust N-API | Notas |
|---|---|---|
| `executeShell(options, onChunk?)` | `executeShell` (`execute_shell`) | Execução de shell única |
| `new Shell(options?)` | classe `Shell` | Sessão de shell persistente |
| `shell.run(options, onChunk?)` | `Shell::run` | Reutiliza sessão no fluxo de controle keepalive |
| `shell.abort()` | `Shell::abort` | Aborta a execução ativa para aquela instância de shell |
| `new PtySession()` | classe `PtySession` | Sessão PTY com estado |
| `pty.start(options, onChunk?)` | `PtySession::start` | Execução PTY interativa |
| `pty.write(data)` | `PtySession::write` | Passagem direta de stdin bruto |
| `pty.resize(cols, rows)` | `PtySession::resize` | Dimensões do terminal com limites |
| `pty.kill()` | `PtySession::kill` | Mata forçadamente o processo filho PTY ativo |
| `killTree(pid, signal)` | `killTree` (`kill_tree`) | Terminação de árvore de processos filhos-primeiro |
| `listDescendants(pid)` | `listDescendants` (`list_descendants`) | Listagem recursiva de descendentes |

### Teclas

| API wrapper TS | Exportação Rust N-API | Notas |
|---|---|---|
| `matchesKittySequence(data, cp, mod)` | `matchesKittySequence` (`matches_kitty_sequence`) | Correspondência de codepoint+modificador Kitty |
| `parseKey(data, kittyProtocolActive)` | `parseKey` (`parse_key`) | Parser de ID de tecla normalizado |
| `matchesLegacySequence(data, keyName)` | `matchesLegacySequence` (`matches_legacy_sequence`) | Verificação exata no mapa de sequências legadas |
| `parseKittySequence(data)` | `parseKittySequence` (`parse_kitty_sequence`) | Resultado estruturado de análise Kitty |
| `matchesKey(data, keyId, kittyProtocolActive)` | `matchesKey` (`matches_key`) | Correspondência de tecla de alto nível |

## Notas sobre limpeza de sessões abandonadas e finalização

- **Sessão persistente de Shell**: se uma execução é cancelada/tempo esgotado/erro/fluxo de controle não-keepalive, o Rust descarta explicitamente o estado interno da sessão. Execuções normais bem-sucedidas mantêm a sessão para reutilização.
- **Sessão PTY**: `core` é sempre limpo após `start()` terminar, incluindo caminhos de falha.
- **Nenhum contrato explícito de kill dirigido por finalizador JS** é exposto pelos wrappers; a limpeza está primariamente vinculada aos caminhos de conclusão/cancelamento da execução. Os chamadores devem usar `timeoutMs`, `AbortSignal`, `shell.abort()` ou `pty.kill()` para teardown determinístico.
