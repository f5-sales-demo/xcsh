---
title: Herramienta Python y Runtime de IPython
description: >-
  Runtime de la herramienta REPL de Python con gestión del kernel IPython,
  ejecución y captura de salida.
sidebar:
  order: 3
  label: Python e IPython
i18n:
  sourceHash: 70f0a034ecef
  translator: machine
---

# Herramienta Python y Runtime de IPython

Este documento describe la pila de ejecución actual de Python en `packages/coding-agent`.
Cubre el comportamiento de la herramienta, el ciclo de vida del kernel/gateway, el manejo del entorno, la semántica de ejecución, el renderizado de salida y los modos de fallo operacionales.

## Alcance y archivos clave

- Superficie de la herramienta: `src/tools/python.ts`
- Orquestación del kernel por sesión/llamada: `src/ipy/executor.ts`
- Protocolo del kernel + integración con gateway: `src/ipy/kernel.ts`
- Coordinador de gateway local compartido: `src/ipy/gateway-coordinator.ts`
- Renderizador en modo interactivo para ejecuciones Python iniciadas por el usuario: `src/modes/components/python-execution.ts`
- Filtrado de runtime/entorno y resolución de Python: `src/ipy/runtime.ts`

## Qué es la herramienta Python

La herramienta `python` ejecuta una o más celdas Python a través de un kernel respaldado por Jupyter Kernel Gateway (no ejecutando `python -c` directamente por celda).

Parámetros de la herramienta:

```ts
{
  cells: Array<{ code: string; title?: string }>;
  timeout?: number; // segundos, limitado a 1..600, predeterminado 30
  cwd?: string;
  reset?: boolean; // reinicia el kernel antes de la primera celda únicamente
}
```

La herramienta tiene `concurrency = "exclusive"` para una sesión, por lo que las llamadas no se superponen.

## Ciclo de vida del gateway

### Modos

Existen dos rutas de gateway:

1. **Gateway externo** (`PI_PYTHON_GATEWAY_URL` configurado)
   - Utiliza la URL configurada directamente.
   - Autenticación opcional con `PI_PYTHON_GATEWAY_TOKEN`.
   - No se genera ni gestiona ningún proceso de gateway local.

2. **Gateway local compartido** (ruta predeterminada)
   - Utiliza un único proceso compartido coordinado en `~/.xcsh/agent/python-gateway`.
   - Archivo de metadatos: `gateway.json`
   - Archivo de bloqueo: `gateway.lock`
   - Comando de inicio:
     - `python -m kernel_gateway`
     - enlazado a `127.0.0.1:<puerto-asignado>`
     - verificación de salud al inicio: `GET /api/kernelspecs`

### Coordinación del gateway local compartido

`acquireSharedGateway()`:

- Obtiene un bloqueo de archivo (`gateway.lock`) con latido.
- Reutiliza `gateway.json` si el PID está activo y la verificación de salud es exitosa.
- Limpia información/PIDs desactualizados cuando es necesario.
- Inicia un nuevo gateway cuando no existe ninguno saludable.

`releaseSharedGateway()` es actualmente una operación vacía (el apagado del kernel no destruye el gateway compartido).

`shutdownSharedGateway()` termina explícitamente el proceso compartido y limpia los metadatos del gateway.

### Restricción importante

`python.sharedGateway=false` es rechazado al iniciar el kernel:

- Error: `Shared Python gateway required; local gateways are disabled`
- No existe un modo de gateway local no compartido por proceso.

## Ciclo de vida del kernel

Cada ejecución utiliza un kernel creado mediante `POST /api/kernels` en el gateway seleccionado.

Secuencia de inicio del kernel:

1. Verificación de disponibilidad (`checkPythonKernelAvailability`)
2. Crear kernel (`/api/kernels`)
3. Abrir websocket (`/api/kernels/:id/channels`)
4. Inicializar entorno del kernel (`cwd`, variables de entorno, `sys.path`)
5. Ejecutar `PYTHON_PRELUDE`
6. Cargar módulos de extensión desde:
   - usuario: `~/.xcsh/agent/modules/*.py`
   - proyecto: `<cwd>/.xcsh/modules/*.py` (sobreescribe el módulo de usuario con el mismo nombre)

Apagado del kernel:

- Elimina el kernel remoto mediante `DELETE /api/kernels/:id`
- Cierra el websocket
- Llama al hook de liberación del gateway compartido (operación vacía hoy en día)

## Semántica de persistencia de sesión

`python.kernelMode` controla la reutilización del kernel:

- `session` (predeterminado)
  - Reutiliza sesiones del kernel identificadas por identidad de sesión + cwd.
  - La ejecución se serializa por sesión mediante una cola.
  - Las sesiones inactivas se desalojan después de 5 minutos.
  - Máximo 4 sesiones; la más antigua se desaloja al superar el límite.
  - Las verificaciones de latido detectan kernels muertos.
  - Se permite un reinicio automático; un fallo repetido resulta en error definitivo.

- `per-call`
  - Crea un kernel nuevo para cada solicitud de ejecución.
  - Apaga el kernel después de la solicitud.
  - Sin persistencia de estado entre llamadas.

### Comportamiento de múltiples celdas en una sola llamada a la herramienta

Las celdas se ejecutan secuencialmente en la misma instancia del kernel para esa llamada a la herramienta.

Si una celda intermedia falla:

- El estado de las celdas anteriores permanece en memoria.
- La herramienta devuelve un error específico indicando qué celda falló.
- Las celdas posteriores no se ejecutan.

`reset=true` solo aplica a la primera ejecución de celda en esa llamada.

## Filtrado del entorno y resolución del runtime

El entorno es filtrado antes de iniciar el runtime del gateway/kernel:

- La lista de permitidos incluye variables básicas como `PATH`, `HOME`, variables de localización, `VIRTUAL_ENV`, `PYTHONPATH`, etc.
- Prefijos permitidos: `LC_`, `XDG_`, `PI_`
- La lista de denegados elimina claves de API comunes (OpenAI/Anthropic/Gemini/etc.)

Orden de selección del runtime:

1. Venv activo/ubicado (`VIRTUAL_ENV`, luego `<cwd>/.venv`, `<cwd>/venv`)
2. Venv gestionado en `~/.xcsh/python-env`
3. `python` o `python3` en PATH

Cuando se selecciona un venv, su ruta bin/Scripts se antepone a `PATH`.

La inicialización del entorno del kernel dentro de Python también:

- `os.chdir(cwd)`
- inyecta el mapa de entorno proporcionado en `os.environ`
- asegura que cwd esté en `sys.path`

## Disponibilidad de la herramienta y selección de modo

`python.toolMode` (predeterminado `both`) + anulación opcional `PI_PY` controla la exposición:

- `ipy-only`
- `bash-only`
- `both`

Valores aceptados por `PI_PY`:

- `0` / `bash` -> `bash-only`
- `1` / `py` -> `ipy-only`
- `mix` / `both` -> `both`

Si la comprobación previa de Python falla, la creación de la herramienta se degrada a bash-only para esa sesión.

## Flujo de ejecución y cancelación/tiempo de espera

### Tiempo de espera a nivel de herramienta

El tiempo de espera de la herramienta `python` está en segundos, predeterminado 30, limitado a `1..600`.

La herramienta combina:

- señal de cancelación del llamador
- señal de cancelación por tiempo de espera

con `AbortSignal.any(...)`.

### Cancelación de ejecución del kernel

Al cancelar/agotar el tiempo de espera:

- La ejecución se marca como cancelada.
- Se intenta interrumpir el kernel mediante REST (`POST /interrupt`) y `interrupt_request` en el canal de control.
- El resultado incluye `cancelled=true`.
- La ruta de tiempo de espera anota la salida como `Command timed out after <n> seconds`.

### Comportamiento de stdin

La entrada estándar interactiva no está soportada.

Si el kernel emite `input_request`:

- La herramienta registra `stdinRequested=true`
- Emite texto explicativo
- Envía `input_reply` vacío
- La ejecución se trata como un fallo en la capa del ejecutor

## Captura y renderizado de salida

### Clases de salida capturadas

Desde los mensajes del kernel:

- `stream` -> fragmentos de texto plano
- `display_data`/`execute_result` -> manejo de visualización enriquecida
- `error` -> texto de seguimiento de error
- MIME personalizado `application/x-xcsh-status` -> eventos de estado estructurado

Precedencia de MIME de visualización:

1. `text/markdown`
2. `text/plain`
3. `text/html` (convertido a markdown básico)

Adicionalmente capturado como salidas estructuradas:

- `application/json` -> datos de árbol JSON
- `image/png` -> cargas útiles de imagen
- `application/x-xcsh-status` -> eventos de estado

### Almacenamiento y truncamiento

La salida se transmite a través de `OutputSink` y puede persistirse en almacenamiento de artefactos.

Los resultados de la herramienta pueden incluir metadatos de truncamiento y `artifact://<id>` para recuperación de salida completa.

### Comportamiento del renderizador

- Renderizador de la herramienta (`python.ts`):
  - muestra bloques de celdas de código con estado por celda
  - la vista previa colapsada muestra 10 líneas por defecto
  - admite modo expandido para salida completa y detalle de estado más rico
- Renderizador interactivo (`python-execution.ts`):
  - utilizado para ejecución Python iniciada por el usuario en TUI
  - la vista previa colapsada muestra 20 líneas por defecto
  - limita líneas individuales muy largas a 4000 caracteres por seguridad en la visualización
  - muestra avisos de cancelación/error/truncamiento

## Soporte para gateway externo

Configurar:

```bash
export PI_PYTHON_GATEWAY_URL="http://127.0.0.1:8888"
# Opcional:
export PI_PYTHON_GATEWAY_TOKEN="..."
```

Diferencias de comportamiento respecto al gateway local compartido:

- Sin archivos de bloqueo/información de gateway local
- Sin inicio/terminación de proceso local
- Las verificaciones de salud y operaciones CRUD del kernel se ejecutan contra el endpoint externo
- Los fallos de autenticación se muestran con orientación explícita sobre el token

## Solución de problemas operacionales (modos de fallo actuales)

- **Herramienta Python no disponible**
  - Verificar `python.toolMode` / `PI_PY`.
  - Si la comprobación previa falla, el runtime cae en modo bash-only.

- **Errores de disponibilidad del kernel**
  - El modo local requiere que tanto `kernel_gateway` como `ipykernel` sean importables en el runtime de Python resuelto.
  - Instalar con:

    ```bash
    python -m pip install jupyter_kernel_gateway ipykernel
    ```

- **`python.sharedGateway=false` causa fallo al iniciar**
  - Esto es esperado con la implementación actual.

- **Fallos de autenticación/accesibilidad del gateway externo**
  - 401/403 -> configurar `PI_PYTHON_GATEWAY_TOKEN`.
  - tiempo de espera/inaccesible -> verificar URL/red y salud del gateway.

- **La ejecución se bloquea y luego agota el tiempo de espera**
  - Aumentar el `timeout` de la herramienta (máximo 600s) si la carga de trabajo es legítima.
  - Para código bloqueado, la cancelación activa una interrupción del kernel, pero el código del usuario puede requerir refactorización.

- **Solicitudes de stdin/input en código Python**
  - `input()` no está soportado de forma interactiva en esta ruta de runtime; pasar datos de forma programática.

- **Agotamiento de recursos (`EMFILE` / demasiados archivos abiertos)**
  - El gestor de sesiones activa la recuperación del gateway compartido (desmontaje de sesión + reinicio del gateway compartido).

- **Errores del directorio de trabajo**
  - La herramienta valida que `cwd` existe y es un directorio antes de la ejecución.

## Variables de entorno relevantes

- `PI_PY` — anulación de exposición de la herramienta (mapeo `bash-only`/`ipy-only`/`both` mencionado anteriormente)
- `PI_PYTHON_GATEWAY_URL` — usar gateway externo
- `PI_PYTHON_GATEWAY_TOKEN` — token de autenticación opcional para gateway externo
- `PI_PYTHON_SKIP_CHECK=1` — omitir comprobaciones previas/de calentamiento de Python
- `PI_PYTHON_IPC_TRACE=1` — registrar trazas de envío/recepción IPC del kernel
- `PI_DEBUG_STARTUP=1` — emitir marcadores de depuración en la etapa de inicio
