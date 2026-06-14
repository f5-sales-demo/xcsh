---
title: Ferramenta Python e Runtime IPython
description: >-
  Runtime da ferramenta Python REPL com gerenciamento de kernel IPython,
  execução e captura de saída.
sidebar:
  order: 3
  label: Python & IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Ferramenta Python e Runtime IPython

Este documento descreve a pilha de execução Python atual em `packages/coding-agent`.
Abrange o comportamento da ferramenta, ciclo de vida do kernel/gateway, manipulação de ambiente, semântica de execução, renderização de saída e modos de falha operacional.

## Escopo e Arquivos Principais

- Interface da ferramenta: `src/tools/python.ts`
- Orquestração de kernel por sessão/chamada: `src/ipy/executor.ts`
- Protocolo de kernel + integração com gateway: `src/ipy/kernel.ts`
- Coordenador de gateway local compartilhado: `src/ipy/gateway-coordinator.ts`
- Renderizador de modo interativo para execuções Python iniciadas pelo usuário: `src/modes/components/python-execution.ts`
- Filtragem de runtime/env e resolução do Python: `src/ipy/runtime.ts`

## O que é a ferramenta Python

A ferramenta `python` executa uma ou mais células Python por meio de um kernel respaldado pelo Jupyter Kernel Gateway (não invocando `python -c` diretamente por célula).

Parâmetros da ferramenta:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // segundos, limitado a 1..600, padrão 30
  cwd?: string;
  reset?: boolean; // reinicia o kernel apenas antes da primeira célula
}
```

A ferramenta possui `concurrency = "exclusive"` por sessão, portanto as chamadas não se sobrepõem.

## Ciclo de vida do gateway

### Modos

Existem dois caminhos de gateway:

1. **Gateway externo** (`PI_PYTHON_GATEWAY_URL` definido)
   - Utiliza a URL configurada diretamente.
   - Autenticação opcional com `PI_PYTHON_GATEWAY_TOKEN`.
   - Nenhum processo de gateway local é iniciado ou gerenciado.

2. **Gateway local compartilhado** (caminho padrão)
   - Utiliza um único processo compartilhado coordenado em `~/.xcsh/agent/python-gateway`.
   - Arquivo de metadados: `gateway.json`
   - Arquivo de bloqueio: `gateway.lock`
   - Comando de inicialização:
     - `python -m kernel_gateway`
     - vinculado a `127.0.0.1:<porta-alocada>`
     - verificação de integridade na inicialização: `GET /api/kernelspecs`

### Coordenação do gateway local compartilhado

`acquireSharedGateway()`:

- Adquire um bloqueio de arquivo (`gateway.lock`) com heartbeat.
- Reutiliza `gateway.json` se o PID estiver ativo e a verificação de integridade for bem-sucedida.
- Limpa informações/PIDs obsoletos quando necessário.
- Inicia um novo gateway quando nenhum gateway saudável existir.

`releaseSharedGateway()` é atualmente uma operação sem efeito (o encerramento do kernel não desmonta o gateway compartilhado).

`shutdownSharedGateway()` encerra explicitamente o processo compartilhado e limpa os metadados do gateway.

### Restrição importante

`python.sharedGateway=false` é rejeitado na inicialização do kernel:

- Erro: `Shared Python gateway required; local gateways are disabled`
- Não existe modo de gateway local não compartilhado por processo.

## Ciclo de vida do kernel

Cada execução utiliza um kernel criado via `POST /api/kernels` no gateway selecionado.

Sequência de inicialização do kernel:

1. Verificação de disponibilidade (`checkPythonKernelAvailability`)
2. Criar kernel (`/api/kernels`)
3. Abrir websocket (`/api/kernels/:id/channels`)
4. Inicializar env do kernel (`cwd`, variáveis de ambiente, `sys.path`)
5. Executar `PYTHON_PRELUDE`
6. Carregar módulos de extensão de:
   - usuário: `~/.xcsh/agent/modules/*.py`
   - projeto: `<cwd>/.xcsh/modules/*.py` (substitui módulos de usuário com mesmo nome)

Encerramento do kernel:

- Exclui o kernel remoto via `DELETE /api/kernels/:id`
- Fecha o websocket
- Aciona o hook de liberação do gateway compartilhado (sem efeito atualmente)

## Semântica de persistência de sessão

`python.kernelMode` controla a reutilização do kernel:

- `session` (padrão)
  - Reutiliza sessões de kernel identificadas pela identidade da sessão + cwd.
  - A execução é serializada por sessão por meio de uma fila.
  - Sessões ociosas são removidas após 5 minutos.
  - No máximo 4 sessões; a mais antiga é removida quando o limite é excedido.
  - Verificações de heartbeat detectam kernels mortos.
  - Reinicialização automática permitida uma vez; falhas repetidas => erro definitivo.

- `per-call`
  - Cria um kernel novo para cada requisição de execução.
  - Encerra o kernel após a requisição.
  - Sem persistência de estado entre chamadas.

### Comportamento com múltiplas células em uma única chamada de ferramenta

As células são executadas sequencialmente na mesma instância de kernel para aquela chamada de ferramenta.

Se uma célula intermediária falhar:

- O estado das células anteriores permanece na memória.
- A ferramenta retorna um erro indicando qual célula falhou.
- As células posteriores não são executadas.

`reset=true` aplica-se apenas à execução da primeira célula naquela chamada.

## Filtragem de ambiente e resolução de runtime

O ambiente é filtrado antes de iniciar o runtime do gateway/kernel:

- A lista de permissões inclui variáveis essenciais como `PATH`, `HOME`, variáveis de locale, `VIRTUAL_ENV`, `PYTHONPATH`, etc.
- Prefixos permitidos: `LC_`, `XDG_`, `PI_`
- A lista de bloqueio remove chaves de API comuns (OpenAI/Anthropic/Gemini/etc.)

Ordem de seleção do runtime:

1. Venv ativo/localizado (`VIRTUAL_ENV`, depois `<cwd>/.venv`, `<cwd>/venv`)
2. Venv gerenciado em `~/.xcsh/python-env`
3. `python` ou `python3` no PATH

Quando um venv é selecionado, seu caminho bin/Scripts é adicionado ao início do `PATH`.

A inicialização do env do kernel dentro do Python também:

- `os.chdir(cwd)`
- injeta o mapa de env fornecido em `os.environ`
- garante que cwd esteja em `sys.path`

## Disponibilidade da ferramenta e seleção de modo

`python.toolMode` (padrão `both`) + override opcional `PI_PY` controlam a exposição:

- `ipy-only`
- `bash-only`
- `both`

Valores aceitos por `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Se a verificação prévia do Python falhar, a criação da ferramenta é degradada para bash-only naquela sessão.

## Fluxo de execução e cancelamento/timeout

### Timeout no nível da ferramenta

O timeout da ferramenta `python` é em segundos, padrão 30, limitado a `1..600`.

A ferramenta combina:

- sinal de cancelamento do chamador
- sinal de cancelamento por timeout

com `AbortSignal.any(...)`.

### Cancelamento de execução do kernel

Em caso de cancelamento/timeout:

- A execução é marcada como cancelada.
- Uma interrupção do kernel é tentada via REST (`POST /interrupt`) e canal de controle `interrupt_request`.
- O resultado inclui `cancelled=true`.
- O caminho de timeout anota a saída como `Command timed out after <n> seconds`.

### Comportamento do stdin

O stdin interativo não é suportado.

Se o kernel emitir `input_request`:

- A ferramenta registra `stdinRequested=true`
- Emite texto explicativo
- Envia `input_reply` vazio
- A execução é tratada como falha na camada do executor

## Captura de saída e renderização

### Classes de saída capturadas

A partir das mensagens do kernel:

- `stream` -> fragmentos de texto simples
- `display_data`/`execute_result` -> tratamento de exibição rica
- `error` -> texto de traceback
- MIME personalizado `application/x-xcsh-status` -> eventos de status estruturados

Precedência de MIME para exibição:

1. `text/markdown`
2. `text/plain`
3. `text/html` (convertido para markdown básico)

Adicionalmente capturados como saídas estruturadas:

- `application/json` -> dados de árvore JSON
- `image/png` -> payloads de imagem
- `application/x-xcsh-status` -> eventos de status

### Armazenamento e truncamento

A saída é transmitida por meio de `OutputSink` e pode ser persistida no armazenamento de artefatos.

Os resultados da ferramenta podem incluir metadados de truncamento e `artifact://<id>` para recuperação da saída completa.

### Comportamento do renderizador

- Renderizador da ferramenta (`python.ts`):
  - exibe blocos de células de código com status por célula
  - visualização prévia recolhida padrão com 10 linhas
  - suporta modo expandido para saída completa e detalhes de status mais ricos
- Renderizador interativo (`python-execution.ts`):
  - utilizado para execução Python iniciada pelo usuário no TUI
  - visualização prévia recolhida padrão com 20 linhas
  - limita linhas individuais muito longas a 4000 caracteres por segurança na exibição
  - exibe avisos de cancelamento/erro/truncamento

## Suporte a gateway externo

Defina:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Opcional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Diferenças de comportamento em relação ao gateway local compartilhado:

- Sem arquivos de bloqueio/informação de gateway local
- Sem inicialização/encerramento de processo local
- Verificações de integridade e operações CRUD de kernel são realizadas contra o endpoint externo
- Falhas de autenticação são apresentadas com orientação explícita sobre token

## Solução de problemas operacionais (modos de falha atuais)

- **Ferramenta Python não disponível**
  - Verifique `python.toolMode` / `PI_PY`.
  - Se a verificação prévia falhar, o runtime retorna para bash-only.

- **Erros de disponibilidade do kernel**
  - O modo local requer que tanto `kernel_gateway` quanto `ipykernel` sejam importáveis no runtime Python resolvido.
  - Instale com:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` causa falha na inicialização**
  - Isso é esperado com a implementação atual.

- **Falhas de autenticação/acessibilidade do gateway externo**
  - 401/403 -> defina `PI_PYTHON_GATEWAY_TOKEN`.
  - timeout/inacessível -> verifique a URL/rede e a integridade do gateway.

- **A execução trava e então atinge o timeout**
  - Aumente o `timeout` da ferramenta (máx. 600s) se a carga de trabalho for legítima.
  - Para código travado, o cancelamento aciona a interrupção do kernel, mas o código do usuário pode ainda precisar de refatoração.

- **Prompts de stdin/input no código Python**
  - `input()` não é suportado de forma interativa neste caminho de runtime; passe os dados de forma programática.

- **Esgotamento de recursos (`EMFILE` / muitos arquivos abertos)**
  - O gerenciador de sessões aciona a recuperação do gateway compartilhado (desmontagem da sessão + reinicialização do gateway compartilhado).

- **Erros de diretório de trabalho**
  - A ferramenta valida que `cwd` existe e é um diretório antes da execução.

## Variáveis de ambiente relevantes

- `PI_PY` — override de exposição da ferramenta (mapeamento `bash-only`/`ipy-only`/`both` acima)
- `PI_PYTHON_GATEWAY_URL` — utilizar gateway externo
- `PI_PYTHON_GATEWAY_TOKEN` — token de autenticação opcional para gateway externo
- `PI_PYTHON_SKIP_CHECK=1` — ignorar verificações prévias/de aquecimento do Python
- `PI_PYTHON_IPC_TRACE=1` — registrar traces de envio/recebimento IPC do kernel
- `PI_DEBUG_STARTUP=1` — emitir marcadores de depuração de estágio de inicialização
