---
title: Descubrimiento y resolución de configuración
description: >-
  Cómo xcsh descubre, resuelve y superpone la configuración desde las raíces de
  proyecto, usuario y empresa.
sidebar:
  order: 1
  label: Configuración
i18n:
  sourceHash: a8d23493ed0d
  translator: machine
---

# Descubrimiento y resolución de configuración

Este documento describe cómo el coding-agent resuelve la configuración actualmente: qué raíces se escanean, cómo funciona la precedencia y cómo la configuración resuelta es consumida por settings, skills, hooks, tools y extensions.

## Alcance

Implementación principal:

- `src/config.ts`
- `src/config/settings.ts`
- `src/config/settings-schema.ts`
- `src/discovery/builtin.ts`
- `src/discovery/helpers.ts`

Puntos clave de integración:

- `src/capability/index.ts`
- `src/discovery/index.ts`
- `src/extensibility/skills.ts`
- `src/extensibility/hooks/loader.ts`
- `src/extensibility/custom-tools/loader.ts`
- `src/extensibility/extensions/loader.ts`

---

## Flujo de resolución (visual)

```text
         Config roots (ordered)
┌───────────────────────────────────────┐
│ 1) ~/.xcsh/agent + <cwd>/.xcsh          │
│ 2) ~/.claude   + <cwd>/.claude        │
│ 3) ~/.codex    + <cwd>/.codex         │
│ 4) ~/.gemini   + <cwd>/.gemini        │
└───────────────────────────────────────┘
                    │
                    ▼
        config.ts helper resolution
  (getConfigDirs/findConfigFile/findNearest...)
                    │
                    ▼
       capability providers enumerate items
 (native, claude, codex, gemini, agents, etc.)
                    │
                    ▼
      priority sort + per-capability dedup
                    │
                    ▼
          subsystem-specific consumption
   (settings, skills, hooks, tools, extensions)
```

## 1) Raíces de configuración y orden de fuentes

## Raíces canónicas

`src/config.ts` define una lista fija de prioridad de fuentes:

1. `.xcsh` (nativo)
2. `.claude`
3. `.codex`
4. `.gemini`

Bases a nivel de usuario:

- `~/.xcsh/agent`
- `~/.claude`
- `~/.codex`
- `~/.gemini`

Bases a nivel de proyecto:

- `<cwd>/.xcsh`
- `<cwd>/.claude`
- `<cwd>/.codex`
- `<cwd>/.gemini`

`CONFIG_DIR_NAME` es `.xcsh` (`packages/utils/src/dirs.ts`).

## Restricción importante

Los helpers genéricos en `src/config.ts` **no** incluyen `.pi` en el orden de descubrimiento de fuentes.

---

## 2) Helpers principales de descubrimiento (`src/config.ts`)

## `getConfigDirs(subpath, options)`

Retorna entradas ordenadas:

- Entradas a nivel de usuario primero (por prioridad de fuente)
- Luego entradas a nivel de proyecto (con la misma prioridad de fuente)

Opciones:

- `user` (por defecto `true`)
- `project` (por defecto `true`)
- `cwd` (por defecto `getProjectDir()`)
- `existingOnly` (por defecto `false`)

Esta API se usa para búsquedas de configuración basadas en directorios (commands, hooks, tools, agents, etc.).

## `findConfigFile(subpath, options)` / `findConfigFileWithMeta(...)`

Busca el primer archivo existente a través de las bases ordenadas, retorna la primera coincidencia (solo ruta o ruta+metadatos).

## `findAllNearestProjectConfigDirs(subpath, cwd)`

Recorre los directorios padre hacia arriba y retorna el **directorio existente más cercano por base de fuente** (`.xcsh`, `.claude`, `.codex`, `.gemini`), luego ordena los resultados por prioridad de fuente.

Use esto cuando la configuración del proyecto debe heredarse de directorios ancestros (comportamiento de monorepo/workspace anidado).

---

## 3) Wrapper de archivo de configuración (`ConfigFile<T>` en `src/config.ts`)

`ConfigFile<T>` es el cargador con validación de esquema para archivos de configuración individuales.

Formatos soportados:

- `.yml` / `.yaml`
- `.json` / `.jsonc`

Comportamiento:

- Valida los datos parseados con AJV contra un esquema TypeBox proporcionado.
- Almacena en caché el resultado de carga hasta `invalidate()`.
- Retorna resultado con tres estados vía `tryLoad()`:
  - `ok`
  - `not-found`
  - `error` (`ConfigError` con contexto de esquema/parseo)

Migración legacy aún soportada:

- Si la ruta objetivo es `.yml`/`.yaml`, un archivo `.json` hermano se migra automáticamente una vez (`migrateJsonToYml`).

---

## 4) Modelo de resolución de settings (`src/config/settings.ts`)

El modelo de settings en tiempo de ejecución está organizado en capas:

1. Settings globales: `~/.xcsh/agent/config.yml`
2. Settings de proyecto: descubiertos vía capability de settings (`settings.json` desde providers)
3. Overrides en tiempo de ejecución: en memoria, no persistentes
4. Valores por defecto del esquema: desde `SETTINGS_SCHEMA`

Ruta de lectura efectiva:

`defaults <- global <- project <- overrides`

Comportamiento de escritura:

- `settings.set(...)` escribe en la capa **global** (`config.yml`) y encola un guardado en segundo plano.
- Los settings de proyecto son de solo lectura desde el descubrimiento de capabilities.

## Comportamiento de migración aún activo

Al iniciar, si `config.yml` no existe:

1. Migrar desde `~/.xcsh/agent/settings.json` (renombrado a `.bak` en caso de éxito)
2. Fusionar con settings legacy de la BD desde `agent.db`
3. Escribir el resultado fusionado en `config.yml`

Migraciones a nivel de campo en `#migrateRawSettings`:

- `queueMode` -> `steeringMode`
- `ask.timeout` milisegundos -> segundos cuando el valor antiguo parece estar en ms (`> 1000`)
- `theme: "..."` plano legacy -> estructura `theme.dark/theme.light`

---

## 5) Integración con capability/discovery

La mayoría de los flujos de carga de configuración no centrales pasan por el registro de capabilities (`src/capability/index.ts` + `src/discovery/index.ts`).

## Ordenamiento de providers

Los providers se ordenan por prioridad numérica (mayor primero). Ejemplo de prioridades:

- Native OMP (`builtin.ts`): `100`
- Claude: `80`
- Codex / agents / Claude marketplace: `70`
- Gemini: `60`

```text
Provider precedence (higher wins)

native (.xcsh)          priority 100
claude                 priority  80
codex / agents / ...   priority  70
gemini                 priority  60
```

## Semántica de deduplicación

Las capabilities definen un `key(item)`:

- misma key => el primer elemento gana (elemento con mayor prioridad/cargado primero)
- sin key (`undefined`) => sin deduplicación, todos los elementos se retienen

Keys relevantes:

- skills: `name`
- tools: `name`
- hooks: `${type}:${tool}:${name}`
- extension modules: `name`
- extensions: `name`
- settings: sin deduplicación (todos los elementos se preservan)

---

## 6) Comportamiento del provider nativo `.xcsh` (`src/discovery/builtin.ts`)

El provider nativo (`id: native`) lee desde:

- proyecto: `<cwd>/.xcsh/...`
- usuario: `~/.xcsh/agent/...`

### Regla de admisión de directorios

`builtin.ts` solo incluye una raíz de configuración si el directorio existe **y no está vacío** (`ifNonEmptyDir`).

### Carga específica por alcance

- Skills: `skills/*/SKILL.md`
- Slash commands: `commands/*.md`
- Rules: `rules/*.{md,mdc}`
- Prompts: `prompts/*.md`
- Instructions: `instructions/*.md`
- Hooks: `hooks/pre/*`, `hooks/post/*`
- Tools: `tools/*.json|*.md` y `tools/<name>/index.ts`
- Extension modules: descubiertos bajo `extensions/` (+ array de strings legacy `settings.json.extensions`)
- Extensions: `extensions/<name>/gemini-extension.json`
- Settings capability: `settings.json`

### Matiz de búsqueda del proyecto más cercano

Para `SYSTEM.md` y `AGENTS.md`, el provider nativo usa la búsqueda del directorio `.xcsh` de proyecto ancestro más cercano (recorrido ascendente) pero aún requiere que el directorio `.xcsh` no esté vacío.

---

## 7) Cómo los principales subsistemas consumen la configuración

## Subsistema de settings

- `Settings.init()` carga el `config.yml` global + los elementos de capability de `settings.json` de proyecto descubiertos.
- Solo los elementos de capability con `level === "project"` se fusionan en la capa de proyecto.

## Subsistema de skills

- `extensibility/skills.ts` carga vía `loadCapability(skillCapability.id, { cwd })`.
- Aplica toggles de fuente y filtros (`ignoredSkills`, `includeSkills`, directorios personalizados).
- Los toggles con nombres legacy aún existen (`skills.enablePiUser`, `skills.enablePiProject`) pero controlan el provider nativo (`provider === "native"`).

## Subsistema de hooks

- `discoverAndLoadHooks()` resuelve las rutas de hooks desde la capability de hooks + rutas configuradas explícitamente.
- Luego carga los módulos vía importación de Bun.

## Subsistema de tools

- `discoverAndLoadCustomTools()` resuelve las rutas de tools desde la capability de tools + rutas de tools de plugins + rutas configuradas explícitamente.
- Los archivos de tools declarativos `.md/.json` son solo metadatos; la carga ejecutable espera módulos de código.

## Subsistema de extensions

- `discoverAndLoadExtensions()` resuelve los módulos de extension desde la capability de extension-module más las rutas explícitas.
- La implementación actual mantiene intencionalmente solo los elementos de capability con `_source.provider === "native"` antes de cargar.

---

## 8) Reglas de precedencia en las que confiar

Use este modelo mental:

1. El orden de directorios fuente de `config.ts` determina el orden de rutas candidatas.
2. La prioridad del provider de capability determina la precedencia entre providers.
3. La deduplicación por key de capability determina el comportamiento en colisiones (el primero gana para capabilities con key).
4. La lógica de fusión específica del subsistema puede cambiar aún más la precedencia efectiva (especialmente settings).

### Advertencia específica de settings

Los elementos de capability de settings no se deduplican; `Settings.#loadProjectSettings()` hace deep-merge de los elementos de proyecto en el orden retornado. Dado que la fusión aplica los valores del último elemento sobre los anteriores, el comportamiento de override efectivo depende del orden de emisión del provider, no solo de la semántica de key de capability.

---

## 9) Comportamientos legacy/de compatibilidad aún presentes

- Migración de `ConfigFile` JSON -> YAML para archivos destinados a YAML.
- Migración de settings desde `settings.json` y `agent.db` a `config.yml`.
- Migraciones de keys de settings (`queueMode`, `ask.timeout`, `theme` plano).
- Compatibilidad de manifiesto de extensiones: el loader acepta tanto las secciones de manifiesto `package.json.xcsh` como `package.json.pi`.
- Los nombres legacy de settings `skills.enablePiUser` / `skills.enablePiProject` siguen siendo controles activos para la fuente de skills nativa.

Si estas rutas de compatibilidad se eliminan en el código, actualice este documento inmediatamente; varios comportamientos en tiempo de ejecución aún dependen de ellas hoy.
