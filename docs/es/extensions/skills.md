---
title: Skills
description: >-
  Sistema de skills para registrar, descubrir e invocar capacidades
  especializadas en el agente de codificación.
sidebar:
  order: 3
  label: Skills
i18n:
  sourceHash: 7bf785fb8128
  translator: machine
---

# Skills

Los skills son paquetes de capacidades respaldados por archivos, descubiertos al inicio y expuestos al modelo como:

- metadatos ligeros en el prompt del sistema (nombre + descripción)
- contenido bajo demanda vía `read skill://...`
- comandos interactivos opcionales `/skill:<name>`

Este documento cubre el comportamiento actual del runtime en `src/extensibility/skills.ts`, `src/discovery/builtin.ts`, `src/internal-urls/skill-protocol.ts` y `src/discovery/agents-md.ts`.

## Qué es un skill en este código base

Un skill descubierto se representa como:

- `name`
- `description`
- `filePath` (la ruta de `SKILL.md`)
- `baseDir` (directorio del skill)
- metadatos de origen (`provider`, `level`, path)

El runtime solo requiere `name` y `path` para ser válido. En la práctica, la calidad de coincidencia depende de que `description` sea significativo.

## Estructura requerida y expectativas de SKILL.md

### Estructura de directorios

Para el descubrimiento basado en proveedores (proveedores native/Claude/Codex/Agents/plugin), los skills se descubren como **un nivel bajo `skills/`**:

- `<skills-root>/<skill-name>/SKILL.md`

Patrones anidados como `<skills-root>/group/<skill>/SKILL.md` no son descubiertos por los cargadores de proveedores.

Para `skills.customDirectories`, el escaneo usa la misma estructura no recursiva (`*/SKILL.md`).

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

Campos de frontmatter soportados en el tipo de skill:

- `name?: string`
- `description?: string`
- `globs?: string[]`
- `alwaysApply?: boolean`
- las claves adicionales se preservan como metadatos desconocidos

Comportamiento actual del runtime:

- `name` usa por defecto el nombre del directorio del skill
- `description` es requerido para:
  - descubrimiento de skills del proveedor nativo `.xcsh` (`requireDescription: true`)
  - escaneos de `skills.customDirectories` vía `scanSkillsFromDir` en `src/discovery/helpers.ts` (no recursivo)
- los proveedores no nativos pueden cargar skills sin descripción

## Pipeline de descubrimiento

`discoverSkills()` en `src/extensibility/skills.ts` realiza dos pasadas:

1. **Proveedores de capacidades** vía `loadCapability("skills")`
2. **Directorios personalizados** vía `scanSkillsFromDir(..., { requireDescription: true })` (enumeración de directorios de un nivel)

Si `skills.enabled` es `false`, el descubrimiento no retorna skills.

### Proveedores de skills integrados y precedencia

El ordenamiento de proveedores es por prioridad primero (mayor gana), luego por orden de registro en caso de empate.

Proveedores de skills registrados actualmente:

1. `native` (prioridad 100) — skills de usuario/proyecto `.xcsh` vía `src/discovery/builtin.ts`
2. `claude` (prioridad 80)
3. grupo de prioridad 70 (en orden de registro):
   - `claude-plugins`
   - `agents`
   - `codex`

La clave de deduplicación es el nombre del skill. El primer elemento con un nombre dado gana.

### Toggles de origen y filtrado

`discoverSkills()` aplica estos controles:

- toggles de origen: `enableCodexUser`, `enableClaudeUser`, `enableClaudeProject`, `enablePiUser`, `enablePiProject`
- filtros glob sobre el nombre del skill:
  - `ignoredSkills` (excluir)
  - `includeSkills` (lista de inclusión permitida; vacía significa incluir todos)

El orden de filtrado es:

1. origen habilitado
2. no ignorado
3. incluido (si la lista de inclusión está presente)

Para proveedores distintos a codex/claude/native (por ejemplo `agents`, `claude-plugins`), la habilitación actualmente recurre a: habilitado si **cualquier** toggle de origen integrado está habilitado.

### Colisiones y manejo de duplicados

- La deduplicación de capacidades ya mantiene el primer skill por nombre (proveedor de mayor precedencia)
- `extensibility/skills.ts` adicionalmente:
  - deduplica archivos idénticos por `realpath` (seguro para symlinks)
  - emite advertencias de colisión cuando un nombre de skill posterior entra en conflicto
  - mantiene la API de conveniencia `discoverSkillsFromDir({ dir, source })` como un adaptador ligero sobre `scanSkillsFromDir`
- Los skills de directorios personalizados se fusionan después de los skills de proveedores y siguen el mismo comportamiento de colisión

## Comportamiento de uso en runtime

### Exposición en el prompt del sistema

La construcción del prompt del sistema (`src/system-prompt.ts`) usa los skills descubiertos de la siguiente manera:

- si la herramienta `read` está disponible:
  - incluir la lista de skills descubiertos en el prompt
- de lo contrario:
  - omitir la lista descubierta

Los subagentes de la herramienta Task reciben la lista de skills descubiertos/proporcionados de la sesión vía la creación normal de sesión; no existe una anulación de fijación de skills por tarea.

### Comandos interactivos `/skill:<name>`

Si `skills.enableSkillCommands` es true, el modo interactivo registra un comando slash por cada skill descubierto.

Comportamiento de `/skill:<name> [args]`:

- lee el archivo del skill directamente desde `filePath`
- elimina el frontmatter
- inyecta el cuerpo del skill como un mensaje personalizado de seguimiento
- añade metadatos (`Skill: <path>`, opcional `User: <args>`)

## Comportamiento de URL `skill://`

`src/internal-urls/skill-protocol.ts` soporta:

- `skill://<name>` → resuelve al `SKILL.md` de ese skill
- `skill://<name>/<relative-path>` → resuelve dentro del directorio de ese skill

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

- el nombre del skill debe coincidir exactamente
- las rutas relativas se decodifican de URL
- las rutas absolutas se rechazan
- la navegación por ruta (`..`) se rechaza
- la ruta resuelta debe permanecer dentro de `baseDir`
- los archivos faltantes retornan un error explícito `File not found`

Tipo de contenido:

- `.md` => `text/markdown`
- todo lo demás => `text/plain`

No se realiza búsqueda de respaldo para assets faltantes.

## Skills vs AGENTS.md, comandos, herramientas, hooks

### Skills vs AGENTS.md

- **Skills**: paquetes de capacidades nombrados y opcionales, seleccionados por contexto de tarea o solicitados explícitamente
- **AGENTS.md/archivos de contexto**: archivos de instrucciones persistentes cargados como capacidad de archivo de contexto y fusionados por reglas de nivel/profundidad

`src/discovery/agents-md.ts` específicamente recorre directorios ancestros desde `cwd` para descubrir archivos `AGENTS.md` independientes (hasta profundidad 20), excluyendo segmentos de directorios ocultos.

### Skills vs comandos slash

- **Skills**: contenido de conocimiento/flujo de trabajo legible por el modelo
- **Comandos slash**: puntos de entrada de comandos invocados por el usuario
- `/skill:<name>` es un wrapper de conveniencia que inyecta texto del skill; no cambia la semántica de descubrimiento de skills

### Skills vs herramientas personalizadas

- **Skills**: contenido de documentación/flujo de trabajo cargado a través del contexto del prompt y `read`
- **Herramientas personalizadas**: APIs de herramientas ejecutables invocables por el modelo con esquemas y efectos secundarios en runtime

### Skills vs hooks

- **Skills**: contenido pasivo
- **Hooks**: interceptores de runtime dirigidos por eventos que pueden bloquear/modificar el comportamiento durante la ejecución

## Guía práctica de autoría vinculada a la lógica de descubrimiento

- Coloque cada skill en su propio directorio: `<skills-root>/<skill-name>/SKILL.md`
- Siempre incluya frontmatter explícito de `name` y `description`
- Mantenga los assets referenciados bajo el mismo directorio del skill y acceda con `skill://<name>/...`
- Para taxonomías anidadas (`team/domain/skill`), apunte `skills.customDirectories` al directorio padre anidado; el escaneo en sí permanece no recursivo
- Evite nombres de skill duplicados entre orígenes; la primera coincidencia gana por precedencia del proveedor
