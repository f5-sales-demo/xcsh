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
- contenido bajo demanda vía `read skill://...`
- comandos interactivos opcionales `/skill:<name>`

Este documento cubre el comportamiento actual del runtime en `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` y `src/discovery/agents-md.ts`.

## Qué es una habilidad en este código base

Una habilidad descubierta se representa como:

- `name`
- `description`
- `filePath` (la ruta del `SKILL.md`)
- `baseDir` (directorio de la habilidad)
- metadatos de origen (`provider`, `level`, path)

El runtime solo requiere `name` y `path` para ser válida. En la práctica, la calidad del emparejamiento depende de que `description` sea significativa.

## Disposición requerida y expectativas de SKILL.md

### Disposición de directorios

Para el descubrimiento basado en proveedores (proveedores native/Claude/Codex/Agents/plugin), las habilidades se descubren como **un nivel bajo `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Patrones anidados como `<skills-root>/group/<skill>/SKILL.md` no son descubiertos por los cargadores de proveedores.

Para `skills.customDirectories`, el escaneo usa la misma disposición no recursiva (`*/SKILL.md`).

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

Campos de frontmatter soportados en el tipo de habilidad:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- las claves adicionales se preservan como metadatos desconocidos

Comportamiento actual del runtime:

- `name` por defecto toma el nombre del directorio de la habilidad
- `description` es requerido para:
  - descubrimiento de habilidades del proveedor nativo `.xcsh` (`requireDescription: true`)
  - escaneos de `skills.customDirectories` vía `scanSkillsFromDir` en `src/discovery/helpers.ts` (no recursivo)
- los proveedores no nativos pueden cargar habilidades sin descripción

## Pipeline de descubrimiento

`discoverSkills()` en `src/extensibility/skills.ts` realiza dos pasadas:

1. **Proveedores de capacidades** vía `loadCapability("skills")`
2. **Directorios personalizados** vía `scanSkillsFromDir(..., { requireDescription: true })` (enumeración de directorios de un nivel)

Si `skills.enabled` es `false`, el descubrimiento no retorna habilidades.

### Proveedores de habilidades integrados y precedencia

El ordenamiento de proveedores es primero por prioridad (mayor gana), luego por orden de registro en caso de empate.

Proveedores de habilidades registrados actualmente:

1. `native` (prioridad 100) — habilidades de usuario/proyecto `.xcsh` vía `src/discovery/builtin.ts`
2. `claude` (prioridad 80)
3. grupo de prioridad 70 (en orden de registro):
   - `claude-plugins`
   - `agents`
   - `codex`

La clave de deduplicación es el nombre de la habilidad. El primer elemento con un nombre dado gana.

### Interruptores de origen y filtrado

`discoverSkills()` aplica estos controles:

- interruptores de origen: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtros glob sobre el nombre de la habilidad:
  - `ignoredSkills` (excluir)
  - `includeSkills` (lista de inclusión permitida; vacío significa incluir todo)

El orden de filtrado es:

1. origen habilitado
2. no ignorado
3. incluido (si la lista de inclusión está presente)

Para proveedores distintos de codex/claude/native (por ejemplo `agents`, `claude-plugins`), la habilitación actualmente recurre a: habilitado si **cualquier** interruptor de origen integrado está habilitado.

### Manejo de colisiones y duplicados

- La deduplicación de capacidades ya mantiene la primera habilidad por nombre (proveedor de mayor precedencia)
- `extensibility/skills.ts` adicionalmente:
  - deduplica archivos idénticos por `realpath` (seguro ante enlaces simbólicos)
  - emite advertencias de colisión cuando un nombre de habilidad posterior entra en conflicto
  - mantiene la API de conveniencia `discoverSkillsFromDir({ dir, source })` como un adaptador delgado sobre `scanSkillsFromDir`
- Las habilidades de directorios personalizados se fusionan después de las habilidades de proveedores y siguen el mismo comportamiento de colisión

## Comportamiento de uso en runtime

### Exposición en el prompt del sistema

La construcción del prompt del sistema (`src/system-prompt.ts`) usa las habilidades descubiertas de la siguiente manera:

- si la herramienta `read` está disponible:
  - incluir la lista de habilidades descubiertas en el prompt
- de lo contrario:
  - omitir la lista descubierta

Los subagentes de la herramienta task reciben la lista de habilidades descubiertas/proporcionadas de la sesión a través de la creación normal de sesión; no existe una anulación de fijación de habilidades por tarea.

### Comandos interactivos `/skill:<name>`

Si `skills.enableSkillCommands` es true, el modo interactivo registra un comando de barra diagonal por cada habilidad descubierta.

Comportamiento de `/skill:<name> [args]`:

- lee el archivo de habilidad directamente desde `filePath`
- elimina el frontmatter
- inyecta el cuerpo de la habilidad como un mensaje personalizado de seguimiento
- añade metadatos (`Skill: <path>`, opcional `User: <args>`)

## Comportamiento de URL `skill://`

`src/internal-urls/skill-protocol.ts` soporta:

- `skill://<name>` → se resuelve al `SKILL.md` de esa habilidad
- `skill://<name>/<relative-path>` → se resuelve dentro del directorio de esa habilidad

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
- las rutas relativas se decodifican como URL
- las rutas absolutas son rechazadas
- el recorrido de rutas (`..`) es rechazado
- la ruta resuelta debe permanecer dentro de `baseDir`
- los archivos faltantes retornan un error explícito `File not found`

Tipo de contenido:

- `.md` => `text/markdown`
- todo lo demás => `text/plain`

No se realiza búsqueda de respaldo para recursos faltantes.

## Habilidades vs AGENTS.md, comandos, herramientas, hooks

### Habilidades vs AGENTS.md

- **Habilidades**: paquetes de capacidades nombrados y opcionales seleccionados por contexto de tarea o solicitados explícitamente
- **AGENTS.md/archivos de contexto**: archivos de instrucciones persistentes cargados como capacidad de archivo de contexto y fusionados por reglas de nivel/profundidad

`src/discovery/agents-md.ts` específicamente recorre los directorios ancestros desde `cwd` para descubrir archivos `AGENTS.md` independientes (hasta profundidad 20), excluyendo segmentos de directorios ocultos.

### Habilidades vs comandos de barra diagonal

- **Habilidades**: contenido de conocimiento/flujo de trabajo legible por el modelo
- **Comandos de barra diagonal**: puntos de entrada de comandos invocados por el usuario
- `/skill:<name>` es un envoltorio de conveniencia que inyecta texto de habilidad; no cambia la semántica de descubrimiento de habilidades

### Habilidades vs herramientas personalizadas

- **Habilidades**: contenido de documentación/flujo de trabajo cargado a través del contexto del prompt y `read`
- **Herramientas personalizadas**: APIs de herramientas ejecutables invocables por el modelo con esquemas y efectos secundarios en runtime

### Habilidades vs hooks

- **Habilidades**: contenido pasivo
- **Hooks**: interceptores de runtime dirigidos por eventos que pueden bloquear/modificar el comportamiento durante la ejecución

## Guía práctica de autoría vinculada a la lógica de descubrimiento

- Coloque cada habilidad en su propio directorio: `<skills-root>/<skill-name>/SKILL.md`
- Siempre incluya frontmatter explícito de `name` y `description`
- Mantenga los recursos referenciados bajo el mismo directorio de habilidad y acceda con `skill://<name>/...`
- Para taxonomías anidadas (`team/domain/skill`), apunte `skills.customDirectories` al directorio padre anidado; el escaneo en sí permanece no recursivo
- Evite nombres de habilidad duplicados entre orígenes; la primera coincidencia gana por precedencia de proveedor
