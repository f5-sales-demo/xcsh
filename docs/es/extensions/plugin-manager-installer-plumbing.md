---
title: Gestión de plugins e instalación interna
description: >-
  Aspectos internos del gestor de plugins que cubren instalación, validación,
  resolución de dependencias y gestión del ciclo de vida.
sidebar:
  order: 5
  label: Gestor de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gestión de plugins e instalación interna

Este documento describe cómo las operaciones `xcsh plugin` modifican el estado de los plugins en disco y cómo los plugins instalados se convierten en capacidades en tiempo de ejecución (herramientas hoy en día, con resolución de rutas para hooks/comandos disponible).

## Alcance y arquitectura

Existen dos implementaciones de gestión de plugins en el código base:

1. **Ruta activa utilizada por los comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar heredado**: funciones del instalador (`src/extensibility/plugins/installer.ts`)

La ejecución del comando `xcsh plugin ...` pasa por `PluginManager`.

`installer.ts` sigue documentando verificaciones de seguridad importantes y comportamiento del sistema de archivos, pero no es la ruta utilizada por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo de vida: desde la invocación CLI hasta la disponibilidad en tiempo de ejecución

```text
xcsh plugin <action> ...
  -> src/commands/plugin.ts
  -> runPluginCommand(...) in src/cli/plugin-cli.ts
  -> PluginManager method (install/list/uninstall/link/...) 
  -> mutate ~/.xcsh/plugins/{package.json,node_modules,xcsh-plugins.lock.json}
  -> runtime discovery: discoverAndLoadCustomTools(...)
  -> getAllPluginToolPaths(cwd)
  -> custom tool loader imports tool modules
```

### Puntos de entrada de comandos

- `src/commands/plugin.ts` define el comando/indicadores y reenvía a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapea los subcomandos a los métodos de `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- No existe una acción `update` explícita; la actualización se realiza volviendo a ejecutar `install` con una nueva especificación de paquete/versión.

## Modelo en disco

El estado global de los plugins reside en `~/.xcsh/plugins`:

- `package.json` — manifiesto de dependencias utilizado por `bun install`/`bun uninstall`
- `node_modules/` — paquetes de plugins instalados o enlaces simbólicos
- `xcsh-plugins.lock.json` — estado en tiempo de ejecución:
  - habilitado/deshabilitado por plugin
  - conjunto de características seleccionadas por plugin
  - configuraciones de plugin persistidas

Las anulaciones locales del proyecto residen en:

- `<cwd>/.xcsh/plugin-overrides.json`

Las anulaciones son de solo lectura desde la perspectiva del gestor/cargador (no existe ruta de escritura aquí) y pueden deshabilitar plugins o anular características/configuraciones para este proyecto.

## Análisis de especificaciones de plugins e interpretación de metadatos

## Gramática de especificaciones de instalación

`parsePluginSpec` (`parser.ts`) admite:

- `pkg` -> `features: null` (comportamiento predeterminado)
- `pkg[*]` -> habilitar todas las características del manifiesto
- `pkg[]` -> no habilitar características opcionales
- `pkg[a,b]` -> habilitar características con nombre
- `@scope/pkg@1.2.3[feat]` -> paquete con ámbito + versión con selección explícita de características

`extractPackageName` elimina el sufijo de versión para la búsqueda de rutas en disco después de la instalación.

## Fuente del manifiesto y campos requeridos

El manifiesto se resuelve como:

1. `package.json.xcsh`
2. alternativa `package.json.pi`
3. alternativa `{ version: package.version }`

Implicaciones:

- No existe validación de esquema estricta en el gestor/cargador.
- Un paquete sin manifiesto `xcsh`/`pi` sigue siendo instalable y listable.
- La carga de plugins en tiempo de ejecución (`getEnabledPlugins`) omite los paquetes sin manifiesto `xcsh`/`pi`.
- `manifest.version` siempre se sobreescribe desde la `version` del paquete.

Un JSON malformado en `package.json` es un error grave en el momento de la lectura; una forma de manifiesto malformada puede fallar más adelante solo cuando se consumen campos específicos.

## Flujo de instalación/actualización (`PluginManager.install`)

1. Analizar la sintaxis de corchetes de características de la especificación de instalación.
2. Validar el nombre del paquete contra la expresión regular + lista de denegación de metacaracteres de shell.
3. Asegurarse de que `package.json` del plugin exista (`xcsh-plugins`, mapa de dependencias privadas).
4. Ejecutar `bun install <packageSpec>` en `~/.xcsh/plugins`.
5. Leer el `node_modules/<name>/package.json` del paquete instalado.
6. Resolver el manifiesto y calcular `enabledFeatures`:
   - `[*]`: todas las características declaradas (o `null` si no hay mapa de características)
   - `[a,b]`: valida que cada característica exista en el mapa de características del manifiesto
   - `[]`: lista de características vacía
   - especificación simple: `null` (usar la política de valores predeterminados más adelante en el cargador)
7. Actualizar el estado en tiempo de ejecución del archivo de bloqueo: `{ version, enabledFeatures, enabled: true }`.

### Semántica de actualización

Dado que la actualización está basada en la instalación:

- `xcsh plugin install pkg@newVersion` actualiza la dependencia y la versión del archivo de bloqueo.
- La configuración existente se preserva; la entrada de estado se sobreescribe para versión/características/habilitado.
- No existe lógica separada de "verificar actualizaciones" ni de migración transaccional.

## Flujo de eliminación (`PluginManager.uninstall`)

1. Validar el nombre del paquete.
2. Ejecutar `bun uninstall <name>` en el directorio de plugins.
3. Eliminar el estado en tiempo de ejecución del plugin del archivo de bloqueo:
   - `config.plugins[name]`
   - `config.settings[name]`

Si el comando de desinstalación falla, el estado en tiempo de ejecución no se modifica.

## Flujo de listado (`PluginManager.list`)

1. Leer el mapa de dependencias de plugins desde `~/.xcsh/plugins/package.json`.
2. Cargar la configuración en tiempo de ejecución del archivo de bloqueo (archivo faltante -> valores predeterminados vacíos).
3. Cargar las anulaciones del proyecto (`<cwd>/.xcsh/plugin-overrides.json`, errores de análisis/lectura -> objeto vacío con advertencia).
4. Para cada dependencia con un `package.json` resoluble:
   - construir el registro `InstalledPlugin`
   - combinar el estado de características/habilitación:
     - base desde el archivo de bloqueo (o valores predeterminados)
     - las anulaciones del proyecto pueden reemplazar la selección de características
     - la lista `disabled` del proyecto enmascara el plugin como deshabilitado

Este es el estado efectivo utilizado por la salida de estado del CLI y las operaciones de configuración/características.

## Flujo de enlace (`PluginManager.link`)

`link` admite el desarrollo local de plugins creando un enlace simbólico de un paquete local en `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamiento:

1. Resolver `localPath` contra el cwd del gestor.
2. Requerir `package.json` local y el campo `name`.
3. Asegurarse de que existan los directorios del plugin.
4. Para nombres con ámbito, crear el directorio de ámbito.
5. Eliminar la ruta existente en la ubicación del enlace de destino.
6. Crear el enlace simbólico.
7. Agregar una entrada al archivo de bloqueo en tiempo de ejecución habilitada con características predeterminadas (`null`).

Advertencia: el `PluginManager.link` actual no aplica la verificación de límite de ruta `cwd` presente en el `installer.ts` heredado (`normalizedPath.startsWith(normalizedCwd)`), por lo que la confianza es responsabilidad del llamador.

## Carga en tiempo de ejecución: del plugin instalado a las capacidades invocables

## Puerta de descubrimiento

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lee:

- manifiesto de dependencias del plugin (`package.json`)
- estado en tiempo de ejecución del archivo de bloqueo
- anulaciones del proyecto mediante `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtrado:

- omitir si no hay `package.json` del plugin
- omitir si el manifiesto (`xcsh`/`pi`) está ausente
- omitir si está deshabilitado globalmente en el archivo de bloqueo
- omitir si está deshabilitado por el proyecto

## Resolución de rutas de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolvedor incluye entradas base más entradas de características:

- lista de características explícita -> solo las características seleccionadas
- `enabledFeatures === null` -> habilitar las características marcadas como `default: true`

Los archivos faltantes se omiten silenciosamente (protección con `existsSync`).

## Diferencias actuales en el cableado en tiempo de ejecución

- **Las herramientas están conectadas al tiempo de ejecución hoy** mediante `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que llama a `getAllPluginToolPaths(cwd)`.
- Las rutas se deduplicarán por ruta absoluta resuelta en el descubrimiento de herramientas personalizadas (conjunto `seen`, la primera ruta gana).
- **Los resolutores de hooks/comandos existen** y se exportan, pero esta ruta de código actualmente no los conecta a un registro en tiempo de ejecución de la misma manera en que se conectan las herramientas.

## Detalles de gestión de bloqueo/estado

`PluginManager` almacena en caché la configuración en tiempo de ejecución en memoria por instancia (`#runtimeConfig`) y la carga de forma diferida una vez.

Comportamiento de carga:

- archivo de bloqueo faltante -> `{ plugins: {}, settings: {} }`
- fallo de lectura/análisis del archivo de bloqueo -> advertencia + mismos valores predeterminados vacíos

Comportamiento de guardado:

- escribe el JSON completo del archivo de bloqueo con formato de sangría en cada mutación

No existe bloqueo entre procesos ni estrategia de fusión; los escritores concurrentes pueden sobreescribirse mutuamente.

## Verificaciones de seguridad y límites de confianza

## Validación de entrada/paquetes

La ruta del gestor activo aplica la validación del nombre del paquete:

- expresión regular para especificaciones de paquetes con o sin ámbito (opcionalmente con versión)
- lista de denegación explícita de metacaracteres de shell (`[;&|`$(){}[]<>\\]`)

Esto limita el riesgo de inyección de comandos al invocar `bun install/uninstall`.

## Límite de confianza del sistema de archivos

- El código del plugin se ejecuta en proceso cuando se importan los módulos de herramientas personalizadas; no existe aislamiento.
- Las rutas relativas del manifiesto se unen al directorio del paquete del plugin y solo se verifica su existencia.
- El paquete del plugin en sí es código de confianza una vez instalado.

## Verificaciones exclusivas del instalador heredado

`installer.ts` incluye verificaciones adicionales en el momento del enlace que no se replican en `PluginManager.link`:

- la ruta local debe resolverse dentro del cwd del proyecto
- protecciones adicionales de nombre de paquete/recorrido de ruta para la denominación del destino del enlace simbólico

Dado que el CLI utiliza `PluginManager`, estas protecciones de enlace más estrictas no están actualmente en la ruta principal.

## Comportamiento ante fallos, éxito parcial y reversión

El gestor de plugins no es transaccional.

| Etapa de la operación | Comportamiento ante fallo | Reversión |
| --- | --- | --- |
| `bun install` falla | la instalación se interrumpe con stderr | N/A (aún no se han escrito estados) |
| La instalación tiene éxito, luego falla la validación del manifiesto/características | el comando falla | Sin reversión de desinstalación; la dependencia puede permanecer en `node_modules`/`package.json` |
| La instalación tiene éxito, luego falla la escritura del archivo de bloqueo | el comando falla | Sin reversión del paquete instalado |
| `bun uninstall` tiene éxito, falla la escritura del archivo de bloqueo | el comando falla | Paquete eliminado, puede quedar estado en tiempo de ejecución obsoleto |
| `link` elimina el destino anterior y luego falla la creación del enlace simbólico | el comando falla | Sin restauración del enlace/directorio anterior |

Operativamente, `doctor --fix` puede reparar algunas desviaciones (`bun install`, limpieza de configuración huérfana, limpieza de características inválidas), pero es de mejor esfuerzo.

## Resumen del comportamiento ante manifiestos malformados o faltantes

- Campo `xcsh`/`pi` faltante:
  - instalación/listado: tolerado (manifiesto mínimo)
  - descubrimiento de plugins habilitados en tiempo de ejecución: omitido como no-plugin
- Característica faltante referenciada por la especificación de instalación o `features --set/--enable`: error grave con la lista de características disponibles
- `plugin-overrides.json` inválido: ignorado con alternativa a `{}` tanto en las rutas del gestor como del cargador
- Rutas de archivos de herramientas/hooks/comandos faltantes referenciadas por el manifiesto: ignoradas silenciosamente durante la expansión del resolvedor; señaladas como errores solo por `doctor`

## Diferencias de modo y precedencia

- `--dry-run` (install): devuelve un resultado de instalación sintético, sin escrituras en el sistema de archivos/red/estado.
- `--json`: solo formato de salida, sin cambio de comportamiento.
- Las anulaciones del proyecto siempre tienen precedencia sobre el archivo de bloqueo global para la vista de características/configuración.
- La habilitación efectiva es `runtimeEnabled && !projectDisabled`.

## Archivos de implementación

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaración del comando CLI y mapeo de indicadores
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de acciones, manejadores de comandos orientados al usuario
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementación activa de instalación/eliminación/listado/enlace/estado/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — ayudantes del instalador heredado y verificaciones adicionales de seguridad de enlace
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descubrimiento de plugins habilitados y resolución de rutas de herramientas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — ayudantes de análisis de especificaciones de instalación y nombres de paquetes
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos de manifiesto/tiempo de ejecución/anulación
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cableado en tiempo de ejecución para módulos de herramientas proporcionados por plugins
