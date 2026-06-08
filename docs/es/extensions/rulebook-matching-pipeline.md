---
title: Pipeline de Coincidencia de Rulebook
description: >-
  Pipeline de coincidencia de rulebook para seleccionar y aplicar conjuntos de
  instrucciones específicas del contexto a sesiones de agente.
sidebar:
  order: 6
  label: Coincidencia de rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline de Coincidencia de Rulebook

Este documento describe cómo coding-agent descubre reglas a partir de formatos de configuración compatibles, las normaliza en una única forma `Rule`, resuelve conflictos de precedencia y divide el resultado en:

- **Reglas de Rulebook** (disponibles para el modelo a través del prompt de sistema + URLs `rule://`)
- **Reglas TTSR** (reglas de interrupción de flujo por viaje en el tiempo)

Refleja la implementación actual, incluyendo semánticas parciales y metadatos que se parsean pero no se aplican.

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

Consecuencia: la precedencia y la deduplicación se basan **únicamente en el nombre**. Dos archivos diferentes con el mismo `name` se consideran la misma regla lógica.

## 2. Fuentes de descubrimiento y normalización

`src/discovery/index.ts` registra proveedores automáticamente. Para `rules`, los proveedores actuales son:

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
- frontmatter parseado mediante `parseFrontmatter`
- `content` = cuerpo (frontmatter eliminado)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapeados directamente

Consideración importante: `globs` se convierte como `string[] | undefined` sin filtrado de elementos en este proveedor.

### Proveedor Cursor (`cursor.ts`)

Carga desde:

- usuario: `~/.cursor/rules/*.{mdc,md}`
- proyecto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalización (`transformMDCRule`):

- `description`: se conserva solo si es string
- `alwaysApply`: solo se preserva `true` (`false` se convierte en `undefined`)
- `globs`: acepta array (solo elementos string) o string individual
- `ttsr_trigger`: solo string
- `name` del nombre de archivo sin extensión

### Proveedor Windsurf (`windsurf.ts`)

Carga desde:

- usuario: `~/.codeium/windsurf/memories/global_rules.md` (nombre de regla fijo `global_rules`)
- proyecto: `<cwd>/.windsurf/rules/*.md`

Normalización:

- `globs`: array de strings o string individual
- `alwaysApply`, `description` convertidos desde frontmatter
- `ttsr_trigger`: solo string
- `name` del nombre de archivo para reglas de proyecto

### Proveedor Cline (`cline.ts`)

Busca hacia arriba desde `cwd` el `.clinerules` más cercano:

- si es directorio: carga `*.md` dentro de él
- si es archivo: carga un único archivo como regla denominada `clinerules`

Normalización:

- `globs`: array de strings o string individual
- `alwaysApply`: solo si es booleano
- `description`: solo string
- `ttsr_trigger`: solo string

## 3. Comportamiento del parseo de frontmatter y ambigüedad

Todos los proveedores usan `parseFrontmatter` (`utils/frontmatter.ts`) con estas semánticas:

1. El frontmatter se parsea solo cuando el contenido comienza con `---` y tiene un cierre `\n---`.
2. El cuerpo se recorta después de la extracción del frontmatter.
3. Si el parseo YAML falla:
   - se registra una advertencia,
   - el parser recurre a un análisis simple de líneas `key: value` (`^(\w+):\s*(.*)$`).

Consecuencias de la ambigüedad:

- El parser de respaldo no admite arrays, objetos anidados, reglas de comillas ni claves con guiones.
- Los valores de respaldo se convierten en strings (por ejemplo, `alwaysApply: true` se convierte en el string `"true"`), por lo que los proveedores que requieren tipos boolean/string pueden descartar metadatos.
- `ttsr_trigger` funciona en el respaldo (clave con guión bajo); claves como `thinking-level` no funcionarían.
- Los archivos sin frontmatter válido aún se cargan como reglas con metadatos vacíos y el contenido completo como cuerpo.

## 4. Precedencia de proveedores y deduplicación

`loadCapability("rules")` (`capability/index.ts`) combina las salidas de los proveedores y luego deduplica por `rule.name`.

### Modelo de precedencia

- Los proveedores se ordenan por prioridad descendente.
- La prioridad igual mantiene el orden de registro (`cursor` antes que `windsurf` desde `discovery/index.ts`).
- La deduplicación es de tipo primero-gana: se conserva el primer nombre de regla encontrado; los elementos posteriores con el mismo nombre se marcan como `_shadowed` en `all` y se excluyen de `items`.

El orden efectivo actual de proveedores de reglas es:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Consideración sobre el orden intra-proveedor

Dentro de un proveedor, el orden de los elementos proviene del resultado de ordenación del glob de `loadFilesFromDir` más el orden explícito de inserción (push). Esto es suficientemente determinista para uso normal, pero no está explícitamente ordenado en el código.

Diferencias notables en el orden de las fuentes:

- `native` agrega primero los directorios de configuración del proyecto, luego los del usuario.
- `cursor` agrega primero los resultados del usuario, luego los del proyecto.
- `windsurf` agrega primero las `global_rules` del usuario, luego las reglas del proyecto.
- `cline` carga solo la fuente `.clinerules` más cercana.

## 5. División en categorías Rulebook, Always-Apply y TTSR

Después del descubrimiento de reglas en `createAgentSession` (`sdk.ts`):

1. Se escanean todas las reglas descubiertas.
2. Las reglas con `condition` (clave de frontmatter; `ttsr_trigger` / `ttsrTrigger` aceptados como alternativa) se registran en `TtsrManager`.
3. Se construye una lista separada `rulebookRules` con este predicado:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Se construye una lista `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamiento de las categorías

- **Categoría TTSR**: cualquier regla con `condition` (no se requiere descripción). Tiene prioridad sobre las demás categorías.
- **Categoría always-apply**: `alwaysApply === true`, no TTSR. El contenido completo se inyecta en el prompt de sistema. Resoluble mediante `rule://`.
- **Categoría Rulebook**: debe tener descripción, no debe ser TTSR, no debe ser `alwaysApply`. Se lista en el prompt de sistema por nombre+descripción; el contenido se lee bajo demanda mediante `rule://`.
- Una regla con tanto `condition` como `alwaysApply` va solo a TTSR (TTSR tiene prioridad).
- Una regla con tanto `alwaysApply` como `description` va solo a always-apply (no a rulebook).

## 6. Cómo los metadatos afectan las superficies de ejecución

### `description`

- Requerido para la inclusión en el rulebook.
- Se renderiza en el bloque `<rules>` del prompt de sistema.
- La ausencia de descripción significa que la regla no está disponible mediante `rule://` y no se lista en las reglas del prompt de sistema.

### `globs`

- Se transporta en el `Rule`.
- Se renderiza como entradas `<glob>...</glob>` en el bloque de reglas del prompt de sistema.
- Se expone en el estado de la UI de reglas (lista de modo `extensions`).
- **No se aplica para coincidencia automática en este pipeline.** No existe un comparador de globs en tiempo de ejecución que seleccione reglas por archivo actual/objetivo de herramienta.

### `alwaysApply`

- Parseado y preservado por los proveedores.
- Usado en la visualización de la UI (etiqueta de activación `"always"` en el administrador de estado de extensiones).
- Usado como condición de exclusión de `rulebookRules`.
- **El contenido completo de la regla se inyecta automáticamente en el prompt de sistema** (antes de la sección de reglas del rulebook).
- La regla también es accesible mediante `rule://<name>` para re-lectura.

### `ttsr_trigger`

- Se mapea a `rule.ttsrTrigger`.
- Si está presente, la regla se enruta al administrador TTSR, no al rulebook.

## 7. Ruta de inclusión en el prompt de sistema

`buildSystemPromptInternal` recibe tanto `rules` (rulebook) como `alwaysApplyRules`.

Las reglas always-apply se renderizan primero, inyectando su contenido sin procesar directamente en el prompt.

Las reglas del rulebook se renderizan en una sección `# Rules` con:

- `Read rule://<name> when working in matching domain`
- El `name`, `description` y lista opcional de `<glob>` de cada regla

Esto es consultivo/contextual: el texto del prompt solicita al modelo que lea las reglas aplicables, pero el código no aplica la coincidencia de globs.

## 8. Comportamiento de la URL interna `rule://`

`RuleProtocolHandler` se registra con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicaciones:

- `rule://<name>` se resuelve contra tanto **rulebookRules** como **alwaysApplyRules**.
- Las reglas exclusivas de TTSR y las reglas sin descripción y sin `alwaysApply` no son accesibles mediante `rule://`.
- La resolución es por coincidencia exacta de nombre.
- Los nombres desconocidos devuelven un error listando los nombres de reglas disponibles.
- El contenido devuelto es `rule.content` sin procesar (frontmatter eliminado), tipo de contenido `text/markdown`.

## 9. Semánticas parciales / no aplicadas conocidas

1. Las descripciones de los proveedores mencionan archivos heredados (`.cursorrules`, `.windsurfrules`), pero las rutas de código del cargador actual no leen realmente esos archivos.
2. Los metadatos de `globs` se exponen al prompt/UI pero no se aplican por la lógica de selección de reglas.
3. La selección de reglas para `rule://` incluye reglas de rulebook y always-apply, pero no reglas exclusivas de TTSR.
4. Las advertencias de descubrimiento (`loadCapability("rules").warnings`) se producen pero `createAgentSession` actualmente no las muestra/registra en esta ruta.
