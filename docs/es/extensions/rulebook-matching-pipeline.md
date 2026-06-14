---
title: Pipeline de coincidencia de Rulebook
description: >-
  Pipeline de coincidencia de rulebook para seleccionar y aplicar conjuntos de
  instrucciones específicos del contexto a las sesiones del agente.
sidebar:
  order: 6
  label: Coincidencia de Rulebook
i18n:
  sourceHash: a16a9c565053
  translator: machine
---

# Pipeline de coincidencia de Rulebook

Este documento describe cómo el agente de codificación descubre reglas de los formatos de configuración admitidos, las normaliza en una única forma `Rule`, resuelve conflictos de precedencia y divide el resultado en:

- **Reglas de Rulebook** (disponibles para el modelo a través del prompt del sistema + URLs `rule://`)
- **Reglas TTSR** (reglas de interrupción de flujo de viaje en el tiempo)

Refleja la implementación actual, incluidas las semánticas parciales y los metadatos que se analizan pero no se aplican.

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
- el frontmatter se analiza mediante `parseFrontmatter`
- `content` = cuerpo (frontmatter eliminado)
- `globs`, `alwaysApply`, `description`, `ttsr_trigger` mapeados directamente

Advertencia importante: `globs` se convierte como `string[] | undefined` sin filtrado de elementos en este proveedor.

### Proveedor Cursor (`cursor.ts`)

Carga desde:

- usuario: `~/.cursor/rules/*.{mdc,md}`
- proyecto: `<cwd>/.cursor/rules/*.{mdc,md}`

Normalización (`transformMDCRule`):

- `description`: se conserva solo si es una cadena de texto
- `alwaysApply`: solo se preserva `true` (`false` se convierte en `undefined`)
- `globs`: acepta un arreglo (solo elementos de tipo cadena) o una sola cadena
- `ttsr_trigger`: solo cadena de texto
- `name` del nombre de archivo sin extensión

### Proveedor Windsurf (`windsurf.ts`)

Carga desde:

- usuario: `~/.codeium/windsurf/memories/global_rules.md` (nombre de regla fijo `global_rules`)
- proyecto: `<cwd>/.windsurf/rules/*.md`

Normalización:

- `globs`: arreglo de cadenas o una sola cadena
- `alwaysApply`, `description` convertidos desde el frontmatter
- `ttsr_trigger`: solo cadena de texto
- `name` del nombre de archivo para reglas de proyecto

### Proveedor Cline (`cline.ts`)

Busca hacia arriba desde `cwd` el `.clinerules` más cercano:

- si es directorio: carga los `*.md` que contiene
- si es archivo: carga el archivo único como regla con el nombre `clinerules`

Normalización:

- `globs`: arreglo de cadenas o una sola cadena
- `alwaysApply`: solo si es booleano
- `description`: solo cadena de texto
- `ttsr_trigger`: solo cadena de texto

## 3. Comportamiento del análisis de frontmatter y ambigüedad

Todos los proveedores usan `parseFrontmatter` (`utils/frontmatter.ts`) con estas semánticas:

1. El frontmatter se analiza solo cuando el contenido comienza con `---` y tiene un cierre `\n---`.
2. El cuerpo se recorta después de la extracción del frontmatter.
3. Si el análisis de YAML falla:
   - se registra una advertencia,
   - el analizador recurre al análisis simple de líneas `key: value` (`^(\w+):\s*(.*)$`).

Consecuencias de la ambigüedad:

- El analizador de reserva no admite arreglos, objetos anidados, reglas de entrecomillado ni claves con guiones.
- Los valores de reserva se convierten en cadenas de texto (por ejemplo, `alwaysApply: true` se convierte en la cadena `"true"`), por lo que los proveedores que requieren tipos booleanos/cadena pueden descartar metadatos.
- `ttsr_trigger` funciona en el modo de reserva (clave con guion bajo); claves como `thinking-level` no funcionarían.
- Los archivos sin frontmatter válido se cargan igualmente como reglas con metadatos vacíos y el cuerpo de contenido completo.

## 4. Precedencia de proveedores y deduplicación

`loadCapability("rules")` (`capability/index.ts`) combina las salidas de los proveedores y luego deduplica por `rule.name`.

### Modelo de precedencia

- Los proveedores se ordenan por prioridad descendente.
- La misma prioridad mantiene el orden de registro (`cursor` antes que `windsurf` en `discovery/index.ts`).
- La deduplicación es por primero-encontrado-primero-conservado: el primer nombre de regla encontrado se conserva; los elementos posteriores con el mismo nombre se marcan como `_shadowed` en `all` y se excluyen de `items`.

El orden efectivo de proveedores de reglas actualmente es:

1. `native` (100)
2. `cursor` (50)
3. `windsurf` (50)
4. `cline` (40)

### Advertencia sobre el ordenamiento dentro del proveedor

Dentro de un proveedor, el orden de los elementos proviene del ordenamiento del resultado glob de `loadFilesFromDir` más el orden explícito de inserción. Esto es suficientemente determinista para el uso normal, pero no está ordenado explícitamente en el código.

Diferencias notables en el orden de las fuentes:

- `native` añade primero los directorios de configuración del proyecto y luego los del usuario.
- `cursor` añade primero los resultados del usuario y luego los del proyecto.
- `windsurf` añade primero `global_rules` del usuario y luego las reglas del proyecto.
- `cline` carga únicamente la fuente `.clinerules` más cercana.

## 5. División en categorías Rulebook, Aplicación-siempre y TTSR

Después del descubrimiento de reglas en `createAgentSession` (`sdk.ts`):

1. Se analizan todas las reglas descubiertas.
2. Las reglas con `condition` (clave de frontmatter; `ttsr_trigger` / `ttsrTrigger` se aceptan como alternativa) se registran en `TtsrManager`.
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
- **Categoría de aplicación-siempre**: `alwaysApply === true`, no TTSR. El contenido completo se inyecta en el prompt del sistema. Resoluble mediante `rule://`.
- **Categoría Rulebook**: debe tener descripción, no debe ser TTSR, no debe tener `alwaysApply`. Se lista en el prompt del sistema por nombre+descripción; el contenido se lee bajo demanda mediante `rule://`.
- Una regla con tanto `condition` como `alwaysApply` va únicamente a TTSR (TTSR tiene prioridad).
- Una regla con tanto `alwaysApply` como `description` va únicamente a aplicación-siempre (no al rulebook).

## 6. Cómo los metadatos afectan las superficies de ejecución

### `description`

- Requerida para su inclusión en el rulebook.
- Se renderiza en el bloque `<rules>` del prompt del sistema.
- La ausencia de descripción significa que la regla no está disponible a través de `rule://` y no se lista en las reglas del prompt del sistema.

### `globs`

- Se transporta en `Rule`.
- Se renderiza como entradas `<glob>...</glob>` en el bloque de reglas del prompt del sistema.
- Se expone en el estado de la interfaz de reglas (lista en modo `extensions`).
- **No se aplica para la coincidencia automática en este pipeline.** No existe un comparador de globs en tiempo de ejecución que seleccione reglas según el archivo actual o el destino de la herramienta.

### `alwaysApply`

- Analizado y preservado por los proveedores.
- Usado en la visualización de la interfaz (etiqueta de disparador `"always"` en el gestor de estado de extensiones).
- Usado como condición de exclusión de `rulebookRules`.
- **El contenido completo de la regla se inyecta automáticamente en el prompt del sistema** (antes de la sección de reglas del rulebook).
- La regla también es direccionable mediante `rule://<name>` para su relectura.

### `ttsr_trigger`

- Mapeado a `rule.ttsrTrigger`.
- Si está presente, la regla se enruta al gestor TTSR, no al rulebook.

## 7. Ruta de inclusión en el prompt del sistema

`buildSystemPromptInternal` recibe tanto `rules` (rulebook) como `alwaysApplyRules`.

Las reglas de aplicación-siempre se renderizan primero, inyectando su contenido sin procesar directamente en el prompt.

Las reglas del rulebook se renderizan en una sección `# Rules` con:

- `Read rule://<name> when working in matching domain`
- El `name`, `description` y lista opcional de `<glob>` de cada regla

Esto es informativo/contextual: el texto del prompt solicita al modelo que lea las reglas aplicables, pero el código no aplica la viabilidad de los globs.

## 8. Comportamiento de la URL interna `rule://`

`RuleProtocolHandler` se registra con:

```ts
new RuleProtocolHandler({ getRules: () => [...rulebookRules, ...alwaysApplyRules] })
```

Implicaciones:

- `rule://<name>` se resuelve contra tanto **rulebookRules** como **alwaysApplyRules**.
- Las reglas únicamente TTSR y las reglas sin descripción ni `alwaysApply` no son direccionables mediante `rule://`.
- La resolución es por coincidencia exacta de nombre.
- Los nombres desconocidos devuelven un error listando los nombres de reglas disponibles.
- El contenido devuelto es el `rule.content` sin procesar (frontmatter eliminado), con tipo de contenido `text/markdown`.

## 9. Semánticas parciales / no aplicadas conocidas

1. Las descripciones de los proveedores mencionan archivos heredados (`.cursorrules`, `.windsurfrules`), pero las rutas de carga de código actuales no leen esos archivos.
2. Los metadatos de `globs` se exponen al prompt/interfaz, pero no se aplican en la lógica de selección de reglas.
3. La selección de reglas para `rule://` incluye las reglas del rulebook y las de aplicación-siempre, pero no las reglas únicamente TTSR.
4. Las advertencias de descubrimiento (`loadCapability("rules").warnings`) se producen, pero `createAgentSession` no las expone ni las registra actualmente en esta ruta.
