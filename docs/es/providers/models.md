---
title: Configuración de modelos y proveedores
description: Registro de modelos y configuración de proveedores a través de models.yml con enrutamiento, respaldo y precios.
sidebar:
  order: 1
  label: Modelos y proveedores
i18n:
  sourceHash: "8053df967ff6"
  translator: "machine"
---

# Configuración de modelos y proveedores (`models.yml`)

Este documento describe cómo el agente de codificación carga actualmente los modelos, aplica las anulaciones, resuelve las credenciales y elige los modelos en tiempo de ejecución.

## Qué controla el comportamiento del modelo

Archivos de implementación principales:

- `src/config/model-registry.ts` — carga modelos integrados + personalizados, anulaciones de proveedores, descubrimiento en tiempo de ejecución, integración de autenticación
- `src/config/model-resolver.ts` — analiza los patrones de modelo y selecciona los modelos iniciales/smol/slow
- `src/config/settings-schema.ts` — configuración relacionada con el modelo (`modelRoles`, preferencias de transporte del proveedor)
- `src/session/auth-storage.ts` — orden de resolución de clave de API + OAuth
- `packages/ai/src/models.ts` y `packages/ai/src/types.ts` — proveedores/modelos integrados y tipos `Model`/`compat`

## Ubicación del archivo de configuración y comportamiento heredado

Ruta de configuración predeterminada:

- `~/.xcsh/agent/models.yml`

Comportamiento heredado aún presente:

- Si falta `models.yml` y existe `models.json` en la misma ubicación, se migra a `models.yml`.
- Aún se admiten las rutas de configuración explícitas `.json` / `.jsonc` cuando se pasan mediante programación a `ModelRegistry`.

## Forma de `models.yml`

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

`configVersion` es un número entero opcional escrito por el sistema de configuración automática. Cuando está presente, xcsh lo usa para detectar configuraciones desactualizadas y actualizarlas automáticamente.

`provider-id` es la clave canónica del proveedor utilizada en toda la selección y búsqueda de autenticación.

`equivalence` es opcional y configura la agrupación de modelos canónicos además de los modelos de proveedores concretos:

- `overrides` asigna un selector concreto exacto (`provider/modelId`) a un ID canónico oficial ascendente (upstream)
- `exclude` excluye a un selector concreto de la agrupación canónica

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

### Valores permitidos de `api` de proveedor/modelo

- `openai-completions`
- `openai-responses`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`

### Valores permitidos de autenticación/descubrimiento

- `auth`: `apiKey` (predeterminado) o `none`
- `discovery.type`: `ollama`

## Reglas de validación (actuales)

### Proveedor personalizado completo (`models` no está vacío)

Requerido:

- `baseUrl`
- `apiKey` a menos que `auth: none`
- `api` a nivel de proveedor o de cada modelo

### Proveedor de solo anulación (`models` falta o está vacío)

Debe definir al menos uno de:

- `baseUrl`
- `modelOverrides`
- `discovery`

### Descubrimiento

- `discovery` requiere `api` a nivel de proveedor.

### Comprobaciones del valor del modelo

- `id` es requerido
- `contextWindow` y `maxTokens` deben ser positivos si se proporcionan

## Orden de fusión y anulación

Tubería de ModelRegistry (en la actualización):

1. Cargar proveedores/modelos integrados de `@f5-sales-demo/pi-ai`.
2. Cargar la configuración personalizada de `models.yml`.
3. Aplicar las anulaciones de proveedores (`baseUrl`, `headers`) a los modelos integrados.
4. Aplicar `modelOverrides` (por proveedor + ID de modelo).
5. Fusionar `models` personalizados:
   - mismo `provider + id` reemplaza el existente
   - de lo contrario, agregar
6. Aplicar modelos descubiertos en tiempo de ejecución (actualmente Ollama y LM Studio), luego volver a aplicar las anulaciones de modelo.

## Equivalencia y fusión de modelos canónicos

El registro mantiene cada modelo de proveedor concreto y luego construye una capa canónica sobre ellos.

Los ID canónicos son solo ID oficiales ascendentes (upstream), por ejemplo:

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

Orden de compilación para la agrupación canónica:

1. anulación exacta del usuario de `equivalence.overrides`
2. coincidencias de ID oficial empaquetadas desde los metadatos del modelo integrado
3. normalización heurística conservadora para variantes de puerta de enlace/proveedor
4. respaldo al propio ID del modelo concreto

Las heurísticas actuales son intencionalmente limitadas:

- los prefijos ascendentes incrustados se pueden eliminar cuando están presentes, por ejemplo `anthropic/...` o `openai/...`
- las variantes de versión con puntos y guiones solo se pueden normalizar cuando se asignan a un ID oficial existente, por ejemplo `4.6 -> 4-6`
- las familias o versiones ambiguas no se fusionan sin una coincidencia empaquetada o una anulación explícita

### Comportamiento de resolución canónica

Cuando múltiples variantes concretas comparten un ID canónico, la resolución utiliza:

1. disponibilidad y autenticación
2. `config.yml` `modelProviderOrder`
3. registro existente/orden del proveedor si `modelProviderOrder` no está configurado

Los proveedores deshabilitados o no autenticados se omiten.

El estado de la sesión y las transcripciones continúan registrando el proveedor/modelo concreto que realmente ejecutó el turno.

Valores predeterminados del proveedor vs. anulaciones por modelo:

- `headers` del proveedor son la línea base.
- `headers` del modelo anulan las claves de encabezado del proveedor.
- `modelOverrides` puede anular los metadatos del modelo (`name`, `reasoning`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, `compat`, `contextPromotionTarget`).
- `compat` se fusiona profundamente para bloques de enrutamiento anidados (`openRouterRouting`, `vercelGatewayRouting`, `extraBody`).

## Integración del descubrimiento en tiempo de ejecución

### Descubrimiento implícito de Ollama

Si `ollama` no está configurado explícitamente, el registro agrega un proveedor implícito descubrible:

- proveedor: `ollama`
- api: `openai-completions`
- URL base: `OLLAMA_BASE_URL` o `http://127.0.0.1:11434`
- modo de autenticación: sin clave (comportamiento de `auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET /api/tags` en Ollama y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento implícito de llama.cpp

Si `llama.cpp` no está configurado explícitamente, el registro agrega un proveedor implícito descubrible:
Nota: está usando la API de mensajes de Anthropic más nueva en lugar de openai-completions.

- proveedor: `llama.cpp`
- api: `openai-responses`
- URL base: `LLAMA_CPP_BASE_URL` o `http://127.0.0.1:8080`
- modo de autenticación: sin clave (comportamiento de `auth: none`)

El descubrimiento en tiempo de ejecución llama a `GET models` en llama.cpp y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento implícito de LM Studio

Si `lm-studio` no está configurado explícitamente, el registro agrega un proveedor implícito descubrible:

- proveedor: `lm-studio`
- api: `openai-completions`
- URL base: `LM_STUDIO_BASE_URL` o `http://127.0.0.1:1234/v1`
- modo de autenticación: sin clave (comportamiento de `auth: none`)

El descubrimiento en tiempo de ejecución obtiene modelos (`GET /models`) y sintetiza entradas de modelo con valores predeterminados locales.

### Descubrimiento explícito de proveedores

Puedes configurar el descubrimiento tú mismo:

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

### Registro de proveedores de extensión

Las extensiones pueden registrar proveedores en tiempo de ejecución (`pi.registerProvider(...)`), incluyendo:

- reemplazo/adición de modelo para un proveedor
- registro de manejador de transmisión personalizado para nuevos ID de API
- registro de proveedor OAuth personalizado

## Orden de resolución de clave de API y autenticación

Al solicitar una clave para un proveedor, el orden efectivo es:

1. Anulación en tiempo de ejecución (CLI `--api-key`)
2. Credencial de clave de API almacenada en `agent.db`
3. Credencial OAuth almacenada en `agent.db` (con actualización)
4. Mapeo de variables de entorno (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
5. Resolución de respaldo de ModelRegistry (proveedor `apiKey` desde `models.yml`, semántica de nombre de entorno o literal)

Comportamiento de `apiKey` en `models.yml`:

- El valor se trata primero como un nombre de variable de entorno.
- Si no existe ninguna variable de entorno, la cadena literal se utiliza como token.

Si `authHeader: true` y el `apiKey` del proveedor está configurado, los modelos obtienen:

- Encabezado `Authorization: Bearer <resolved-key>` inyectado.

Proveedores sin clave:

- Los proveedores marcados como `auth: none` se tratan como disponibles sin credenciales.
- `getApiKey*` devuelve `kNoAuth` para ellos.

## Disponibilidad del modelo vs todos los modelos

- `getAll()` devuelve el registro de modelos cargado (integrados + personalizados fusionados + descubiertos).
- `getAvailable()` filtra a los modelos que no tienen clave o tienen autenticación resoluble.

Por lo tanto, un modelo puede existir en el registro pero no ser seleccionable hasta que la autenticación esté disponible.

## Resolución de modelos en tiempo de ejecución

### CLI y análisis de patrones

`model-resolver.ts` admite:

- exacto `provider/modelId`
- ID canónico exacto del modelo
- ID exacto del modelo (proveedor inferido)
- coincidencia difusa/de subcadena (fuzzy/substring)
- patrones de alcance global en `--models` (por ejemplo, `openai/*`, `*sonnet*`)
- sufijo opcional `:thinkingLevel` (`off|minimal|low|medium|high|xhigh`)

`--provider` es heredado; se prefiere `--model`.

Precedencia de resolución para selectores exactos:

1. el exacto `provider/modelId` evita la fusión
2. el ID canónico exacto se resuelve a través del índice canónico
3. el ID concreto simple exacto aún funciona
4. la coincidencia difusa y global se ejecuta después de las rutas exactas

### Prioridad de selección del modelo inicial

`findInitialModel(...)` utiliza este orden:

1. proveedor+modelo explícito en CLI
2. primer modelo con alcance (si no se reanuda)
3. proveedor/modelo predeterminado guardado
4. valores predeterminados de proveedores conocidos (por ejemplo, OpenAI/Anthropic/etc.) entre los modelos disponibles
5. primer modelo disponible

### Alias y configuraciones de roles

Roles de modelo compatibles:

- `default`, `smol`, `slow`, `plan`, `commit`

Los alias de roles como `pi/smol` se expanden a través de `settings.modelRoles`. Cada valor de rol también puede agregar un selector de pensamiento como `:minimal`, `:low`, `:medium` o `:high`.

Si un rol apunta a otro rol, el modelo de destino aún hereda normalmente y cualquier sufijo explícito en el rol de referencia gana para ese uso específico del rol.

Configuraciones relacionadas:

- `modelRoles` (registro)
- `enabledModels` (lista de patrones con alcance)
- `modelProviderOrder` (precedencia de proveedor canónico global)
- `providers.kimiApiFormat` (formato de solicitud de `openai` o `anthropic`)
- `providers.openaiWebsockets` (preferencia de websocket `auto|off|on` para el transporte de OpenAI Codex)

`modelRoles` puede almacenar cualquiera de los siguientes:

- `provider/modelId` para anclar una variante de proveedor concreta
- un ID canónico como `gpt-5.3-codex` para permitir la fusión de proveedores

Para `enabledModels` y CLI `--models`:

- los ID canónicos exactos se expanden a todas las variantes concretas en ese grupo canónico
- las entradas explícitas `provider/modelId` permanecen exactas
- las coincidencias globales y difusas aún operan en modelos concretos

## `/model` y `--list-models`

Ambas superficies mantienen visibles y seleccionables los modelos con prefijo de proveedor.

Ahora también exponen modelos canónicos/fusionados:

- `/model` incluye una vista canónica junto a las pestañas de proveedores
- `--list-models` imprime una sección canónica más las filas del proveedor concreto

Seleccionar una entrada canónica almacena el selector canónico. Seleccionar una fila de proveedor almacena el `provider/modelId` explícito.

## Promoción de contexto (cadenas de respaldo a nivel de modelo)

La promoción de contexto es un mecanismo de recuperación de desbordamiento para variantes de contexto pequeño (por ejemplo, `*-spark`) que promueve automáticamente a un hermano de contexto más grande cuando la API rechaza una solicitud con un error de longitud de contexto.

### Desencadenante y orden

Cuando un turno falla con un error de desbordamiento de contexto (por ejemplo, `context_length_exceeded`), `AgentSession` intenta la promoción **antes** de recurrir a la compactación:

1. Si `contextPromotion.enabled` es verdadero, resuelve un objetivo de promoción (ver a continuación).
2. Si se encuentra un objetivo, cambia a él y vuelve a intentar la solicitud — no se necesita compactación.
3. Si no hay ningún objetivo disponible, se pasa a la autocompactación en el modelo actual.

### Selección de objetivos

La selección se basa en modelos, no en roles:

1. `currentModel.contextPromotionTarget` (si está configurado)
2. el modelo más pequeño con un contexto más grande en el mismo proveedor + API

Los candidatos se ignoran a menos que las credenciales se resuelvan (`ModelRegistry.getApiKey(...)`).

### Transferencia de websocket de OpenAI Codex

Si se cambia desde/hacia `openai-codex-responses`, la clave de estado del proveedor de sesión `openai-codex-responses` se cierra antes del cambio de modelo. Esto elimina el estado de transporte de websocket para que el próximo turno comience limpio en el modelo promovido.

### Comportamiento de persistencia

La promoción utiliza un cambio temporal (`setModelTemporary`):

- registrado como un `model_change` temporal en el historial de sesiones
- no reescribe el mapeo de roles guardado

### Configuración explícita de cadenas de respaldo

Configura el respaldo directamente en los metadatos del modelo a través de `contextPromotionTarget`.

`contextPromotionTarget` acepta ya sea:

- `provider/model-id` (explícito)
- `model-id` (resuelto dentro del proveedor actual)

Ejemplo (`models.yml`) para Spark -> no Spark en el mismo proveedor:

```yaml
providers:
  openai-codex:
    modelOverrides:
      gpt-5.3-codex-spark:
        contextPromotionTarget: openai-codex/gpt-5.3-codex
```

El generador de modelos integrado también asigna esto automáticamente a los modelos `*-spark` cuando existe un modelo base del mismo proveedor.

## Campos de compatibilidad y enrutamiento

`models.yml` admite este subconjunto de `compat`:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `maxTokensField` (`max_completion_tokens` o `max_tokens`)
- `openRouterRouting.only` / `openRouterRouting.order`
- `vercelGatewayRouting.only` / `vercelGatewayRouting.order`

Estos son consumidos por la lógica de transporte de OpenAI-completions y combinados con la detección automática basada en URL.

## Ejemplos prácticos

### Punto final local compatible con OpenAI (sin autenticación)

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

### Proxy alojado con clave basada en entorno

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

### Anular la ruta del proveedor integrado + metadatos del modelo

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

## Configuración automática de proxy LiteLLM

Cuando se establecen las variables de entorno `LITELLM_BASE_URL` y `LITELLM_API_KEY`, xcsh gestiona automáticamente la configuración de `models.yml` para el proxy LiteLLM.

### Autogeneración de primera ejecución

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

También se genera un `config.yml` predeterminado con configuraciones de proveedores de imágenes sensatas.

### Autocuración de inicio

En cada inicio, `startupHealthCheck()` en el registro de modelos ejecuta las siguientes comprobaciones:

| Condición | Acción |
|-----------|--------|
| Falta `models.yml` | Autogenerar a partir de variables de entorno |
| `models.yml` dañado o no analizable | Realizar copia de seguridad en `.bak`, regenerar |
| `baseUrl` no coincide con `LITELLM_BASE_URL` | Realizar copia de seguridad en `.bak`, regenerar con nueva URL |
| `configVersion` falta o está desactualizado | Realizar copia de seguridad en `.bak`, regenerar con versión actual |
| La configuración es saludable | Ninguna acción |

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
| `LITELLM_BASE_URL` | URL de proxy de LiteLLM (por ejemplo, `https://your-proxy.example.com`). Debe comenzar con `http://` o `https://`. |
| `LITELLM_API_KEY` | Clave de API para el proxy. Referenciado por nombre en la configuración generada, resuelto en tiempo de ejecución. |

Si alguna de las variables no está establecida, la autoconfiguración se omite silenciosamente.

### Control de versiones de configuración

Las configuraciones generadas incluyen un campo `configVersion`. Cuando el formato generado cambie en versiones futuras, xcsh detecta configuraciones desactualizadas y las actualiza automáticamente (con copia de seguridad).

## Advertencia sobre consumidor heredado

La mayor parte de la configuración del modelo ahora fluye a través de `models.yml` mediante `ModelRegistry`.

Queda una ruta heredada notable: la resolución de autenticación de Anthropic de búsqueda web todavía lee `~/.xcsh/agent/models.json` directamente en `src/web/search/auth.ts`.

Si dependes de esa ruta específica, ten en cuenta la compatibilidad JSON hasta que se migre ese módulo.

## Modo de fallo

Si `models.yml` falla en el esquema o en las comprobaciones de validación:

- Si `LITELLM_BASE_URL` y `LITELLM_API_KEY` están configuradas, la verificación de salud de inicio intenta la reparación automática (realizar una copia de seguridad del archivo dañado, regenerar desde las variables de entorno). Si la reparación es exitosa, el registro recarga la configuración corregida.
- Si la reparación automática no es posible (variables de entorno no configuradas, falla de escritura), el registro sigue funcionando con los modelos integrados.
- El error se expone a través de `ModelRegistry.getError()` y se muestra en la interfaz de usuario/notificaciones.
