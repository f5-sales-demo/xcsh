---
title: Configuración de modelos y proveedores
description: >-
  Registro de modelos y configuración de proveedores mediante models.yml con
  enrutamiento, respaldo y precios.
sidebar:
  order: 1
  label: Modelos y proveedores
i18n:
  sourceHash: 8053df967ff6
  translator: machine
---

# Configuración de modelos y proveedores (`models.yml`)

Este documento describe cómo el agente de codificación carga actualmente los modelos, aplica anulaciones, resuelve credenciales y selecciona modelos en tiempo de ejecución.

## Qué controla el comportamiento de los modelos

Archivos de implementación principales:

- `src/config/model-registry.ts` — carga modelos integrados y personalizados, anulaciones de proveedores, descubrimiento en tiempo de ejecución, integración de autenticación
- `src/config/model-resolver.ts` — analiza patrones de modelos y selecciona modelos inicial/smol/slow
- `src/config/settings-schema.ts` — configuraciones relacionadas con modelos (`modelRoles`, preferencias de transporte del proveedor)
- `src/session/auth-storage.ts` — orden de resolución de clave API + OAuth
- `packages/ai/src/models.ts` y `packages/ai/src/types.ts` — proveedores/modelos integrados y tipos `Model`/`compat`

## Ubicación del archivo de configuración y comportamiento heredado

Ruta de configuración predeterminada:

- `~/.xcsh/agent/models.yml`

Comportamiento heredado que aún está presente:

- Si `models.yml` no existe y `models.json` existe en la misma ubicación, se migra a `models.yml`.
- Las rutas de configuración explícitas `.json` / `.jsonc` aún se admiten cuando se pasan programáticamente a `ModelRegistry`.

## Estructura de `models.yml`

```yaml
configVersion: 1  # optional — written by auto-config, used for migration detection
providers:
  <provider-id>:
    # provider-level config
equivalence:
  overrides:
    <provider-id>/<model-id>: <canonical-model-id>
  exclude:
    - <provider-id>/<model-id>
```

`configVersion` es un entero opcional escrito por el sistema de autoconfiguración. Cuando está presente, xcsh lo usa para detectar configuraciones desactualizadas y actualizarlas automáticamente.

`provider-id` es la clave canónica del proveedor utilizada en la selección y la búsqueda de autenticación.

`equivalence` es opcional y configura la agrupación canónica de modelos sobre los modelos de proveedor concretos:

- `overrides` asigna un selector concreto exacto (`provider/modelId`) a un id canónico oficial de nivel superior
- `exclude` excluye un selector concreto de la agrupación canónica

## Campos a nivel de proveedor

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: MY_PROVIDER_API_KEY
    api: openai-completions
    headers:
      X-Team: platform
    authHeader: true
    auth: apiKey
    discovery:
      type: ollama
    modelOverrides:
      some-model-id:
        name: Renamed model
    models:
      - id: some-model-id
        name: Some Model
        api: openai-completions
        reasoning: false
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 128000
        maxTokens: 16384
        headers:
          X-Model: value
        compat:
          supportsStore: true
          supportsDeveloperRole: true
          supportsReasoningEffort: true
          maxTokensField: max_completion_tokens
          openRouterRouting:
            only: [anthropic]
          vercelGatewayRouting:
            order: [anthropic, openai]
          extraBody:
            gateway: m1-01
            controller: mlx
```

### Valores de `api` permitidos para proveedor/modelo

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valores permitidos de auth/discovery

- `auth`: `apiKey` (predeterminado) o `none`
- `discovery.type`: `ollama`

## Reglas de validación (actuales)

### Proveedor completamente personalizado (`models` no está vacío)

Obligatorio:

- `baseUrl`
- `apiKey` a menos que `auth: none`
- `api` a nivel de proveedor o en cada modelo

### Proveedor solo de anulación (`models` faltante o vacío)

Debe definir al menos uno de:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` requiere `api` a nivel de proveedor.

### Verificaciones de valores del modelo

- `id` es obligatorio
- `contextWindow` y `maxTokens` deben ser positivos si se proporcionan

## Orden de combinación y anulación

Proceso de ModelRegistry (al actualizar):

1. Cargar proveedores/modelos integrados desde `@f5-sales-demo/pi-ai`.
2. Cargar la configuración personalizada de `models.yml`.
3. Aplicar anulaciones de proveedor (`baseUrl`, `headers`) a los modelos integrados.
4. Aplicar `modelOverrides` (por proveedor + id de modelo).
5. Combinar `models` personalizados:
   - el mismo `provider + id` reemplaza al existente
   - de lo contrario, se anexa
6. Aplicar modelos descubiertos en tiempo de ejecución (actualmente Ollama y LM Studio), y luego volver a aplicar las anulaciones de modelo.

## Equivalencia canónica y coalescencia de modelos

El registro mantiene cada modelo de proveedor concreto y luego construye una capa canónica sobre ellos.

Los ids canónicos son únicamente ids oficiales de nivel superior, por ejemplo:

- `claude-opus-4-6`
- `claude-haiku-4-5`
- `gpt-5.3-codex`

### Configuración de equivalencia en `models.yml`

Ejemplo:

```yaml
providers:
  zenmux:
    baseUrl: https://api.zenmux.example/v1
    apiKey: ZENMUX_API_KEY
    api: openai-codex-responses
    models:
      - id: codex
        name: Zenmux Codex
        reasoning: true
        input: [text]
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
        contextWindow: 200000
        maxTokens: 32768

equivalence:
  overrides:
    zenmux/codex: gpt-5.3-codex
    p-codex/codex: gpt-5.3-codex
  exclude:
    - demo/codex-preview
```

Orden de construcción para la agrupación canónica:

1. anulación de usuario exacta desde `equivalence.overrides`
2. coincidencias de id oficial incluidas desde los metadatos del modelo integrado
3. normalización heurística conservadora para variantes de gateway/proveedor
4. reserva al id propio del modelo concreto

Las heurísticas actuales son intencionalmente restrictivas:

- los prefijos de nivel superior incrustados se pueden eliminar cuando están presentes, por ejemplo `anthropic/...` o `openai/...`
- las variantes de versión con puntos y guiones pueden normalizarse solo cuando se asignan a un id oficial existente, por ejemplo `4.6 -> 4-6`
- las familias o versiones ambiguas no se combinan sin una coincidencia incluida o una anulación explícita

### Comportamiento de resolución canónica

Cuando múltiples variantes concretas comparten un id canónico, la resolución usa:

1. disponibilidad y autenticación
2. `modelProviderOrder` en `config.yml`
3. orden de registro/proveedor existente si `modelProviderOrder` no está definido

Los proveedores deshabilitados o no autenticados se omiten.

El estado de sesión y las transcripciones continúan registrando el proveedor/modelo concreto que ejecutó el turno.

Valores predeterminados del proveedor frente a anulaciones por modelo:

- Los `headers` del proveedor son la base.
- Los `headers` del modelo anulan las claves de encabezado del proveedor.
- `modelOverrides` puede anular metadatos del modelo (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` se combina en profundidad para los bloques de enrutamiento anidados (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integración de descubrimiento en tiempo de ejecución

### Descubrimiento implícito de Ollama

Si `ollama` no está configurado explícitamente, el registro añade un proveedor de descubrimiento implícito:

- proveedor: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modo de autenticación: sin clave (`auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET /api/tags` en Ollama y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento implícito de llama.cpp

Si `llama.cpp` no está configurado explícitamente, el registro añade un proveedor de descubrimiento implícito:
Nota: utiliza la API de mensajes de Anthropic más reciente en lugar de openai-completions.

- proveedor: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modo de autenticación: sin clave (`auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET models` en llama.cpp y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento implícito de LM Studio

Si `lm-studio` no está configurado explícitamente, el registro añade un proveedor de descubrimiento implícito:

- proveedor: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modo de autenticación: sin clave (`auth: none`)

El descubrimiento en tiempo de ejecución obtiene los modelos (`GET /models`) y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento de proveedor explícito

Puede configurar el descubrimiento manualmente:

```yaml
providers:
  ollama:
    baseUrl: http://127.0.0.1:11434
    api: openai-completions
    auth: none
    discovery:
      type: ollama
      
  llama.cpp:
    baseUrl: http://127.0.0.1:8080
    api: openai-responses
    auth: none
    discovery:
      type: llama.cpp
```

### Registro de proveedor por extensión

Las extensiones pueden registrar proveedores en tiempo de ejecución (`pi.registerProvider(...)`), incluyendo:

- reemplazo/anexo de modelos para un proveedor
- registro de manejador de flujo personalizado para nuevos IDs de API
- registro de proveedor OAuth personalizado

## Orden de resolución de autenticación y clave API

Al solicitar una clave para un proveedor, el orden efectivo es:

1. Anulación en tiempo de ejecución (CLI `--api-key`)
2. Credencial de clave API almacenada en `agent.db`
3. Credencial OAuth almacenada en `agent.db` (con actualización)
4. Asignación de variables de entorno (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Resolvedor de reserva de ModelRegistry (`apiKey` del proveedor desde `models.yml`, semántica de nombre-de-entorno-o-literal)

Comportamiento de `apiKey` en `models.yml`:

- El valor se trata primero como un nombre de variable de entorno.
- Si no existe la variable de entorno, se usa la cadena literal como token.

Si `authHeader: true` y el `apiKey` del proveedor está definido, los modelos reciben:

- encabezado `Authorization: Bearer <clave-resuelta>` inyectado.

Proveedores sin clave:

- Los proveedores marcados como `auth: none` se tratan como disponibles sin credenciales.
- `getApiKey*` devuelve `kNoAuth` para ellos.

## Disponibilidad de modelos frente a todos los modelos

- `getAll()` devuelve el registro de modelos cargado (integrados + personalizados combinados + descubiertos).
- `getAvailable()` filtra a los modelos que no requieren clave o tienen autenticación resoluble.

Por lo tanto, un modelo puede existir en el registro pero no ser seleccionable hasta que la autenticación esté disponible.

## Resolución de modelos en tiempo de ejecución

### CLI y análisis de patrones

`model-resolver.ts` admite:

- `provider/modelId` exacto
- id de modelo canónico exacto
- id de modelo exacto (proveedor inferido)
- coincidencia difusa/por subcadena
- patrones de alcance glob en `--models` (p. ej., `openai/*`, `*sonnet*`)
- sufijo opcional `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` es heredado; se prefiere `--model`.

Precedencia de resolución para selectores exactos:

1. `provider/modelId` exacto omite la coalescencia
2. el id canónico exacto se resuelve a través del índice canónico
3. el id concreto simple exacto sigue funcionando
4. la coincidencia difusa y glob se ejecuta después de las rutas exactas

### Prioridad de selección del modelo inicial

`findInitialModel(...)` usa este orden:

1. proveedor+modelo explícito del CLI
2. primer modelo del alcance (si no se está reanudando)
3. proveedor/modelo predeterminado guardado
4. valores predeterminados de proveedores conocidos (p. ej., OpenAI/Anthropic/etc.) entre los modelos disponibles
5. primer modelo disponible

### Alias de roles y configuraciones

Roles de modelo admitidos:

- `default`, `smol`, `slow`, `plan`, `commit`

Los alias de roles como `pi/smol` se expanden a través de `settings.modelRoles`. Cada valor de rol también puede añadir un selector de razonamiento como `:minimal`, `:low`, `:medium` o `:high`.

Si un rol apunta a otro rol, el modelo destino sigue siendo heredado normalmente y cualquier sufijo explícito en el rol referenciante tiene prioridad para ese uso específico del rol.

Configuraciones relacionadas:

- `modelRoles` (registro)
- `enabledModels` (lista de patrones de alcance)
- `modelProviderOrder` (precedencia canónica global de proveedores)
- `providers.kimiApiFormat` (formato de solicitud `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferencia de websocket `auto|off|on` para el transporte OpenAI Codex)

`modelRoles` puede almacenar:

- `provider/modelId` para fijar una variante de proveedor concreta
- un id canónico como `gpt-5.3-codex` para permitir la coalescencia de proveedores

Para `enabledModels` y CLI `--models`:

- los ids canónicos exactos se expanden a todas las variantes concretas en ese grupo canónico
- las entradas explícitas `provider/modelId` permanecen exactas
- los globs y las coincidencias difusas aún operan sobre modelos concretos

## `/model` y `--list-models`

Ambas superficies mantienen los modelos con prefijo de proveedor visibles y seleccionables.

Ahora también exponen modelos canónicos/coalescidos:

- `/model` incluye una vista canónica junto a las pestañas de proveedor
- `--list-models` imprime una sección canónica además de las filas de proveedor concreto

Seleccionar una entrada canónica almacena el selector canónico. Seleccionar una fila de proveedor almacena el `provider/modelId` explícito.

## Promoción de contexto (cadenas de reserva a nivel de modelo)

La promoción de contexto es un mecanismo de recuperación por desbordamiento para variantes de contexto pequeño (por ejemplo, `*-spark`) que promueve automáticamente a un hermano de mayor contexto cuando la API rechaza una solicitud con un error de longitud de contexto.

### Activación y orden

Cuando un turno falla con un error de desbordamiento de contexto (p. ej., `context_length_exceeded`), `AgentSession` intenta la promoción **antes** de recurrir a la compactación:

1. Si `contextPromotion.enabled` es verdadero, resolver un destino de promoción (ver más abajo).
2. Si se encuentra un destino, cambiar a él y reintentar la solicitud — no se necesita compactación.
3. Si no hay destino disponible, pasar a la compactación automática en el modelo actual.

### Selección del destino

La selección está impulsada por el modelo, no por el rol:

1. `currentModel.contextPromotionTarget` (si está configurado)
2. el modelo de mayor contexto más pequeño en el mismo proveedor + API

Los candidatos se ignoran a menos que las credenciales se resuelvan (`ModelRegistry.getApiKey(...)`).

### Transferencia de websocket de OpenAI Codex

Al cambiar desde/hacia `openai-codex-responses`, la clave de estado de proveedor de sesión `openai-codex-responses` se cierra antes del cambio de modelo. Esto elimina el estado de transporte de websocket para que el siguiente turno comience limpio en el modelo promovido.

### Comportamiento de persistencia

La promoción usa conmutación temporal (`setModelTemporary`):

- registrada como un `model_change` temporal en el historial de sesión
- no reescribe la asignación de roles guardada

### Configuración de cadenas de reserva explícitas

Configure la reserva directamente en los metadatos del modelo mediante `contextPromotionTarget`.

`contextPromotionTarget` acepta:

- `provider/model-id` (explícito)
- `model-id` (resuelto dentro del proveedor actual)

Ejemplo (`models.yml`) para Spark -> no-Spark en el mismo proveedor:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

El generador de modelos integrado también asigna esto automáticamente para los modelos `*-spark` cuando existe un modelo base en el mismo proveedor.

## Campos de compatibilidad y enrutamiento

`models.yml` admite este subconjunto de `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Estos son consumidos por la lógica de transporte de OpenAI-completions y se combinan con la detección automática basada en URL.

## Ejemplos prácticos

### Punto de conexión compatible con OpenAI local (sin autenticación)

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    auth: none
    api: openai-completions
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
        name: Qwen 2.5 Coder 32B (local)
```

### Proxy alojado con clave basada en variables de entorno

```yaml
providers:
  anthropic-proxy:
    baseUrl: https://proxy.example.com/anthropic
    apiKey: ANTHROPIC_PROXY_API_KEY
    api: anthropic-messages
    authHeader: true
    models:
      - id: claude-sonnet-4-20250514
        name: Claude Sonnet 4 (Proxy)
        reasoning: true
        input: [text, image]
```

### Anular ruta de proveedor integrado + metadatos del modelo

```yaml
providers:
  openrouter:
    baseUrl: https://my-proxy.example.com/v1
    headers:
      X-Team: platform
    modelOverrides:
      anthropic/claude-sonnet-4:
        name: Sonnet 4 (Corp)
        compat:
          openRouterRouting:
            only: [anthropic]
```

## Autoconfiguración del proxy LiteLLM

Cuando las variables de entorno `LITELLM_BASE_URL` y `LITELLM_API_KEY` están definidas, xcsh gestiona automáticamente la configuración de `models.yml` para el proxy LiteLLM.

### Generación automática en la primera ejecución

Si `models.yml` no existe y se detectan las variables de entorno de LiteLLM, xcsh lo genera automáticamente:

```yaml
# Auto-generated by xcsh for LiteLLM proxy
# API key resolved from LITELLM_API_KEY env var at runtime
configVersion: 1
providers:
  anthropic:
    baseUrl: "https://your-litellm-proxy.example.com/anthropic"
    apiKey: LITELLM_API_KEY
```

También se genera un `config.yml` predeterminado con configuraciones de proveedor de imágenes sensatas.

### Autocorrección al inicio

En cada inicio, `startupHealthCheck()` en el registro de modelos ejecuta las siguientes comprobaciones:

| Condición | Acción |
|-----------|--------|
| `models.yml` faltante | Generar automáticamente desde variables de entorno |
| `models.yml` corrupto o no analizable | Hacer copia de seguridad como `.bak`, regenerar |
| `baseUrl` no coincide con `LITELLM_BASE_URL` | Hacer copia de seguridad como `.bak`, regenerar con la nueva URL |
| `configVersion` faltante o desactualizado | Hacer copia de seguridad como `.bak`, regenerar con la versión actual |
| La configuración está en buen estado | Sin acción |

Todas las reparaciones crean copias de seguridad `.bak` antes de sobrescribir. Todas las operaciones son idempotentes.

### Comando CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### Variables de entorno requeridas

| Variable | Propósito |
|----------|---------|
| `LITELLM_BASE_URL` | URL del proxy LiteLLM (p. ej., `https://your-proxy.example.com`). Debe comenzar con `http://` o `https://`. |
| `LITELLM_API_KEY` | Clave API para el proxy. Referenciada por nombre en la configuración generada, resuelta en tiempo de ejecución. |

Si alguna de las variables no está definida, la autoconfiguración se omite silenciosamente.

### Versionado de configuración

Las configuraciones generadas incluyen un campo `configVersion`. Cuando el formato generado cambie en versiones futuras, xcsh detecta las configuraciones desactualizadas y las actualiza automáticamente (con copia de seguridad).

## Advertencia sobre consumidores heredados

La mayor parte de la configuración de modelos ahora fluye a través de `models.yml` mediante `ModelRegistry`.

Queda una ruta heredada notable: la resolución de autenticación de Anthropic para búsqueda web aún lee `~/.xcsh/agent/models.json` directamente en `src/web/search/auth.ts`.

Si depende de esa ruta específica, tenga en cuenta la compatibilidad con JSON hasta que ese módulo sea migrado.

## Modo de fallo

Si `models.yml` falla las comprobaciones de esquema o validación:

- Si `LITELLM_BASE_URL` y `LITELLM_API_KEY` están definidos, la comprobación de estado al inicio intenta la reparación automática (hacer copia de seguridad del archivo corrupto, regenerar desde las variables de entorno). Si la reparación tiene éxito, el registro recarga la configuración corregida.
- Si la reparación automática no es posible (variables de entorno no definidas, fallo de escritura), el registro continúa operando con los modelos integrados.
- El error se expone a través de `ModelRegistry.getError()` y se muestra en la interfaz de usuario/notificaciones.
