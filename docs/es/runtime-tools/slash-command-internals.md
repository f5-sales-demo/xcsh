---
title: Internos de los comandos de barra
description: >-
  Internos del sistema de comandos de barra con registro, análisis de argumentos
  y despacho de ejecución.
sidebar:
  order: 5
  label: Comandos de barra
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Internos de los comandos de barra

Este documento describe cómo se descubren, deduplican, exponen en modo interactivo y expanden en tiempo de prompt los comandos de barra en `coding-agent`.

## Archivos de implementación

- [`src/extensibility/slash-commands.ts`](../../packages/coding-agent/src/extensibility/slash-commands.ts)
- [`src/capability/slash-command.ts`](../../packages/coding-agent/src/capability/slash-command.ts)
- [`src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`src/discovery/claude.ts`](../../packages/coding-agent/src/discovery/claude.ts)
- [`src/discovery/codex.ts`](../../packages/coding-agent/src/discovery/codex.ts)
- [`src/discovery/claude-plugins.ts`](../../packages/coding-agent/src/discovery/claude-plugins.ts)
- [`src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`src/session/agent-session.ts`](../../packages/coding-agent/src/session/agent-session.ts)
- [`src/modes/interactive-mode.ts`](../../packages/coding-agent/src/modes/interactive-mode.ts)
- [`src/modes/controllers/input-controller.ts`](../../packages/coding-agent/src/modes/controllers/input-controller.ts)
- [`src/modes/utils/ui-helpers.ts`](../../packages/coding-agent/src/modes/utils/ui-helpers.ts)
- [`src/modes/controllers/command-controller.ts`](../../packages/coding-agent/src/modes/controllers/command-controller.ts)

## 1) Modelo de descubrimiento

Los comandos de barra son una capacidad (`id: "slash-commands"`) indexada por nombre de comando (`key: cmd => cmd.name`).

El registro de capacidades carga todos los proveedores registrados, ordenados por prioridad de proveedor de forma descendente, y deduplica por clave con semántica de **primero gana**.

### Precedencia de proveedores

Proveedores actuales de comandos de barra y prioridades:

1. `native` (OMP) — prioridad `100`
2. `claude` — prioridad `80`
3. `claude-plugins` — prioridad `70`
4. `codex` — prioridad `70`

Comportamiento en empate: los proveedores con igual prioridad mantienen el orden de registro. El orden de importación actual registra `claude-plugins` antes que `codex`, por lo que los comandos de plugins ganan sobre los comandos de codex en colisiones de nombres.

### Comportamiento en colisión de nombres

Para `slash-commands`, las colisiones se resuelven estrictamente mediante la deduplicación de capacidades:

- el elemento de mayor precedencia se mantiene en `result.items`
- los duplicados de menor precedencia permanecen solo en `result.all` y se marcan con `_shadowed = true`

Esto aplica entre proveedores y también dentro de un proveedor si retorna nombres duplicados.

### Comportamiento de escaneo de archivos

Los proveedores mayormente usan `loadFilesFromDir(...)`, que actualmente:

- usa por defecto coincidencia no recursiva (`*.md`)
- usa glob nativo con `gitignore: true`, `hidden: false`
- lee cada archivo coincidente y lo transforma en un `SlashCommand`

Por lo tanto, los archivos/directorios ocultos no se cargan y las rutas ignoradas se omiten.

## 2) Rutas fuente específicas por proveedor y precedencia local

## Proveedor `native` (`builtin.ts`)

Las raíces de búsqueda provienen de los directorios `.xcsh`:

- proyecto: `<cwd>/.xcsh/commands/*.md`
- usuario: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` retorna proyecto primero, luego usuario, por lo que **los comandos nativos de proyecto prevalecen sobre los comandos nativos de usuario** cuando los nombres colisionan.

## Proveedor `claude` (`claude.ts`)

Carga:

- usuario: `~/.claude/commands/*.md`
- proyecto: `<cwd>/.claude/commands/*.md`

El proveedor añade los elementos de usuario antes que los de proyecto, por lo que **los comandos Claude de usuario prevalecen sobre los comandos Claude de proyecto** en colisiones de mismo nombre dentro de este proveedor.

## Proveedor `codex` (`codex.ts`)

Carga:

- usuario: `~/.codex/commands/*.md`
- proyecto: `<cwd>/.codex/commands/*.md`

Ambos lados se cargan y luego se aplanan en orden usuario-primero, por lo que **los comandos Codex de usuario prevalecen sobre los comandos Codex de proyecto** en colisiones.

El contenido de los comandos Codex se analiza con eliminación de frontmatter (`parseFrontmatter`), y el nombre del comando puede ser sobreescrito por el frontmatter `name`; de lo contrario se usa el nombre del archivo.

## Proveedor `claude-plugins` (`claude-plugins.ts`)

Carga las raíces de comandos de plugins desde `~/.claude/plugins/installed_plugins.json`, luego escanea `<pluginRoot>/commands/*.md`.

El orden sigue el orden de iteración del registro y el orden de entrada por plugin de esos datos JSON. No hay un paso de ordenamiento adicional.

## 3) Materialización a `FileSlashCommand` en tiempo de ejecución

`loadSlashCommands()` en `src/extensibility/slash-commands.ts` convierte los elementos de capacidad en objetos `FileSlashCommand` usados en tiempo de prompt.

Para cada comando:

1. analiza frontmatter/cuerpo (`parseFrontmatter`)
2. fuente de la descripción:
   - `frontmatter.description` si está presente
   - de lo contrario, primera línea no vacía del cuerpo (recortada, máximo 60 caracteres con `...`)
3. mantiene el cuerpo analizado como contenido de plantilla ejecutable
4. calcula una cadena de fuente para visualización como `via Claude Code Project`

La severidad del análisis de frontmatter depende de la fuente:

- nivel `native` -> los errores de análisis son `fatal`
- niveles `user`/`project` -> los errores de análisis son `warn` con análisis de respaldo

### Comandos de respaldo incluidos

Después de los comandos de filesystem/proveedor, se añaden plantillas de comandos embebidos (`EMBEDDED_COMMAND_TEMPLATES`) si sus nombres no están ya presentes.

El conjunto embebido actual proviene de `src/task/commands.ts` y se usa como respaldo (`source: "bundled"`).

## 4) Modo interactivo: de dónde provienen las listas de comandos

El modo interactivo combina múltiples fuentes de comandos para autocompletado y enrutamiento de comandos.

En el momento de construcción construye una lista pendiente de comandos a partir de:

- comandos integrados (`BUILTIN_SLASH_COMMANDS`, incluye completado de argumentos y sugerencias en línea para comandos seleccionados)
- comandos de barra registrados por extensiones (`extensionRunner.getRegisteredCommands(...)`)
- comandos personalizados en TypeScript (`session.customCommands`), mapeados a etiquetas de comandos de barra
- comandos de habilidades opcionales (`/skill:<name>`) cuando `skills.enableSkillCommands` está habilitado

Luego `init()` llama a `refreshSlashCommandState(...)` para cargar comandos basados en archivos e instala un `CombinedAutocompleteProvider` que contiene:

- los comandos pendientes anteriores
- los comandos basados en archivos descubiertos

`refreshSlashCommandState(...)` también actualiza `session.setSlashCommands(...)` para que la expansión de prompts use el mismo conjunto de comandos de archivo descubiertos.

### Ciclo de vida de actualización

El estado de los comandos de barra se actualiza:

- durante la inicialización interactiva
- después de que `/move` cambia el directorio de trabajo (`handleMoveCommand` llama a `resetCapabilities()` y luego a `refreshSlashCommandState(newCwd)`)

No hay un observador continuo de archivos para los directorios de comandos.

### Otra exposición

El panel de Extensiones también carga la capacidad `slash-commands` y muestra las entradas de comandos activos/sombreados, incluyendo los duplicados `_shadowed`.

## 5) Ubicación en el pipeline de prompts

Orden de manejo de barras en `AgentSession.prompt(...)` (cuando `expandPromptTemplates !== false`):

1. **Comandos de extensión** (`#tryExecuteExtensionCommand`)  
   Si `/name` coincide con un comando registrado por extensión, el manejador se ejecuta inmediatamente y el prompt retorna.
2. **Comandos personalizados en TypeScript** (`#tryExecuteCustomCommand`)  
   Solo en el límite: si coincide, se ejecuta y puede retornar:
   - `string` -> reemplaza el texto del prompt con esa cadena
   - `void/undefined` -> se trata como manejado; sin prompt al LLM
3. **Comandos de barra basados en archivos** (`expandSlashCommand`)  
   Si el texto aún comienza con `/`, se intenta la expansión de comando markdown.
4. **Plantillas de prompt** (`expandPromptTemplate`)  
   Se aplican después del procesamiento de barra/personalizado.
5. **Entrega**
   - inactivo: el prompt se envía inmediatamente al agente
   - en streaming: el prompt se encola como steer/seguimiento dependiendo de `streamingBehavior`

Por esto la expansión de comandos de barra se sitúa antes de la expansión de plantillas de prompt, y por esto los comandos personalizados pueden transformar y eliminar la barra inicial antes de la coincidencia con comandos de archivo.

## 6) Semántica de expansión para comandos de barra basados en archivos

Comportamiento de `expandSlashCommand(text, fileCommands)`:

- solo se ejecuta cuando el texto comienza con `/`
- analiza el nombre del comando del primer token después de `/`
- analiza los argumentos del texto restante mediante `parseCommandArgs`
- busca coincidencia exacta de nombre en los `fileCommands` cargados
- si coincide, aplica:
  - reemplazo posicional: `$1`, `$2`, ...
  - reemplazo agregado: `$ARGUMENTS` y `$@`
  - luego renderizado de plantilla mediante `prompt.render` con `{ args, ARGUMENTS, arguments }`
- si no coincide, retorna el texto original sin cambios

### Advertencias sobre `parseCommandArgs`

El analizador es una división simple con reconocimiento de comillas:

- soporta comillas `'simples'` y `"dobles"` para mantener espacios
- elimina los delimitadores de comillas
- no implementa reglas de escape con barra invertida
- una comilla sin cerrar no es un error; el analizador consume hasta el final

## 7) Comportamiento con `/...` desconocido

La entrada de barra desconocida **no es rechazada** por la lógica central de barras.

Si el comando no es manejado por las capas de extensión/personalizado/archivo, `expandSlashCommand` retorna el texto original, y el prompt literal `/...` procede a través de la expansión normal de plantillas de prompt y entrega al LLM.

El modo interactivo por separado maneja directamente muchos comandos integrados en `InputController` (por ejemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Estos se consumen antes de `session.prompt(...)` y por lo tanto nunca llegan a la expansión de comandos de archivo en esa ruta.

## 8) Diferencias en tiempo de streaming vs inactivo

## Ruta inactiva

- `session.prompt("/x ...")` ejecuta el pipeline de comandos y o bien ejecuta el comando inmediatamente o envía el texto expandido directamente.

## Ruta de streaming (`session.isStreaming === true`)

- `prompt(...)` aún ejecuta primero las transformaciones de extensión/personalizado/archivo/plantilla
- luego requiere `streamingBehavior`:
  - `"steer"` -> encola mensaje de interrupción (`agent.steer`)
  - `"followUp"` -> encola mensaje post-turno (`agent.followUp`)
- si `streamingBehavior` se omite, prompt lanza un error

### Comportamiento importante de streaming específico por comando

- Los comandos de extensión se ejecutan inmediatamente incluso durante streaming (no se encolan como texto).
- Los métodos auxiliares `steer(...)`/`followUp(...)` rechazan comandos de extensión (`#throwIfExtensionCommand`) para evitar encolar texto de comando para manejadores que deben ejecutarse sincrónicamente.
- La reproducción de la cola de compactación usa `isKnownSlashCommand(...)` para decidir si las entradas encoladas deben reproducirse mediante `session.prompt(...)` (para comandos de barra conocidos) vs métodos raw de steer/seguimiento.

## 9) Manejo de errores y superficies de fallo

- Las fallas de carga de proveedores están aisladas; el registro recopila advertencias y continúa con otros proveedores.
- Los elementos de comandos de barra inválidos (sin nombre/ruta/contenido o nivel inválido) son descartados por la validación de capacidades.
- Fallas en el análisis de frontmatter:
  - comandos nativos: el error de análisis fatal se propaga
  - comandos no nativos: advertencia + análisis de respaldo clave/valor
- Las excepciones de manejadores de comandos de extensión/personalizados se capturan y reportan mediante el canal de errores de extensión (o logger de respaldo para comandos personalizados sin extension runner), y se tratan como manejados (sin ejecución de respaldo no intencionada).
