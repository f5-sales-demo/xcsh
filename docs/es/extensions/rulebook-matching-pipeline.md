---
title: Pipeline de coincidencia del Rulebook
description: >-
  Pipeline de coincidencia del rulebook para seleccionar y aplicar conjuntos de
  instrucciones específicos del contexto a sesiones del agente.
sidebar:
  order: 6
  label: Coincidencia del rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline de coincidencia del Rulebook

Este documento describe cómo coding-agent descubre reglas de los formatos de configuración soportados, las normaliza en una única forma `Rule`, resuelve conflictos de precedencia y divide el resultado en:

- **Reglas del Rulebook** (disponibles para el modelo vía system prompt + URLs `rule://`)
- **Reglas TTSR** (reglas de interrupción de flujo de viaje en el tiempo)

Refleja la implementación actual, incluyendo semántica parcial y metadatos que se parsean pero no se aplican.

## Archivos de implementación

- [`../src/capability/rule.ts`](../../packages/coding-agent/src/capability/rule.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/discovery/index.ts`](../../packages/coding-agent/src/discovery/index.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/cursor.ts`](../../packages/coding-agent/src/discovery/cursor.ts)
- [`../src/discovery/windsurf.ts`](../../packages/coding-agent/src/discovery/windsurf.ts)
- [`../src/discovery/cline.ts`](../../packages/coding-agent/src/discovery/cline.ts)
- [`../src/sdk.ts`](../../packages/coding-agent/src/sdk.ts)
- [`../src/system-prompt.ts`](../../packages/coding-agent/src/system-prompt.ts)
- [`../src/internal-urls/rule-protocol.ts`](../../packages/coding-agent/src/internal-urls/rule-protocol.ts)
- [`../src/utils/frontmatter.ts`](../../packages/coding-agent/src/utils/frontmatter.ts)

## 1. Forma canónica de la regla

Todos los proveedores normalizan los archivos fuente en `Rule`:

```ts
interface Rule {
  name: string;
  path: string;
  content: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
  ttsrTrigger?: string;
  _source: SourceMeta;
}
```

La identidad de la capacidad es `rule.name` (`ruleCapability.key = rule => rule.name`).

Consecuencia: la precedencia y la deduplicación están **basadas únicamente en el nombre**. Dos archivos diferentes con el mismo `name` se consideran la misma regla lógica.

## 2. Fuentes de descubrimiento y normalización

`src/discovery/index.ts` registra automáticamente los proveedores. Para `rules`, los proveedores actuales son:

- `native` (prioridad `100`)
- `cursor` (prioridad `50`)
- `windsurf` (prioridad `50`)
- `cline` (prioridad `40`)

### Proveedor nativo (`builtin.ts`)

Carga reglas `.xcsh` desde:

- proyecto: `<cwd>/.xcsh/rules/*.{md,mdc}`
- usuario: `~/.xcsh/agent/rules/*.{md,mdc}`

Normalización:

- `name` = nombre de archivo sin `.md`/`.mdc`
- frontmatter parseado vía `parseFrontmatter`
- `content` = cuerpo (frontmatter eliminado)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapeados directamente

Advertencia importante: `globs` se castea como `string[] | undefined` sin filtrado de elementos en este proveedor.

### Proveedor Cursor (`cursor.ts`)

Carga desde:

- usuario: `~/.cursor/rules/*.{mdc,md}`
- proyecto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalización (`transformMDCRule`):

- `description`: se mantiene solo si es string
- `alwaysApply`: solo se preserva `true` (`false` se convierte en `undefined`)
- `globs`: acepta array (solo elementos string) o string único
- `ttsr_trigger`: solo string
- `name` del nombre de archivo sin extensión

### Proveedor Windsurf (`windsurf.ts`)

Carga desde:

- usuario: `~/.codeium/windsurf/memories/global_rules.md` (nombre de regla fijo `global_rules`)
- proyecto: `<cwd>/.windsurf/rules/*.md`

Normalización:

- `globs`: array de strings o string único
- `alwaysApply`, `description` casteados desde el frontmatter
- `ttsr_trigger`: solo string
- `name` del nombre de archivo para reglas de proyecto

### Proveedor Cline (`cline.ts`)

Busca hacia arriba desde `cwd` el `.clinerules` más cercano:

- si es directorio: carga `*.md` dentro de él
- si es archivo: carga un único archivo como regla llamada `clinerules`

Normalización:

- `globs`: array de strings o string único
- `alwaysApply`: solo si es booleano
- `description`: solo string
- `ttsr_trigger`: solo string

## 3. Comportamiento del parseo de frontmatter y ambigüedad

Todos los proveedores usan `parseFrontmatter` (`utils/frontmatter.ts`) con esta semántica:

1. El frontmatter se parsea solo cuando el contenido comienza con `---` y tiene un cierre `\n---`.
2. El cuerpo se recorta después de la extracción del frontmatter.
3. Si el parseo YAML falla:
   - se registra una advertencia,
   - el parser recurre al parseo simple de líneas `key: value` (`^(\w+):\s*(.*)$`).

Consecuencias de la ambigüedad:

- El parser de respaldo no soporta arrays, objetos anidados, reglas de entrecomillado ni claves con guiones.
- Los valores de respaldo se convierten en strings (por ejemplo `alwaysApply: true` se convierte en el string `"true"`), por lo que los proveedores que requieren tipos booleano/string pueden descartar metadatos.
- `ttsr_trigger` funciona en el respaldo (clave con guion bajo); claves como `thinking-level` no funcionarían.
- Los archivos sin frontmatter válido aún se cargan como reglas con metadatos vacíos y el contenido completo como cuerpo.

## 4. Precedencia de proveedores y deduplicación

`loadCapability("rules")` (`capability/index.ts`) fusiona las salidas de los proveedores y luego deduplica por `rule.name`.

### Modelo de precedencia

- Los proveedores se ordenan por prioridad descendente.
- Prioridad igual mantiene el orden de registro (`cursor` antes de `windsurf` desde `discovery/index.ts`).
- La deduplicación es primero-gana: el primer nombre de regla encontrado se mantiene; los elementos posteriores con el mismo nombre se marcan como `_shadowed` en `all` y se excluyen de `items`.

El orden efectivo actual de proveedores de reglas es:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Advertencia sobre el orden intra-proveedor

Dentro de un proveedor, el orden de los elementos proviene del orden de resultados del glob de `loadFilesFromDir` más el orden explícito de push. Esto es lo suficientemente determinístico para uso normal pero no está explícitamente ordenado en el código.

Diferencias notables en el orden de fuentes:

- `native` agrega primero los directorios de configuración del proyecto y luego los del usuario.
- `cursor` agrega primero los resultados del usuario y luego los del proyecto.
- `windsurf` agrega primero las `global_rules` del usuario, luego las reglas del proyecto.
- `cline` carga solo la fuente `.clinerules` más cercana.

## 5. División en categorías de Rulebook, Aplicación-siempre y TTSR

Después del descubrimiento de reglas en `createAgentSession` (`sdk.ts`):

1. Se escanean todas las reglas descubiertas.
2. Las reglas con `condition` (clave de frontmatter; `ttsr_trigger` / `ttsrTrigger` aceptados como respaldo) se registran en `TtsrManager`.
3. Se construye una lista separada de `rulebookRules` con este predicado:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Se construye una lista de `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamiento de las categorías

- **Categoría TTSR**: cualquier regla con `condition` (no se requiere descripción). Tiene prioridad sobre las otras categorías.
- **Categoría de aplicación-siempre**: `alwaysApply === true`, no es TTSR. El contenido completo se inyecta en el system prompt. Resoluble vía `rule://`.
- **Categoría Rulebook**: debe tener descripción, no debe ser TTSR, no debe ser `alwaysApply`. Se lista en el system prompt por nombre+descripción; el contenido se lee bajo demanda vía `rule://`.
- Una regla con tanto `condition` como `alwaysApply` va solo a TTSR (TTSR tiene prioridad).
- Una regla con tanto `alwaysApply` como `description` va solo a aplicación-siempre (no al rulebook).

## 6. Cómo los metadatos afectan las superficies en tiempo de ejecución

### `description`

- Requerido para la inclusión en el rulebook.
- Se renderiza en el bloque `<rules>` del system prompt.
- Si falta la descripción, la regla no está disponible vía `rule://` y no se lista en las reglas del system prompt.

### `globs`

- Se mantiene en `Rule`.
- Se renderiza como entradas `<glob>...</glob>` en el bloque de reglas del system prompt.
- Se expone en el estado de la UI de reglas (lista de modo `extensions`).
- **No se aplica para coincidencia automática en este pipeline.** No hay un matcher de glob en tiempo de ejecución que seleccione reglas por archivo actual/objetivo de herramienta.

### `alwaysApply`

- Parseado y preservado por los proveedores.
- Usado en la visualización de la UI (etiqueta de trigger `"always"` en el gestor de estado de extensiones).
- Usado como condición de exclusión de `rulebookRules`.
- **El contenido completo de la regla se auto-inyecta en el system prompt** (antes de la sección de reglas del rulebook).
- La regla también es accesible vía `rule://<name>` para re-lectura.

### `ttsr_trigger`

- Mapeado a `rule.ttsrTrigger`.
- Si está presente, la regla se enruta al gestor TTSR, no al rulebook.

## 7. Ruta de inclusión en el system prompt

`buildSystemPromptInternal` recibe tanto `rules` (rulebook) como `alwaysApplyRules`.

Las reglas de aplicación-siempre se renderizan primero, inyectando su contenido crudo directamente en el prompt.

Las reglas del rulebook se renderizan en una sección `# Rules` con:

- `Read rule://<name> when working in matching domain`
- El `name`, `description` y lista opcional de `<glob>` de cada regla

Esto es orientativo/contextual: el texto del prompt pide al modelo que lea las reglas aplicables, pero el código no aplica la coincidencia de globs.

## 8. Comportamiento de la URL interna `rule://`

`RuleProtocolHandler` se registra con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicaciones:

- `rule://<name>` resuelve contra tanto **rulebookRules** como **alwaysApplyRules**.
- Las reglas solo-TTSR y las reglas sin descripción ni `alwaysApply` no son accesibles vía `rule://`.
- La resolución es por coincidencia exacta de nombre.
- Los nombres desconocidos devuelven un error listando los nombres de reglas disponibles.
- El contenido devuelto es el `rule.content` crudo (frontmatter eliminado), tipo de contenido `text/markdown`.

## 9. Semántica parcial / no aplicada conocida

1. Las descripciones de los proveedores mencionan archivos legacy (`.cursorrules`, `.windsurfrules`), pero las rutas de código del cargador actual no leen realmente esos archivos.
2. Los metadatos de `globs` se exponen al prompt/UI pero no se aplican por la lógica de selección de reglas.
3. La selección de reglas para `rule://` incluye reglas del rulebook y de aplicación-siempre, pero no reglas solo-TTSR.
4. Las advertencias de descubrimiento (`loadCapability("rules").warnings`) se producen pero `createAgentSession` actualmente no las muestra/registra en esta ruta.
