---
title: Funcionamiento interno de los comandos slash
description: >-
  Funcionamiento interno del sistema de comandos slash con registro, análisis de
  argumentos y despacho de ejecución.
sidebar:
  order: 5
  label: Comandos slash
i18n:
  sourceHash: 2cbd44a3de87
  translator: machine
---

# Funcionamiento interno de los comandos slash

Este documento describe cómo se descubren, deduplicán, muestran en modo interactivo y expanden en el momento de la solicitud los comandos slash en `coding-agent`.

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

Los comandos slash son una capacidad (`id: "slash-commands"`) indexada por nombre de comando (`key: cmd => cmd.name`).

El registro de capacidades carga todos los proveedores registrados, ordenados por prioridad de proveedor de mayor a menor, y deduplica por clave con semántica de **el primero gana**.

### Precedencia de proveedores

Proveedores de comandos slash actuales y sus prioridades:

1. `native` (OMP) — prioridad `100`
2. `claude` — prioridad `80`
3. `claude-plugins` — prioridad `70`
4. `codex` — prioridad `70`

Comportamiento en empate: los proveedores con la misma prioridad mantienen el orden de registro. El orden de importación actual registra `claude-plugins` antes que `codex`, por lo que los comandos de plugins tienen precedencia sobre los comandos de codex en colisiones de nombres.

### Comportamiento ante colisiones de nombres

Para `slash-commands`, las colisiones se resuelven estrictamente mediante la deduplicación de capacidades:

- el elemento de mayor precedencia se mantiene en `result.items`
- los duplicados de menor precedencia permanecen únicamente en `result.all` y se marcan con `_shadowed = true`

Esto se aplica entre proveedores y también dentro de un proveedor si devuelve nombres duplicados.

### Comportamiento de escaneo de archivos

Los proveedores utilizan principalmente `loadFilesFromDir(...)`, que actualmente:

- utiliza coincidencia no recursiva por defecto (`*.md`)
- emplea glob nativo con `gitignore: true`, `hidden: false`
- lee cada archivo coincidente y lo transforma en un `SlashCommand`

Por lo tanto, los archivos y directorios ocultos no se cargan, y las rutas ignoradas se omiten.

## 2) Rutas de origen específicas por proveedor y precedencia local

## Proveedor `native` (`builtin.ts`)

Las raíces de búsqueda provienen de los directorios `.xcsh`:

- proyecto: `<cwd>/.xcsh/commands/*.md`
- usuario: `~/.xcsh/agent/commands/*.md`

`getConfigDirs()` devuelve primero el proyecto y luego el usuario, por lo que **los comandos nativos del proyecto tienen precedencia sobre los comandos nativos del usuario** cuando hay colisiones de nombres.

## Proveedor `claude` (`claude.ts`)

Carga:

- usuario: `~/.claude/commands/*.md`
- proyecto: `<cwd>/.claude/commands/*.md`

El proveedor inserta los elementos del usuario antes que los del proyecto, por lo que **los comandos Claude del usuario tienen precedencia sobre los comandos Claude del proyecto** en colisiones de mismo nombre dentro de este proveedor.

## Proveedor `codex` (`codex.ts`)

Carga:

- usuario: `~/.codex/commands/*.md`
- proyecto: `<cwd>/.codex/commands/*.md`

Ambos lados se cargan y luego se aplanan en orden de usuario primero, por lo que **los comandos Codex del usuario tienen precedencia sobre los comandos Codex del proyecto** en colisiones.

El contenido de los comandos Codex se analiza eliminando el frontmatter (`parseFrontmatter`), y el nombre del comando puede ser sobrescrito por el campo `name` del frontmatter; en caso contrario, se utiliza el nombre del archivo.

## Proveedor `claude-plugins` (`claude-plugins.ts`)

Carga las raíces de comandos de plugins desde `~/.claude/plugins/installed_plugins.json`, y luego escanea `<pluginRoot>/commands/*.md`.

El orden sigue el orden de iteración del registro y el orden de entradas por plugin del JSON mencionado. No existe un paso de ordenación adicional.

## 3) Materialización al `FileSlashCommand` en tiempo de ejecución

`loadSlashCommands()` en `src/extensibility/slash-commands.ts` convierte los elementos de capacidad en objetos `FileSlashCommand` utilizados en el momento de la solicitud.

Para cada comando:

1. se analiza el frontmatter y el cuerpo (`parseFrontmatter`)
2. fuente de la descripción:
   - `frontmatter.description` si está presente
   - en caso contrario, la primera línea no vacía del cuerpo (recortada, máximo 60 caracteres con `...`)
3. se conserva el cuerpo analizado como contenido de plantilla ejecutable
4. se calcula una cadena de origen para visualización del tipo `via Claude Code Project`

La severidad del análisis del frontmatter depende del origen:

- nivel `native` -> los errores de análisis son `fatal`
- niveles `user`/`project` -> los errores de análisis son `warn` con análisis de respaldo

### Comandos de respaldo integrados

Tras los comandos del sistema de archivos/proveedores, se añaden las plantillas de comandos integradas (`EMBEDDED_COMMAND_TEMPLATES`) si sus nombres no están ya presentes.

El conjunto integrado actual proviene de `src/task/commands.ts` y se utiliza como respaldo (`source: "bundled"`).

## 4) Modo interactivo: origen de las listas de comandos

El modo interactivo combina múltiples fuentes de comandos para el autocompletado y el enrutamiento de comandos.

En el momento de construcción, genera una lista de comandos pendientes a partir de:

- comandos integrados (`BUILTIN_SLASH_COMMANDS`, incluye completado de argumentos e indicaciones en línea para comandos seleccionados)
- comandos slash registrados por extensiones (`extensionRunner.getRegisteredCommands(...)`)
- comandos personalizados TypeScript (`session.customCommands`), mapeados a etiquetas de comandos slash
- comandos de habilidades opcionales (`/skill:<name>`) cuando `skills.enableSkillCommands` está habilitado

Luego, `init()` llama a `refreshSlashCommandState(...)` para cargar los comandos basados en archivos e instalar un `CombinedAutocompleteProvider` que contiene:

- los comandos pendientes mencionados anteriormente
- los comandos basados en archivos descubiertos

`refreshSlashCommandState(...)` también actualiza `session.setSlashCommands(...)` para que la expansión de solicitudes utilice el mismo conjunto de comandos de archivo descubiertos.

### Ciclo de vida de actualización

El estado de los comandos slash se actualiza:

- durante la inicialización interactiva
- después de que `/move` cambia el directorio de trabajo (`handleMoveCommand` llama a `resetCapabilities()` y luego a `refreshSlashCommandState(newCwd)`)

No existe un observador de archivos continuo para los directorios de comandos.

### Otras superficies de visualización

El panel de Extensiones también carga la capacidad `slash-commands` y muestra las entradas de comandos activos y ocultos, incluyendo los duplicados `_shadowed`.

## 5) Ubicación en el flujo de procesamiento de solicitudes

Orden de manejo slash en `AgentSession.prompt(...)` (cuando `expandPromptTemplates !== false`):

1. **Comandos de extensión** (`#tryExecuteExtensionCommand`)  
   Si `/name` coincide con un comando registrado por una extensión, el manejador se ejecuta inmediatamente y la solicitud retorna.
2. **Comandos personalizados TypeScript** (`#tryExecuteCustomCommand`)  
   Solo como límite: si hay coincidencia, se ejecuta y puede retornar:
   - `string` -> reemplaza el texto de la solicitud con esa cadena
   - `void/undefined` -> tratado como manejado; sin solicitud al LLM
3. **Comandos slash basados en archivos** (`expandSlashCommand`)  
   Si el texto aún comienza con `/`, se intenta la expansión del comando markdown.
4. **Plantillas de solicitud** (`expandPromptTemplate`)  
   Aplicadas después del procesamiento de slash/personalizados.
5. **Entrega**
   - inactivo: la solicitud se envía inmediatamente al agente
   - en transmisión: la solicitud se encola como steering/follow-up según `streamingBehavior`

Por eso la expansión de comandos slash se ubica antes de la expansión de plantillas de solicitud, y por eso los comandos personalizados pueden transformar y eliminar el slash inicial antes de la coincidencia con comandos de archivo.

## 6) Semántica de expansión para comandos slash basados en archivos

Comportamiento de `expandSlashCommand(text, fileCommands)`:

- solo se ejecuta cuando el texto comienza con `/`
- analiza el nombre del comando del primer token después de `/`
- analiza los argumentos del texto restante mediante `parseCommandArgs`
- busca una coincidencia exacta de nombre en los `fileCommands` cargados
- si hay coincidencia, aplica:
  - reemplazo posicional: `$1`, `$2`, ...
  - reemplazo agregado: `$ARGUMENTS` y `$@`
  - luego renderizado de plantilla mediante `prompt.render` con `{ args, ARGUMENTS, arguments }`
- si no hay coincidencia, devuelve el texto original sin cambios

### Consideraciones sobre `parseCommandArgs`

El analizador es una división simple con reconocimiento de comillas:

- admite comillas `'simples'` y `"dobles"` para mantener los espacios
- elimina los delimitadores de comillas
- no implementa reglas de escape con barra invertida
- una comilla sin cerrar no es un error; el analizador consume hasta el final

## 7) Comportamiento ante entradas `/...` desconocidas

Las entradas slash desconocidas **no son rechazadas** por la lógica central de comandos slash.

Si el comando no es manejado por las capas de extensión/personalizado/archivo, `expandSlashCommand` devuelve el texto original, y la solicitud literal `/...` continúa a través de la expansión normal de plantillas de solicitud y la entrega al LLM.

El modo interactivo maneja de forma especial muchos comandos integrados en `InputController` (por ejemplo `/settings`, `/model`, `/mcp`, `/move`, `/exit`). Estos se consumen antes de `session.prompt(...)` y, por tanto, nunca alcanzan la expansión de comandos de archivo en esa ruta.

## 8) Diferencias en tiempo de transmisión frente al modo inactivo

## Ruta inactiva

- `session.prompt("/x ...")` ejecuta el flujo de comandos y bien ejecuta el comando inmediatamente o envía directamente el texto expandido.

## Ruta de transmisión (`session.isStreaming === true`)

- `prompt(...)` igualmente ejecuta primero las transformaciones de extensión/personalizado/archivo/plantilla
- luego requiere `streamingBehavior`:
  - `"steer"` -> encola un mensaje de interrupción (`agent.steer`)
  - `"followUp"` -> encola un mensaje posterior al turno (`agent.followUp`)
- si se omite `streamingBehavior`, la solicitud lanza un error

### Comportamiento de transmisión específico por comando

- Los comandos de extensión se ejecutan inmediatamente incluso durante la transmisión (no se encolan como texto).
- Los métodos auxiliares `steer(...)`/`followUp(...)` rechazan los comandos de extensión (`#throwIfExtensionCommand`) para evitar encolar texto de comandos para manejadores que deben ejecutarse de forma síncrona.
- La reproducción de la cola de compactación utiliza `isKnownSlashCommand(...)` para decidir si las entradas en cola deben reproducirse mediante `session.prompt(...)` (para comandos slash conocidos) frente a los métodos raw de steer/follow-up.

## 9) Manejo de errores y superficies de fallo

- Los fallos de carga de proveedores están aislados; el registro recopila advertencias y continúa con los demás proveedores.
- Los elementos de comandos slash inválidos (nombre, ruta o contenido ausentes, o nivel inválido) son descartados por la validación de capacidades.
- Fallos de análisis del frontmatter:
  - comandos nativos: el error fatal de análisis se propaga
  - comandos no nativos: advertencia + análisis de respaldo clave/valor
- Las excepciones de los manejadores de comandos de extensión/personalizados se capturan y se notifican a través del canal de errores de la extensión (o el logger de respaldo para comandos personalizados sin ejecutor de extensiones), y se tratan como manejadas (sin ejecución de respaldo no intencionada).
