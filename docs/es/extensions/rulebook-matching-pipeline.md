---
title: Canalización de coincidencia de Rulebook
description: >-
  Canalización de coincidencia de Rulebook para seleccionar y aplicar conjuntos
  de instrucciones específicos del contexto en sesiones de agente.
sidebar:
  order: 6
  label: Coincidencia de Rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Canalización de coincidencia de Rulebook

Este documento describe cómo el agente de codificación descubre reglas a partir de los formatos de configuración compatibles, las normaliza en una única forma `Rule`, resuelve conflictos de precedencia y divide el resultado en:

- **Reglas de Rulebook** (disponibles para el modelo a través del system prompt + URLs `rule://`)
- **Reglas TTSR** (reglas de interrupción de flujo de viaje en el tiempo)

Refleja la implementación actual, incluyendo semánticas parciales y metadatos que se analizan pero no se aplican.

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

## 1. Forma canónica de una regla

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
- frontmatter analizado mediante `parseFrontmatter`
- `content` = cuerpo (frontmatter eliminado)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapeados directamente

Advertencia importante: `globs` se convierte en `string[] | undefined` sin filtrado de elementos en este proveedor.

### Proveedor Cursor (`cursor.ts`)

Carga desde:

- usuario: `~/.cursor/rules/*.{mdc,md}`
- proyecto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalización (`transformMDCRule`):

- `description`: se conserva solo si es una cadena
- `alwaysApply`: solo se preserva `true` (`false` pasa a ser `undefined`)
- `globs`: acepta un array (solo elementos de tipo string) o una cadena única
- `ttsr_trigger`: solo cadena
- `name` del nombre de archivo sin extensión

### Proveedor Windsurf (`windsurf.ts`)

Carga desde:

- usuario: `~/.codeium/windsurf/memories/global_rules.md` (nombre de regla fijo `global_rules`)
- proyecto: `<cwd>/.windsurf/rules/*.md`

Normalización:

- `globs`: array de cadenas o cadena única
- `alwaysApply`, `description` convertidos desde el frontmatter
- `ttsr_trigger`: solo cadena
- `name` del nombre de archivo para reglas de proyecto

### Proveedor Cline (`cline.ts`)

Busca hacia arriba desde `cwd` el `.clinerules` más cercano:

- si es directorio: carga `*.md` dentro de él
- si es archivo: carga el archivo único como una regla con el nombre `clinerules`

Normalización:

- `globs`: array de cadenas o cadena única
- `alwaysApply`: solo si es booleano
- `description`: solo cadena
- `ttsr_trigger`: solo cadena

## 3. Comportamiento de análisis del frontmatter y ambigüedad

Todos los proveedores utilizan `parseFrontmatter` (`utils/frontmatter.ts`) con estas semánticas:

1. El frontmatter se analiza solo cuando el contenido comienza con `---` y tiene un cierre `\n---`.
2. El cuerpo se recorta tras la extracción del frontmatter.
3. Si el análisis YAML falla:
   - se registra una advertencia,
   - el analizador recurre al análisis simple de líneas `key: value` (`^(\w+):\s*(.*)$`).

Consecuencias de la ambigüedad:

- El analizador de respaldo no admite arrays, objetos anidados, reglas de comillas ni claves con guiones.
- Los valores de respaldo se convierten en cadenas (por ejemplo, `alwaysApply: true` se convierte en la cadena `"true"`), por lo que los proveedores que requieren tipos booleanos o de cadena pueden descartar metadatos.
- `ttsr_trigger` funciona en modo de respaldo (clave con guion bajo); claves como `thinking-level` no lo harían.
- Los archivos sin frontmatter válido se siguen cargando como reglas con metadatos vacíos y el cuerpo de contenido completo.

## 4. Precedencia de proveedores y deduplicación

`loadCapability("rules")` (`capability/index.ts`) combina las salidas de los proveedores y luego deduplica por `rule.name`.

### Modelo de precedencia

- Los proveedores se ordenan por prioridad descendente.
- A igual prioridad, se conserva el orden de registro (`cursor` antes que `windsurf` según `discovery/index.ts`).
- La deduplicación es de primero en ganar: el primer nombre de regla encontrado se conserva; los elementos con el mismo nombre que aparecen después se marcan como `_shadowed` en `all` y se excluyen de `items`.

El orden efectivo de proveedores de reglas actualmente es:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Advertencia sobre el orden interno del proveedor

Dentro de un proveedor, el orden de los elementos proviene del resultado de la búsqueda glob de `loadFilesFromDir` más el orden explícito de inserción. Esto es suficientemente determinista para el uso normal, pero no está ordenado explícitamente en el código.

Diferencias notables en el orden de las fuentes:

- `native` agrega primero los directorios de configuración del proyecto y luego los del usuario.
- `cursor` agrega primero los resultados del usuario y luego los del proyecto.
- `windsurf` agrega primero `global_rules` del usuario y luego las reglas del proyecto.
- `cline` carga únicamente la fuente `.clinerules` más cercana.

## 5. División en cubos de Rulebook, siempre-aplicar y TTSR

Tras el descubrimiento de reglas en `createAgentSession` (`sdk.ts`):

1. Se analizan todas las reglas descubiertas.
2. Las reglas con `condition` (clave de frontmatter; `ttsr_trigger` / `ttsrTrigger` se aceptan como alternativa) se registran en `TtsrManager`.
3. Se construye una lista `rulebookRules` separada con este predicado:

```ts
!registeredTtsrRuleNames.has(rule.name) && !rule.alwaysApply && !!rule.description
```

4. Se construye una lista `alwaysApplyRules`:

```ts
!registeredTtsrRuleNames.has(rule.name) && rule.alwaysApply === true
```

### Comportamiento de los cubos

- **Cubo TTSR**: cualquier regla con `condition` (no se requiere descripción). Tiene prioridad sobre los demás cubos.
- **Cubo siempre-aplicar**: `alwaysApply === true`, no TTSR. El contenido completo se inyecta en el system prompt. Se puede resolver mediante `rule://`.
- **Cubo Rulebook**: debe tener descripción, no ser TTSR y no ser `alwaysApply`. Se lista en el system prompt por nombre y descripción; el contenido se lee bajo demanda mediante `rule://`.
- Una regla con tanto `condition` como `alwaysApply` va únicamente a TTSR (TTSR tiene prioridad).
- Una regla con tanto `alwaysApply` como `description` va únicamente a siempre-aplicar (no al Rulebook).

## 6. Cómo los metadatos afectan las superficies en tiempo de ejecución

### `description`

- Requerido para la inclusión en el Rulebook.
- Se renderiza en el bloque `<rules>` del system prompt.
- La ausencia de descripción significa que la regla no está disponible a través de `rule://` y no aparece en la sección de reglas del system prompt.

### `globs`

- Se transfiere en `Rule`.
- Se renderiza como entradas `<glob>...</glob>` en el bloque de reglas del system prompt.
- Se expone en el estado de la interfaz de reglas (lista del modo `extensions`).
- **No se aplica para la coincidencia automática en esta canalización.** No hay un selector de reglas en tiempo de ejecución basado en glob según el archivo actual o el destino de la herramienta.

### `alwaysApply`

- Analizado y preservado por los proveedores.
- Utilizado en la visualización de la interfaz (etiqueta de activación `"always"` en el gestor de estado de extensiones).
- Utilizado como condición de exclusión de `rulebookRules`.
- **El contenido completo de la regla se inyecta automáticamente en el system prompt** (antes de la sección de reglas del Rulebook).
- La regla también es direccionable mediante `rule://<name>` para su relectura.

### `ttsr_trigger`

- Mapeado a `rule.ttsrTrigger`.
- Si está presente, la regla se enruta al gestor TTSR, no al Rulebook.

## 7. Ruta de inclusión en el system prompt

`buildSystemPromptInternal` recibe tanto `rules` (Rulebook) como `alwaysApplyRules`.

Las reglas de siempre-aplicar se renderizan primero, inyectando su contenido sin procesar directamente en el prompt.

Las reglas del Rulebook se renderizan en una sección `# Rules` con:

- `Read rule://<name> when working in matching domain`
- El `name`, la `description` y la lista opcional de `<glob>` de cada regla

Esto es orientativo/contextual: el texto del prompt solicita al modelo que lea las reglas aplicables, pero el código no aplica la aplicabilidad de los globs.

## 8. Comportamiento de la URL interna `rule://`

`RuleProtocolHandler` se registra con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicaciones:

- `rule://<name>` se resuelve contra tanto **rulebookRules** como **alwaysApplyRules**.
- Las reglas solo-TTSR y las reglas sin descripción ni `alwaysApply` no son direccionables mediante `rule://`.
- La resolución es por coincidencia exacta del nombre.
- Los nombres desconocidos devuelven un error que lista los nombres de reglas disponibles.
- El contenido devuelto es el `rule.content` sin procesar (frontmatter eliminado), con tipo de contenido `text/markdown`.

## 9. Semánticas parciales / no aplicadas conocidas

1. Las descripciones de los proveedores mencionan archivos heredados (`.cursorrules`, `.windsurfrules`), pero las rutas de carga actuales no leen realmente esos archivos.
2. Los metadatos `globs` se exponen al prompt/interfaz, pero no son aplicados por la lógica de selección de reglas.
3. La selección de reglas para `rule://` incluye las reglas del Rulebook y de siempre-aplicar, pero no las reglas solo-TTSR.
4. Las advertencias de descubrimiento (`loadCapability("rules").warnings`) se generan, pero `createAgentSession` no las muestra ni las registra actualmente en esta ruta.
