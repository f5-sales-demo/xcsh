---
title: Habilidades
description: >-
  Sistema de habilidades para registrar, descubrir e invocar capacidades
  especializadas en el agente de codificación.
sidebar:
  order: 3
  label: Habilidades
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Habilidades

Las habilidades son paquetes de capacidades respaldados por archivos que se descubren al inicio y se exponen al modelo como:

- metadatos ligeros en el prompt del sistema (nombre + descripción)
- contenido bajo demanda mediante `read skill://...`
- comandos interactivos opcionales `/skill:<name>`

Este documento cubre el comportamiento actual en tiempo de ejecución en `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` y `src/discovery/agents-md.ts`.

## Qué es una habilidad en este código base

Una habilidad descubierta se representa como:

- `name`
- `description`
- `filePath` (la ruta de `SKILL.md`)
- `baseDir` (directorio de la habilidad)
- metadatos de origen (`provider`, `level`, ruta)

El tiempo de ejecución solo requiere `name` y `path` para la validez. En la práctica, la calidad de coincidencia depende de que `description` sea significativo.

## Estructura requerida y expectativas de SKILL.md

### Estructura de directorios

Para el descubrimiento basado en proveedores (proveedores native/Claude/Codex/Agents/plugin), las habilidades se descubren como **un nivel bajo `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Los patrones anidados como `<skills-root>/group/<skill>/SKILL.md` no son descubiertos por los cargadores de proveedores.

Para `skills.customDirectories`, el escaneo utiliza la misma estructura no recursiva (`*/SKILL.md`).

```text
Provider-discovered layout (non-recursive under skills/):

<root>/skills/
  ├─ postgres/
  │   └─ SKILL.md      ✅ discovered
  ├─ pdf/
  │   └─ SKILL.md      ✅ discovered
  └─ team/
      └─ internal/
          └─ SKILL.md  ❌ not discovered by provider loaders

Custom-directory scanning is also non-recursive, so nested paths are ignored unless you point `customDirectories` at that nested parent.
```

### Frontmatter de `SKILL.md`

Campos de frontmatter compatibles con el tipo de habilidad:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- las claves adicionales se conservan como metadatos desconocidos

Comportamiento actual en tiempo de ejecución:

- `name` toma por defecto el nombre del directorio de la habilidad
- `description` es requerido para:
  - el descubrimiento de habilidades del proveedor native `.xcsh` (`requireDescription: true`)
  - los escaneos de `skills.customDirectories` mediante `scanSkillsFromDir` en `src/discovery/helpers.ts` (no recursivo)
- los proveedores no nativos pueden cargar habilidades sin descripción

## Proceso de descubrimiento

`discoverSkills()` en `src/extensibility/skills.ts` realiza dos pasadas:

1. **Proveedores de capacidades** mediante `loadCapability("skills")`
2. **Directorios personalizados** mediante `scanSkillsFromDir(..., { requireDescription: true })` (enumeración de directorios de un nivel)

Si `skills.enabled` es `false`, el descubrimiento no devuelve habilidades.

### Proveedores de habilidades integrados y precedencia

El orden de los proveedores es primero por prioridad (mayor gana), luego por orden de registro en caso de empate.

Proveedores de habilidades registrados actualmente:

1. `native` (prioridad 100) — habilidades de usuario/proyecto `.xcsh` mediante `src/discovery/builtin.ts`
2. `claude` (prioridad 80)
3. grupo de prioridad 70 (en orden de registro):
   - `claude-plugins`
   - `agents`
   - `codex`

La clave de deduplicación es el nombre de la habilidad. El primer elemento con un nombre dado gana.

### Controles de origen y filtrado

`discoverSkills()` aplica estos controles:

- controles de origen: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtros de glob en el nombre de la habilidad:
  - `ignoredSkills` (excluir)
  - `includeSkills` (lista de permitidos de inclusión; vacío significa incluir todo)

El orden de filtrado es:

1. origen habilitado
2. no ignorado
3. incluido (si hay lista de inclusión presente)

Para proveedores distintos de codex/claude/native (por ejemplo `agents`, `claude-plugins`), la habilitación actualmente recurre a: habilitado si **cualquier** control de origen integrado está habilitado.

### Manejo de colisiones y duplicados

- La deduplicación de capacidades ya mantiene la primera habilidad por nombre (proveedor de mayor precedencia)
- `extensibility/skills.ts` adicionalmente:
  - deduplica archivos idénticos por `realpath` (seguro para enlaces simbólicos)
  - emite advertencias de colisión cuando el nombre de una habilidad posterior entra en conflicto
  - mantiene la API de conveniencia `discoverSkillsFromDir({ dir, source })` como un adaptador delgado sobre `scanSkillsFromDir`
- Las habilidades de directorios personalizados se fusionan después de las habilidades de los proveedores y siguen el mismo comportamiento de colisión

## Comportamiento de uso en tiempo de ejecución

### Exposición en el prompt del sistema

La construcción del prompt del sistema (`src/system-prompt.ts`) utiliza las habilidades descubiertas de la siguiente manera:

- si la herramienta `read` está disponible:
  - incluir la lista de habilidades descubiertas en el prompt
- de lo contrario:
  - omitir la lista descubierta

Los subagentes de la herramienta de tareas reciben la lista de habilidades descubiertas/proporcionadas de la sesión mediante la creación normal de sesión; no existe anulación de fijación de habilidades por tarea.

### Comandos interactivos `/skill:<name>`

Si `skills.enableSkillCommands` es true, el modo interactivo registra un comando slash por cada habilidad descubierta.

Comportamiento de `/skill:<name> [args]`:

- lee el archivo de la habilidad directamente desde `filePath`
- elimina el frontmatter
- inyecta el cuerpo de la habilidad como un mensaje personalizado de seguimiento
- agrega metadatos (`Skill: <path>`, `User: <args>` opcional)

## Comportamiento de URL `skill://`

`src/internal-urls/skill-protocol.ts` admite:

- `skill://<name>` → resuelve al `SKILL.md` de esa habilidad
- `skill://<name>/<relative-path>` → resuelve dentro del directorio de esa habilidad

```text
skill:// URL resolution

skill://pdf
  -> <pdf-base>/SKILL.md

skill://pdf/references/tables.md
  -> <pdf-base>/references/tables.md

Guards:
- reject absolute paths
- reject `..` traversal
- reject any resolved path escaping <pdf-base>
```

Detalles de resolución:

- el nombre de la habilidad debe coincidir exactamente
- las rutas relativas se decodifican con URL
- las rutas absolutas son rechazadas
- el traversal de rutas (`..`) es rechazado
- la ruta resuelta debe permanecer dentro de `baseDir`
- los archivos faltantes devuelven un error explícito de `File not found`

Tipo de contenido:

- `.md` => `text/markdown`
- todo lo demás => `text/plain`

No se realiza búsqueda de reserva para activos faltantes.

## Habilidades vs AGENTS.md, comandos, herramientas, hooks

### Habilidades vs AGENTS.md

- **Habilidades**: paquetes de capacidades opcionales y con nombre seleccionados por el contexto de la tarea o solicitados explícitamente
- **AGENTS.md/archivos de contexto**: archivos de instrucciones persistentes cargados como capacidad de archivo de contexto y fusionados por reglas de nivel/profundidad

`src/discovery/agents-md.ts` recorre específicamente los directorios ancestros desde `cwd` para descubrir archivos `AGENTS.md` independientes (hasta una profundidad de 20), excluyendo segmentos de directorios ocultos.

### Habilidades vs comandos slash

- **Habilidades**: contenido de conocimiento/flujo de trabajo legible por el modelo
- **Comandos slash**: puntos de entrada de comandos invocados por el usuario
- `/skill:<name>` es un envoltorio de conveniencia que inyecta texto de la habilidad; no cambia la semántica de descubrimiento de habilidades

### Habilidades vs herramientas personalizadas

- **Habilidades**: contenido de documentación/flujo de trabajo cargado a través del contexto del prompt y `read`
- **Herramientas personalizadas**: APIs de herramientas ejecutables invocables por el modelo con esquemas y efectos secundarios en tiempo de ejecución

### Habilidades vs hooks

- **Habilidades**: contenido pasivo
- **Hooks**: interceptores de tiempo de ejecución basados en eventos que pueden bloquear/modificar el comportamiento durante la ejecución

## Guía práctica de autoría vinculada a la lógica de descubrimiento

- Coloque cada habilidad en su propio directorio: `<skills-root>/<skill-name>/SKILL.md`
- Incluya siempre frontmatter explícito de `name` y `description`
- Mantenga los activos referenciados bajo el mismo directorio de la habilidad y acceda a ellos con `skill://<name>/...`
- Para taxonomía anidada (`team/domain/skill`), apunte `skills.customDirectories` al directorio padre anidado; el escaneo en sí permanece no recursivo
- Evite nombres de habilidades duplicados entre fuentes; la primera coincidencia gana por precedencia del proveedor
