---
title: Variables de entorno
description: >-
  Referencia de variables de entorno en tiempo de ejecución para la
  configuración y control de comportamiento de xcsh.
sidebar:
  order: 2
  label: Variables de entorno
i18n:
  sourceHash: 7baa9f5226ba
  translator: machine
---

# Variables de entorno (Referencia de tiempo de ejecución actual)

Esta referencia se deriva de las rutas de código actuales en:

- `packages/coding-agent/src/**`
- `packages/ai/src/**` (resolución de proveedor/autenticación utilizada por coding-agent)
- `packages/utils/src/**` y `packages/tui/src/**` donde esas variables afectan directamente el tiempo de ejecución de coding-agent

Documenta únicamente el comportamiento activo.

## Modelo de resolución y precedencia

La mayoría de las búsquedas en tiempo de ejecución utilizan `$env` de `@f5xc-salesdemos/pi-utils` (`packages/utils/src/env.ts`).

Orden de carga de `$env`:

1. Entorno de proceso existente (`Bun.env`)
2. `.env` del proyecto (`$PWD/.env`) para claves que aún no estén establecidas
3. `.env` del directorio home (`~/.env`) para claves que aún no estén establecidas

Regla adicional en archivos `.env`: las claves `XCSH_*` se replican a claves `PI_*` durante el análisis.

---

## 1) Autenticación de modelo/proveedor

Estas se consumen a través de `getEnvApiKey()` (`packages/ai/src/stream.ts`) a menos que se indique lo contrario.

### Credenciales principales de proveedor

| Variable                        | Usado para | Requerido cuando                                                 | Notas / precedencia                                                                                  |
|---------------------------------|---|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `ANTHROPIC_OAUTH_TOKEN`         | Autenticación API de Anthropic | Se usa Anthropic con autenticación por token OAuth                         | Tiene precedencia sobre `ANTHROPIC_API_KEY` para la resolución de autenticación del proveedor                              |
| `ANTHROPIC_API_KEY`             | Autenticación API de Anthropic | Se usa Anthropic sin token OAuth                           | Respaldo después de `ANTHROPIC_OAUTH_TOKEN`                                                              |
| `ANTHROPIC_FOUNDRY_API_KEY`     | Anthropic vía Azure Foundry / gateway empresarial | `CLAUDE_CODE_USE_FOUNDRY` habilitado                             | Tiene precedencia sobre `ANTHROPIC_OAUTH_TOKEN` y `ANTHROPIC_API_KEY` cuando el modo Foundry está habilitado  |
| `OPENAI_API_KEY`                | Autenticación OpenAI | Se usan proveedores de la familia OpenAI sin argumento apiKey explícito | Usado por los proveedores OpenAI Completions/Responses                                                      |
| `GEMINI_API_KEY`                | Autenticación Google Gemini | Se usan modelos del proveedor `google`                                | Clave principal para el mapeo del proveedor Gemini                                                             |
| `GOOGLE_API_KEY`                | Respaldo de autenticación de herramienta de imagen Gemini | Se usa la herramienta `gemini_image` sin `GEMINI_API_KEY`            | Usado por la ruta de respaldo de herramienta de imagen de coding-agent                                                       |
| `GROQ_API_KEY`                  | Autenticación Groq | Se usan modelos Groq                                             |                                                                                                     |
| `CEREBRAS_API_KEY`              | Autenticación Cerebras | Se usan modelos Cerebras                                         |                                                                                                     |
| `TOGETHER_API_KEY`              | Autenticación Together | Se usa el proveedor `together`                                     |                                                                                                     |
| `HUGGINGFACE_HUB_TOKEN`         | Autenticación Hugging Face | Se usa el proveedor `huggingface`                                  | Variable de entorno principal del token de Hugging Face                                                                  |
| `HF_TOKEN`                      | Autenticación Hugging Face | Se usa el proveedor `huggingface`                                  | Respaldo cuando `HUGGINGFACE_HUB_TOKEN` no está establecido                                                      |
| `SYNTHETIC_API_KEY`             | Autenticación Synthetic | Se usan modelos Synthetic                                        |                                                                                                     |
| `NVIDIA_API_KEY`                | Autenticación NVIDIA | Se usa el proveedor `nvidia`                                       |                                                                                                     |
| `NANO_GPT_API_KEY`              | Autenticación NanoGPT | Se usa el proveedor `nanogpt`                                      |                                                                                                     |
| `VENICE_API_KEY`                | Autenticación Venice | Se usa el proveedor `venice`                                       |                                                                                                     |
| `LITELLM_API_KEY`               | Autenticación LiteLLM | Se usa el proveedor `litellm`                                      | Clave de proxy compatible con OpenAI de LiteLLM. Cuando se establece con `LITELLM_BASE_URL`, habilita la autoconfiguración de `models.yml` |
| `LM_STUDIO_API_KEY`             | Autenticación LM Studio (opcional) | Se usa el proveedor `lm-studio` con hosts autenticados           | LM Studio local generalmente se ejecuta sin autenticación; cualquier token no vacío funciona cuando se requiere una clave         |
| `OLLAMA_API_KEY`                | Autenticación Ollama (opcional) | Se usa el proveedor `ollama` con hosts autenticados              | Ollama local generalmente se ejecuta sin autenticación; cualquier token no vacío funciona cuando se requiere una clave            |
| `LLAMA_CPP_API_KEY`             | Autenticación Ollama (opcional) | Se usa `llama-server` con el parámetro `--api-key`              | llama.cpp local generalmente se ejecuta sin autenticación; cualquier token no vacío funciona cuando se configura una clave       |
| `XIAOMI_API_KEY`                | Autenticación Xiaomi MiMo | Se usa el proveedor `xiaomi`                                       |                                                                                                     |
| `MOONSHOT_API_KEY`              | Autenticación Moonshot | Se usa el proveedor `moonshot`                                     |                                                                                                     |
| `XAI_API_KEY`                   | Autenticación xAI | Se usan modelos xAI                                              |                                                                                                     |
| `OPENROUTER_API_KEY`            | Autenticación OpenRouter | Se usan modelos OpenRouter                                       | También usado por la herramienta de imagen cuando el proveedor preferido/automático es OpenRouter                                  |
| `MISTRAL_API_KEY`               | Autenticación Mistral | Se usan modelos Mistral                                          |                                                                                                     |
| `ZAI_API_KEY`                   | Autenticación z.ai | Se usan modelos z.ai                                             | También usado por el proveedor de búsqueda web z.ai                                                               |
| `MINIMAX_API_KEY`               | Autenticación MiniMax | Se usa el proveedor `minimax`                                      |                                                                                                     |
| `MINIMAX_CODE_API_KEY`          | Autenticación MiniMax Code | Se usa el proveedor `minimax-code`                                 |                                                                                                     |
| `MINIMAX_CODE_CN_API_KEY`       | Autenticación MiniMax Code CN | Se usa el proveedor `minimax-code-cn`                              |                                                                                                     |
| `OPENCODE_API_KEY`              | Autenticación OpenCode | Se usan modelos OpenCode                                         |                                                                                                     |
| `QIANFAN_API_KEY`               | Autenticación Qianfan | Se usa el proveedor `qianfan`                                      |                                                                                                     |
| `QWEN_OAUTH_TOKEN`              | Autenticación Qwen Portal | Se usa `qwen-portal` con token OAuth                          | Tiene precedencia sobre `QWEN_PORTAL_API_KEY`                                                         |
| `QWEN_PORTAL_API_KEY`           | Autenticación Qwen Portal | Se usa `qwen-portal` con clave API                              | Respaldo después de `QWEN_OAUTH_TOKEN`                                                                   |
| `ZENMUX_API_KEY`                | Autenticación ZenMux | Se usa el proveedor `zenmux`                                       | Usado para rutas compatibles con OpenAI y Anthropic de ZenMux                                              |
| `VLLM_API_KEY`                  | Autenticación/descubrimiento vLLM | Se usa el proveedor `vllm` (servidores locales compatibles con OpenAI)       | Cualquier valor no vacío funciona para servidores locales sin autenticación                                                 |
| `CURSOR_ACCESS_TOKEN`           | Autenticación del proveedor Cursor | Se usa el proveedor Cursor                                         |                                                                                                     |
| `AI_GATEWAY_API_KEY`            | Autenticación Vercel AI Gateway | Se usa el proveedor `vercel-ai-gateway`                            |                                                                                                     |
| `CLOUDFLARE_AI_GATEWAY_API_KEY` | Autenticación Cloudflare AI Gateway | Se usa el proveedor `cloudflare-ai-gateway`                        | La URL base debe configurarse como `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` |

### Cadenas de tokens GitHub/Copilot

| Variable | Usado para | Cadena |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | Autenticación del proveedor GitHub Copilot | `COPILOT_GITHUB_TOKEN` → `GH_TOKEN` → `GITHUB_TOKEN` |
| `GH_TOKEN` | Respaldo de Copilot; autenticación API de GitHub en web scraper | En web scraper: `GITHUB_TOKEN` → `GH_TOKEN` |
| `GITHUB_TOKEN` | Respaldo de Copilot; autenticación API de GitHub en web scraper | En web scraper: se verifica antes de `GH_TOKEN` |

---

## 2) Configuración de tiempo de ejecución específica del proveedor

### Gateway Anthropic Foundry (Azure / proxy empresarial)

Cuando `CLAUDE_CODE_USE_FOUNDRY` está habilitado, las solicitudes de Anthropic cambian al modo Foundry:

- La URL base se resuelve desde `FOUNDRY_BASE_URL` (el respaldo permanece como la URL base del modelo/predeterminada si no está establecida).
- La resolución de clave API para el proveedor `anthropic` se convierte en:
  `ANTHROPIC_FOUNDRY_API_KEY` → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`.
- `ANTHROPIC_CUSTOM_HEADERS` se analiza como pares `clave: valor` separados por comas/saltos de línea y se fusiona en los encabezados de solicitud.
- El material TLS de cliente/servidor se puede inyectar desde valores de entorno:
  `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`.
  Cada uno acepta:
  - una ruta del sistema de archivos al contenido PEM, o
  - PEM en línea (incluyendo secuencias `\n` escapadas).

| Variable | Tipo de valor | Comportamiento |
|---|---|---|
| `CLAUDE_CODE_USE_FOUNDRY` | Cadena tipo booleano (`1`, `true`, `yes`, `on`) | Habilita el modo Foundry para el proveedor Anthropic |
| `FOUNDRY_BASE_URL` | Cadena URL | URL base del endpoint de Anthropic en modo Foundry |
| `ANTHROPIC_FOUNDRY_API_KEY` | Cadena de token | Usado para `Authorization: Bearer <token>` |
| `ANTHROPIC_CUSTOM_HEADERS` | Cadena de lista de encabezados | Encabezados adicionales; formato `header-a: valor, header-b: valor` o separados por salto de línea |
| `NODE_EXTRA_CA_CERTS` | Ruta PEM o PEM en línea | Cadena CA adicional para validación de certificado del servidor |
| `CLAUDE_CODE_CLIENT_CERT` | Ruta PEM o PEM en línea | Certificado de cliente mTLS |
| `CLAUDE_CODE_CLIENT_KEY` | Ruta PEM o PEM en línea | Clave privada de cliente mTLS (debe estar emparejada con el certificado) |

### Amazon Bedrock

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `AWS_REGION` | Fuente principal de región |
| `AWS_DEFAULT_REGION` | Respaldo si `AWS_REGION` no está establecida |
| `AWS_PROFILE` | Habilita la ruta de autenticación por perfil con nombre |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | Habilita la ruta de autenticación por clave IAM |
| `AWS_BEARER_TOKEN_BEDROCK` | Habilita la ruta de autenticación por token bearer |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `AWS_CONTAINER_CREDENTIALS_FULL_URI` | Habilita la ruta de credenciales de tarea ECS |
| `AWS_WEB_IDENTITY_TOKEN_FILE` + `AWS_ROLE_ARN` | Habilita la ruta de autenticación por identidad web |
| `AWS_BEDROCK_SKIP_AUTH` | Si es `1`, inyecta credenciales ficticias (escenarios de proxy/sin autenticación) |
| `AWS_BEDROCK_FORCE_HTTP1` | Si es `1`, fuerza el manejador de solicitudes HTTP/1 de Node |

Respaldo de región en el código del proveedor: `options.region` → `AWS_REGION` → `AWS_DEFAULT_REGION` → `us-east-1`.

### Azure OpenAI Responses

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `AZURE_OPENAI_API_KEY` | Requerido a menos que se pase la clave API como opción |
| `AZURE_OPENAI_API_VERSION` | Predeterminado `v1` |
| `AZURE_OPENAI_BASE_URL` | Anulación directa de URL base |
| `AZURE_OPENAI_RESOURCE_NAME` | Usado para construir la URL base: `https://<resource>.openai.azure.com/openai/v1` |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Cadena de mapeo opcional: `modelId=deploymentName,model2=deployment2` |

Resolución de URL base: opción `azureBaseUrl` → env `AZURE_OPENAI_BASE_URL` → opción/env nombre de recurso → `model.baseUrl`.

### Google Vertex AI

| Variable | ¿Requerida? | Notas |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Sí (a menos que se pase en opciones) | Respaldo: `GCLOUD_PROJECT` |
| `GCLOUD_PROJECT` | Respaldo | Usado como fuente alternativa de ID de proyecto |
| `GOOGLE_CLOUD_LOCATION` | Sí (a menos que se pase en opciones) | Sin valor predeterminado en el proveedor |
| `GOOGLE_APPLICATION_CREDENTIALS` | Condicional | Si está establecida, el archivo debe existir; de lo contrario, se verifica la ruta de respaldo ADC (`~/.config/gcloud/application_default_credentials.json`) |

### Kimi

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `KIMI_CODE_OAUTH_HOST` | Anulación principal del host OAuth |
| `KIMI_OAUTH_HOST` | Anulación de respaldo del host OAuth |
| `KIMI_CODE_BASE_URL` | Anula la URL base del endpoint de uso de Kimi (`usage/kimi.ts`) |

Cadena de host OAuth: `KIMI_CODE_OAUTH_HOST` → `KIMI_OAUTH_HOST` → `https://auth.kimi.com`.

### Compatibilidad Antigravity/Gemini imagen

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `PI_AI_ANTIGRAVITY_VERSION` | Anula la etiqueta de versión del user-agent de Antigravity en el proveedor Gemini CLI |

### OpenAI Codex responses (controles de funcionalidad/depuración)

| Variable | Comportamiento |
|---|---|
| `PI_CODEX_DEBUG` | `1`/`true` habilita el registro de depuración del proveedor Codex |
| `PI_CODEX_WEBSOCKET` | `1`/`true` habilita la preferencia de transporte websocket |
| `PI_CODEX_WEBSOCKET_V2` | `1`/`true` habilita la ruta websocket v2 |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Anulación de entero positivo (predeterminado 300000) |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Anulación de entero no negativo (predeterminado 5) |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Anulación de backoff base de entero positivo (predeterminado 500) |

### Depuración del proveedor Cursor

| Variable | Comportamiento |
|---|---|
| `DEBUG_CURSOR` | Habilita registros de depuración del proveedor; `2`/`verbose` para fragmentos detallados de carga útil |
| `DEBUG_CURSOR_LOG` | Ruta de archivo opcional para salida de registro de depuración JSONL |

### Interruptor de compatibilidad de caché de prompts

| Variable | Comportamiento |
|---|---|
| `PI_CACHE_RETENTION` | Si es `long`, habilita retención prolongada donde sea compatible (`anthropic`, `openai-responses`, resolución de retención de Bedrock) |

---

## 3) Subsistema de búsqueda web

### Credenciales del proveedor de búsqueda

| Variable | Usado por |
|---|---|
| `EXA_API_KEY` | Proveedor de búsqueda Exa y herramientas MCP de Exa |
| `BRAVE_API_KEY` | Proveedor de búsqueda Brave |
| `PERPLEXITY_API_KEY` | Proveedor de búsqueda Perplexity en modo clave API |
| `TAVILY_API_KEY` | Proveedor de búsqueda Tavily |
| `ZAI_API_KEY` | Proveedor de búsqueda z.ai (también verifica OAuth almacenado en `agent.db`) |
| `OPENAI_API_KEY` / OAuth Codex en DB | Disponibilidad/autenticación del proveedor de búsqueda Codex |

### Cadena de autenticación de búsqueda web de Anthropic

`packages/coding-agent/src/web/search/auth.ts` resuelve las credenciales de búsqueda web de Anthropic en este orden:

1. `ANTHROPIC_SEARCH_API_KEY` (+ opcional `ANTHROPIC_SEARCH_BASE_URL`)
2. Entrada de proveedor en `models.json` con `api: "anthropic-messages"`
3. Credenciales OAuth de Anthropic desde `agent.db` (no debe expirar dentro de un margen de 5 minutos)
4. Respaldo genérico de env de Anthropic: clave del proveedor (`ANTHROPIC_FOUNDRY_API_KEY`/`ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`) + opcional `ANTHROPIC_BASE_URL` (`FOUNDRY_BASE_URL` cuando el modo Foundry está habilitado)

Variables relacionadas:

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `ANTHROPIC_SEARCH_API_KEY` | Clave de búsqueda explícita de máxima prioridad |
| `ANTHROPIC_SEARCH_BASE_URL` | Predeterminado `https://api.anthropic.com` cuando se omite |
| `ANTHROPIC_SEARCH_MODEL` | Predeterminado `claude-haiku-4-5` |
| `ANTHROPIC_BASE_URL` | URL base de respaldo genérico para la ruta de autenticación de nivel 4 |

### Indicador de comportamiento del flujo OAuth de Perplexity

| Variable | Comportamiento |
|---|---|
| `PI_AUTH_NO_BORROW` | Si está establecida, deshabilita la ruta de préstamo de token de aplicación nativa de macOS en el flujo de inicio de sesión de Perplexity |

---

## 4) Herramientas Python y tiempo de ejecución del kernel

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `PI_PY` | Anulación del modo de herramienta Python: `0`/`bash`=`bash-only`, `1`/`py`=`ipy-only`, `mix`/`both`=`both`; valores inválidos se ignoran |
| `PI_PYTHON_SKIP_CHECK` | Si es `1`, omite las verificaciones de disponibilidad/calentamiento del kernel Python |
| `PI_PYTHON_GATEWAY_URL` | Si está establecida, usa un gateway de kernel externo en lugar del gateway compartido local |
| `PI_PYTHON_GATEWAY_TOKEN` | Token de autenticación opcional para gateway externo (`Authorization: token <value>`) |
| `PI_PYTHON_IPC_TRACE` | Si es `1`, habilita la ruta de traza IPC de bajo nivel en el módulo del kernel |
| `VIRTUAL_ENV` | Ruta de venv de máxima prioridad para la resolución del tiempo de ejecución de Python |

Comportamiento condicional adicional:

- Si `BUN_ENV=test` o `NODE_ENV=test`, las verificaciones de disponibilidad de Python se tratan como OK y el calentamiento se omite.
- El filtrado de entorno de Python deniega claves API comunes y permite variables base seguras + prefijos `LC_`, `XDG_`, `PI_`.

---

## 5) Opciones de comportamiento del agente/tiempo de ejecución

| Variable                   | Valor predeterminado / comportamiento                                                                           |
|----------------------------|----------------------------------------------------------------------------------------------|
| `PI_SMOL_MODEL`            | Anulación efímera de rol de modelo para `smol` (CLI `--smol` tiene precedencia)                     |
| `PI_SLOW_MODEL`            | Anulación efímera de rol de modelo para `slow` (CLI `--slow` tiene precedencia)                     |
| `PI_PLAN_MODEL`            | Anulación efímera de rol de modelo para `plan` (CLI `--plan` tiene precedencia)                     |
| `PI_NO_TITLE`              | Si está establecida (cualquier valor no vacío), deshabilita la generación automática de título de sesión en el primer mensaje del usuario   |
| `NULL_PROMPT`              | Si es `true`, el constructor del prompt del sistema devuelve una cadena vacía                                        |
| `PI_BLOCKED_AGENT`         | Bloquea un tipo específico de subagente en la herramienta de tareas                                                 |
| `PI_SUBPROCESS_CMD`        | Anula el comando de generación de subagentes (bypass de resolución `xcsh` / `xcsh.cmd`)                       |
| `PI_TASK_MAX_OUTPUT_BYTES` | Máximo de bytes de salida capturados por subagente (predeterminado `500000`)                                    |
| `PI_TASK_MAX_OUTPUT_LINES` | Máximo de líneas de salida capturadas por subagente (predeterminado `5000`)                                      |
| `PI_TIMING`                | Si es `1`, habilita registros de instrumentación de tiempos de inicio/herramientas                                     |
| `PI_DEBUG_STARTUP`         | Habilita impresiones de depuración de etapa de inicio a stderr en múltiples rutas de inicio                       |
| `PI_PACKAGE_DIR`           | Anula la resolución del directorio base de activos del paquete (búsqueda de rutas de docs/examples/changelog)            |
| `PI_DISABLE_LSPMUX`        | Si es `1`, deshabilita la detección/integración de lspmux y fuerza la generación directa del servidor LSP          |
| `LITELLM_BASE_URL`         | URL base del proxy LiteLLM. Cuando se establece con `LITELLM_API_KEY`, activa la generación automática de `models.yml` en la primera ejecución y auto-reparación en cada inicio |
| `LM_STUDIO_BASE_URL`       | Anulación de URL base de descubrimiento implícito de LM Studio (predeterminado `http://127.0.0.1:1234/v1` si no está establecida) |
| `OLLAMA_BASE_URL`          | Anulación de URL base de descubrimiento implícito de Ollama (predeterminado `http://127.0.0.1:11434` si no está establecida)      |
| `LLAMA_CPP_BASE_URL`       | Anulación de URL base de descubrimiento implícito de Llama.cpp (predeterminado `http://127.0.0.1:8080` si no está establecida)    |
| `PI_EDIT_VARIANT`          | Si es `hashline`, fuerza el modo de visualización hashline de lectura/grep cuando la herramienta de edición está disponible               |
| `PI_NO_PTY`                | Si es `1`, deshabilita la ruta PTY interactiva para la herramienta bash                                          |

`PI_NO_PTY` también se establece internamente cuando se usa CLI `--no-pty`.

---

## 6) Rutas raíz de almacenamiento y configuración

Estas se consumen a través de `@f5xc-salesdemos/pi-utils/dirs` y afectan dónde el coding-agent almacena datos.

| Variable | Valor predeterminado / comportamiento |
|---|---|
| `PI_CONFIG_DIR` | Nombre del directorio raíz de configuración bajo home (predeterminado `.xcsh`) |
| `PI_CODING_AGENT_DIR` | Anulación completa del directorio del agente (predeterminado `~/<PI_CONFIG_DIR or .xcsh>/agent`) |
| `PWD` | Usado al hacer coincidir el directorio de trabajo actual canónico en los helpers de rutas |

---

## 7) Entorno de ejecución de shell/herramientas

(De `packages/utils/src/procmgr.ts` e integración de herramienta bash de coding-agent.)

| Variable | Comportamiento |
|---|---|
| `PI_BASH_NO_CI` | Suprime la inyección automática de `CI=true` en el entorno de shell generado |
| `CLAUDE_BASH_NO_CI` | Alias heredado de respaldo para `PI_BASH_NO_CI` |
| `PI_BASH_NO_LOGIN` | Destinado a deshabilitar el modo de shell de inicio de sesión |
| `CLAUDE_BASH_NO_LOGIN` | Alias heredado de respaldo para `PI_BASH_NO_LOGIN` |
| `PI_SHELL_PREFIX` | Envoltorio de prefijo de comando opcional |
| `CLAUDE_CODE_SHELL_PREFIX` | Alias heredado de respaldo para `PI_SHELL_PREFIX` |
| `VISUAL` | Comando preferido de editor externo |
| `EDITOR` | Comando de respaldo de editor externo |

Nota de implementación actual: `PI_BASH_NO_LOGIN`/`CLAUDE_BASH_NO_LOGIN` se leen, pero la implementación actual de `getShellArgs()` devuelve `['-l','-c']` en ambas ramas (efectivamente sin efecto hoy).

---

## 8) Detección de UI/tema/sesión (entorno autodetectado)

Estas se leen como señales de tiempo de ejecución; generalmente son establecidas por la terminal/sistema operativo en lugar de configurarse manualmente.

| Variable | Usado para |
|---|---|
| `COLORTERM`, `TERM`, `WT_SESSION` | Detección de capacidad de color (modo de color del tema) |
| `COLORFGBG` | Autodetección de fondo claro/oscuro de la terminal |
| `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR` | Identidad de la terminal en el prompt/contexto del sistema |
| `KDE_FULL_SESSION`, `XDG_CURRENT_DESKTOP`, `DESKTOP_SESSION`, `XDG_SESSION_DESKTOP`, `GDMSESSION`, `WINDOWMANAGER` | Detección de escritorio/gestor de ventanas en el prompt/contexto del sistema |
| `KITTY_WINDOW_ID`, `TMUX_PANE`, `TERM_SESSION_ID`, `WT_SESSION` | IDs estables de referencia de sesión por terminal |
| `SHELL`, `ComSpec`, `TERM_PROGRAM`, `TERM` | Diagnósticos de información del sistema |
| `APPDATA`, `XDG_CONFIG_HOME` | Resolución de ruta de configuración de lspmux |
| `HOME` | Acortamiento de ruta en la interfaz de comandos MCP |

---

## 9) Indicadores de carga nativa/depuración

| Variable | Comportamiento |
|---|---|
| `PI_DEV` | Habilita diagnósticos detallados de carga de complementos nativos en `packages/natives` |

## 10) Indicadores de tiempo de ejecución de TUI (paquete compartido, afecta la experiencia de usuario de coding-agent)

| Variable | Comportamiento |
|---|---|
| `PI_NOTIFICATIONS` | `off` / `0` / `false` suprime las notificaciones de escritorio |
| `PI_TUI_WRITE_LOG` | Si está establecida, registra las escrituras de TUI en un archivo |
| `PI_HARDWARE_CURSOR` | Si es `1`, habilita el modo de cursor por hardware |
| `PI_CLEAR_ON_SHRINK` | Si es `1`, limpia las filas vacías cuando el contenido se reduce |
| `PI_DEBUG_REDRAW` | Si es `1`, habilita el registro de depuración de redibujado |
| `PI_TUI_DEBUG` | Si es `1`, habilita la ruta de volcado de depuración profunda de TUI |

---

## 11) Controles de generación de commits

| Variable | Comportamiento |
|---|---|
| `PI_COMMIT_TEST_FALLBACK` | Si es `true` (insensible a mayúsculas), fuerza la ruta de generación de respaldo de commits |
| `PI_COMMIT_NO_FALLBACK` | Si es `true`, deshabilita el respaldo cuando el agente no devuelve ninguna propuesta |
| `PI_COMMIT_MAP_REDUCE` | Si es `false`, deshabilita la ruta de análisis map-reduce de commits |
| `DEBUG` | Si está establecida, se imprimen las trazas de pila de errores del agente de commits |

---

## Variables sensibles de seguridad

Trate estas como secretos; no las registre ni las confirme en el repositorio:

- Claves API de proveedor y credenciales OAuth/bearer (todos los `*_API_KEY`, `*_TOKEN`, tokens de acceso/actualización OAuth)
- Credenciales de la nube (`AWS_*`, la ruta de `GOOGLE_APPLICATION_CREDENTIALS` puede exponer material de cuentas de servicio)
- Variables de autenticación de búsqueda/proveedor (`EXA_API_KEY`, `BRAVE_API_KEY`, `PERPLEXITY_API_KEY`, claves de búsqueda de Anthropic)
- Material mTLS de Foundry (`CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY`, `NODE_EXTRA_CA_CERTS` cuando apunta a paquetes de CA privados)

El tiempo de ejecución de Python también elimina explícitamente muchas variables de claves comunes antes de generar subprocesos de kernel (`packages/coding-agent/src/ipy/runtime.ts`).
