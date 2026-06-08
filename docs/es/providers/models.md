---
title: Model and Provider Configuration
description: >-
  Model registry and provider configuration via models.yml with routing,
  fallback, and pricing.
sidebar:
  order: 1
  label: Models & providers
i18n:
  sourceHash: 5f72a90277a4
  translator: machine
---

# Configuración de modelos y proveedores (`models.yml`)

Este documento describe cómo el coding-agent carga actualmente los modelos, aplica sobreescrituras, resuelve credenciales y elige modelos en tiempo de ejecución.

## Qué controla el comportamiento de los modelos

Archivos de implementación principales:

- `src/config/model-registry.ts` — carga modelos integrados + personalizados, sobreescrituras de proveedores, descubrimiento en tiempo de ejecución, integración de autenticación
- `src/config/model-resolver.ts` — analiza patrones de modelos y selecciona modelos initial/smol/slow
- `src/config/settings-schema.ts` — configuraciones relacionadas con modelos (`modelRoles`, preferencias de transporte de proveedores)
- `src/session/auth-storage.ts` — orden de resolución de claves API + OAuth
- `packages/ai/src/models.ts` y `packages/ai/src/types.ts` — proveedores/modelos integrados y tipos `Model`/`compat`

## Ubicación del archivo de configuración y comportamiento heredado

Ruta de configuración por defecto:

- `~/.xcsh/agent/models.yml`

Comportamiento heredado aún presente:

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

`configVersion` es un entero opcional escrito por el sistema de auto-configuración. Cuando está presente, xcsh lo utiliza para detectar configuraciones desactualizadas y actualizarlas automáticamente.

`provider-id` es la clave canónica del proveedor utilizada en la selección y la búsqueda de autenticación.

`equivalence` es opcional y configura la agrupación canónica de modelos sobre los modelos concretos del proveedor:

- `overrides` mapea un selector concreto exacto (`provider/modelId`) a un id canónico oficial upstream
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

### Valores permitidos de `api` para proveedor/modelo

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valores permitidos de auth/discovery

- `auth`: `apiKey` (por defecto) o `none`
- `discovery.type`: `ollama`

## Reglas de validación (actuales)

### Proveedor personalizado completo (`models` no está vacío)

Requerido:

- `baseUrl`
- `apiKey` a menos que `auth: none`
- `api` a nivel de proveedor o en cada modelo

### Proveedor solo de sobreescritura (`models` ausente o vacío)

Debe definir al menos uno de:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Discovery

- `discovery` requiere `api` a nivel de proveedor.

### Validaciones de valores del modelo

- `id` requerido
- `contextWindow` y `maxTokens` deben ser positivos si se proporcionan

## Orden de fusión y sobreescritura

Pipeline de ModelRegistry (al refrescar):

1. Cargar proveedores/modelos integrados desde `@f5xc-salesdemos/pi-ai`.
2. Cargar configuración personalizada de `models.yml`.
3. Aplicar sobreescrituras del proveedor (`baseUrl`, `headers`) a los modelos integrados.
4. Aplicar `modelOverrides` (por proveedor + id del modelo).
5. Fusionar `models` personalizados:
   - mismo `provider + id` reemplaza el existente
   - de lo contrario, se añade
6. Aplicar modelos descubiertos en tiempo de ejecución (actualmente Ollama y LM Studio), luego reaplicar las sobreescrituras del modelo.

## Equivalencia canónica de modelos y coalescencia

El registro mantiene cada modelo concreto del proveedor y luego construye una capa canónica por encima de ellos.

Los ids canónicos son ids oficiales upstream únicamente, por ejemplo:

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

1. sobreescritura exacta del usuario desde `equivalence.overrides`
2. coincidencias de id oficial incluidas en los metadatos integrados del modelo
3. normalización heurística conservadora para variantes de gateway/proveedor
4. respaldo al id propio del modelo concreto

Las heurísticas actuales son intencionalmente estrechas:

- los prefijos upstream embebidos pueden eliminarse cuando están presentes, por ejemplo `anthropic/...` u `openai/...`
- las variantes de versión con puntos y guiones pueden normalizarse solo cuando mapean a un id oficial existente, por ejemplo `4.6 -> 4-6`
- las familias o versiones ambiguas no se fusionan sin una coincidencia incluida o una sobreescritura explícita

### Comportamiento de resolución canónica

Cuando múltiples variantes concretas comparten un id canónico, la resolución utiliza:

1. disponibilidad y autenticación
2. `modelProviderOrder` de `config.yml`
3. orden existente del registro/proveedor si `modelProviderOrder` no está configurado

Los proveedores deshabilitados o no autenticados se omiten.

El estado de la sesión y las transcripciones continúan registrando el proveedor/modelo concreto que realmente ejecutó el turno.

Valores por defecto del proveedor vs sobreescrituras por modelo:

- Los `headers` del proveedor son la línea base.
- Los `headers` del modelo sobreescriben las claves de cabecera del proveedor.
- `modelOverrides` puede sobreescribir metadatos del modelo (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` se fusiona en profundidad para bloques de enrutamiento anidados (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integración de descubrimiento en tiempo de ejecución

### Descubrimiento implícito de Ollama

Si `ollama` no está configurado explícitamente, el registro añade un proveedor descubrible implícito:

- proveedor: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modo de autenticación: sin clave (comportamiento `auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET /api/tags` en Ollama y sintetiza entradas de modelo con valores locales por defecto.

### Descubrimiento implícito de llama.cpp

Si `llama.cpp` no está configurado explícitamente, el registro añade un proveedor descubrible implícito:
Nota: está usando la API de mensajes antropic más nueva en lugar de openai-completions.

- proveedor: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modo de autenticación: sin clave (comportamiento `auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET models` en llama.cpp y sintetiza entradas de modelo con valores locales por defecto.

### Descubrimiento implícito de LM Studio

Si `lm-studio` no está configurado explícitamente, el registro añade un proveedor descubrible implícito:

- proveedor: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modo de autenticación: sin clave (comportamiento `auth: none`)

El descubrimiento en tiempo de ejecución obtiene los modelos (`GET /models`) y sintetiza entradas de modelo con valores locales por defecto.

### Descubrimiento explícito de proveedores

Puede configurar el descubrimiento usted mismo:

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

### Registro de proveedores por extensiones

Las extensiones pueden registrar proveedores en tiempo de ejecución (`pi.registerProvider(...)`), incluyendo:

- reemplazo/adición de modelos para un proveedor
- registro de manejadores de stream personalizados para nuevos IDs de API
- registro de proveedores OAuth personalizados

## Orden de resolución de autenticación y claves API

Al solicitar una clave para un proveedor, el orden efectivo es:

1. Sobreescritura en tiempo de ejecución (CLI `--api-key`)
2. Credencial de clave API almacenada en `agent.db`
3. Credencial OAuth almacenada en `agent.db` (con refresco)
4. Mapeo de variable de entorno (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Resolutor de respaldo de ModelRegistry (`apiKey` del proveedor desde `models.yml`, semántica nombre-de-env-o-literal)

Comportamiento de `apiKey` en `models.yml`:

- El valor se trata primero como un nombre de variable de entorno.
- Si no existe la variable de entorno, la cadena literal se usa como token.

Si `authHeader: true` y el `apiKey` del proveedor está configurado, los modelos reciben:

- Cabecera `Authorization: Bearer <clave-resuelta>` inyectada.

Proveedores sin clave:

- Los proveedores marcados con `auth: none` se tratan como disponibles sin credenciales.
- `getApiKey*` retorna `kNoAuth` para ellos.

## Disponibilidad de modelos vs todos los modelos

- `getAll()` retorna el registro de modelos cargado (integrados + personalizados fusionados + descubiertos).
- `getAvailable()` filtra a los modelos que no requieren clave o tienen autenticación resoluble.

Por lo tanto, un modelo puede existir en el registro pero no ser seleccionable hasta que la autenticación esté disponible.

## Resolución de modelos en tiempo de ejecución

### CLI y análisis de patrones

`model-resolver.ts` soporta:

- exacto `provider/modelId`
- id canónico exacto del modelo
- id exacto del modelo (proveedor inferido)
- coincidencia difusa/subcadena
- patrones de ámbito glob en `--models` (p. ej. `openai/*`, `*sonnet*`)
- sufijo opcional `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` es heredado; `--model` es preferido.

Precedencia de resolución para selectores exactos:

1. `provider/modelId` exacto omite la coalescencia
2. id canónico exacto se resuelve a través del índice canónico
3. id concreto exacto sin proveedor aún funciona
4. la coincidencia difusa y glob se ejecuta después de las rutas exactas

### Prioridad de selección del modelo inicial

`findInitialModel(...)` usa este orden:

1. proveedor+modelo explícito del CLI
2. primer modelo del ámbito (si no se está reanudando)
3. proveedor/modelo por defecto guardado
4. valores por defecto de proveedores conocidos (p. ej. OpenAI/Anthropic/etc.) entre los modelos disponibles
5. primer modelo disponible

### Alias de roles y configuraciones

Roles de modelo soportados:

- `default`, `smol`, `slow`, `plan`, `commit`

Los alias de roles como `pi/smol` se expanden a través de `settings.modelRoles`. Cada valor de rol también puede añadir un selector de pensamiento como `:minimal`, `:low`, `:medium` o `:high`.

Si un rol apunta a otro rol, el modelo objetivo aún hereda normalmente y cualquier sufijo explícito en el rol referente prevalece para ese uso específico del rol.

Configuraciones relacionadas:

- `modelRoles` (registro)
- `enabledModels` (lista de patrones con ámbito)
- `modelProviderOrder` (precedencia global canónica-proveedor)
- `providers.kimiApiFormat` (formato de solicitud `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferencia de websocket `auto|off|on` para el transporte OpenAI Codex)

`modelRoles` puede almacenar:

- `provider/modelId` para fijar una variante concreta del proveedor
- un id canónico como `gpt-5.3-codex` para permitir la coalescencia de proveedores

Para `enabledModels` y CLI `--models`:

- los ids canónicos exactos se expanden a todas las variantes concretas en ese grupo canónico
- las entradas explícitas `provider/modelId` permanecen exactas
- los globs y coincidencias difusas aún operan sobre modelos concretos

## `/model` y `--list-models`

Ambas superficies mantienen los modelos con prefijo de proveedor visibles y seleccionables.

Ahora también exponen modelos canónicos/coalescidos:

- `/model` incluye una vista canónica junto a las pestañas de proveedores
- `--list-models` imprime una sección canónica más las filas concretas del proveedor

Seleccionar una entrada canónica almacena el selector canónico. Seleccionar una fila de proveedor almacena el `provider/modelId` explícito.

## Promoción de contexto (cadenas de respaldo a nivel de modelo)

La promoción de contexto es un mecanismo de recuperación por desbordamiento para variantes de contexto pequeño (por ejemplo `*-spark`) que promueve automáticamente a un modelo hermano de contexto más grande cuando la API rechaza una solicitud con un error de longitud de contexto.

### Activación y orden

Cuando un turno falla con un error de desbordamiento de contexto (p. ej. `context_length_exceeded`), `AgentSession` intenta la promoción **antes** de recurrir a la compactación:

1. Si `contextPromotion.enabled` es true, resolver un objetivo de promoción (ver abajo).
2. Si se encuentra un objetivo, cambiar a él y reintentar la solicitud — sin necesidad de compactación.
3. Si no hay objetivo disponible, continuar con la auto-compactación en el modelo actual.

### Selección del objetivo

La selección está orientada al modelo, no al rol:

1. `currentModel.contextPromotionTarget` (si está configurado)
2. modelo de contexto más grande más pequeño en el mismo proveedor + API

Los candidatos se ignoran a menos que las credenciales se resuelvan (`ModelRegistry.getApiKey(...)`).

### Transferencia de websocket de OpenAI Codex

Si se cambia desde/hacia `openai-codex-responses`, la clave de estado del proveedor de sesión `openai-codex-responses` se cierra antes del cambio de modelo. Esto elimina el estado de transporte websocket para que el siguiente turno comience limpio en el modelo promovido.

### Comportamiento de persistencia

La promoción usa cambio temporal (`setModelTemporary`):

- se registra como un `model_change` temporal en el historial de la sesión
- no reescribe el mapeo de roles guardado

### Configurar cadenas de respaldo explícitas

Configure el respaldo directamente en los metadatos del modelo mediante `contextPromotionTarget`.

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

El generador de modelos integrado también asigna esto automáticamente para modelos `*-spark` cuando existe un modelo base del mismo proveedor.

## Campos de compatibilidad y enrutamiento

`models.yml` soporta este subconjunto de `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Estos son consumidos por la lógica de transporte OpenAI-completions y combinados con la auto-detección basada en URL.

## Ejemplos prácticos

### Endpoint local compatible con OpenAI (sin autenticación)

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

### Proxy alojado con clave basada en variable de entorno

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

### Sobreescribir ruta del proveedor integrado + metadatos del modelo

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

## Auto-configuración del proxy LiteLLM

Cuando las variables de entorno `LITELLM_BASE_URL` y `LITELLM_API_KEY` están configuradas, xcsh gestiona automáticamente la configuración de `models.yml` para el proxy LiteLLM.

### Auto-generación en la primera ejecución

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

También se genera un `config.yml` por defecto con configuraciones sensatas del proveedor de imágenes.

### Auto-reparación al inicio

En cada inicio, `startupHealthCheck()` en el registro de modelos ejecuta las siguientes verificaciones:

| Condición | Acción |
|-----------|--------|
| `models.yml` ausente | Auto-generar desde variables de entorno |
| `models.yml` corrupto o no analizable | Respaldar a `.bak`, regenerar |
| `baseUrl` no coincide con `LITELLM_BASE_URL` | Respaldar a `.bak`, regenerar con nueva URL |
| `configVersion` ausente o desactualizado | Respaldar a `.bak`, regenerar con versión actual |
| La configuración está sana | Sin acción |

Todas las reparaciones crean respaldos `.bak` antes de sobreescribir. Todas las operaciones son idempotentes.

### Comando CLI

```bash
xcsh setup litellm              # Generate or fix LiteLLM config
xcsh setup litellm --check      # Validate without writing
xcsh setup litellm --check --json  # Machine-readable validation output
```

### Variables de entorno requeridas

| Variable | Propósito |
|----------|---------|
| `LITELLM_BASE_URL` | URL del proxy LiteLLM (p. ej. `https://your-proxy.example.com`). Debe comenzar con `http://` o `https://`. |
| `LITELLM_API_KEY` | Clave API para el proxy. Referenciada por nombre en la configuración generada, resuelta en tiempo de ejecución. |

Si alguna de las variables no está configurada, la auto-configuración se omite silenciosamente.

### Versionado de configuración

Las configuraciones generadas incluyen un campo `configVersion`. Cuando el formato generado cambia en futuras versiones, xcsh detecta configuraciones desactualizadas y las actualiza automáticamente (con respaldo).

## Advertencia sobre consumidores heredados

La mayoría de la configuración de modelos ahora fluye a través de `models.yml` vía `ModelRegistry`.

Una ruta heredada notable permanece: la resolución de autenticación Anthropic para búsqueda web aún lee `~/.xcsh/agent/models.json` directamente en `src/web/search/auth.ts`.

Si depende de esa ruta específica, tenga en cuenta la compatibilidad JSON hasta que ese módulo sea migrado.

## Modo de fallo

Si `models.yml` falla las verificaciones de esquema o validación:

- Si `LITELLM_BASE_URL` y `LITELLM_API_KEY` están configuradas, la verificación de salud al inicio intenta la auto-reparación (respaldar archivo corrupto, regenerar desde variables de entorno). Si la reparación tiene éxito, el registro recarga la configuración corregida.
- Si la auto-reparación no es posible (variables de entorno no configuradas, fallo de escritura), el registro continúa operando con los modelos integrados.
- El error se expone a través de `ModelRegistry.getError()` y se muestra en la interfaz/notificaciones.
