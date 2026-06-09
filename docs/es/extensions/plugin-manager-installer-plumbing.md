---
title: Arquitectura interna del gestor de plugins e instalador
description: >-
  Detalles internos del gestor de plugins que cubren instalación, validación,
  resolución de dependencias y gestión del ciclo de vida.
sidebar:
  order: 5
  label: Gestor de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Arquitectura interna del gestor de plugins e instalador

Este documento describe cómo las operaciones de `xcsh plugin` modifican el estado de los plugins en disco y cómo los plugins instalados se convierten en capacidades en tiempo de ejecución (herramientas actualmente, resolución de rutas para hooks/comandos disponible).

## Alcance y arquitectura

Existen dos implementaciones de gestión de plugins en el código fuente:

1. **Ruta activa utilizada por los comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar heredado**: funciones del instalador (`src/extensibility/plugins/installer.ts`)

La ejecución del comando `xcsh plugin ...` pasa a través de `PluginManager`.

`installer.ts` aún documenta verificaciones de seguridad importantes y comportamiento del sistema de archivos, pero no es la ruta utilizada por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

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

- `src/commands/plugin.ts` define el comando/flags y redirige a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapea subcomandos a métodos de `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- No existe una acción `update` explícita; la actualización se realiza volviendo a ejecutar `install` con una nueva especificación de paquete/versión.

## Modelo en disco

El estado global de plugins reside en `~/.xcsh/plugins`:

- `package.json` — manifiesto de dependencias utilizado por `bun install`/`bun uninstall`
- `node_modules/` — paquetes de plugins instalados o enlaces simbólicos
- `xcsh-plugins.lock.json` — estado en tiempo de ejecución:
  - habilitado/deshabilitado por plugin
  - conjunto de características seleccionadas por plugin
  - configuraciones persistidas del plugin

Las sobrecargas locales del proyecto residen en:

- `<cwd>/.xcsh/plugin-overrides.json`

Las sobrecargas son de solo lectura desde la perspectiva del gestor/cargador (no hay ruta de escritura aquí) y pueden deshabilitar plugins o sobreescribir características/configuraciones para este proyecto.

## Análisis de especificaciones e interpretación de metadatos del plugin

## Gramática de especificación de instalación

`parsePluginSpec` (`parser.ts`) soporta:

- `pkg` -> `features: null` (comportamiento por defecto)
- `pkg[*]` -> habilitar todas las características del manifiesto
- `pkg[]` -> no habilitar características opcionales
- `pkg[a,b]` -> habilitar características por nombre
- `@scope/pkg@1.2.3[feat]` -> paquete con scope + versión con selección explícita de características

`extractPackageName` elimina el sufijo de versión para la búsqueda de ruta en disco después de la instalación.

## Origen del manifiesto y campos requeridos

El manifiesto se resuelve como:

1. `package.json.xcsh`
2. alternativa `package.json.pi`
3. alternativa `{ version: package.version }`

Implicaciones:

- No existe una validación estricta de esquema en el gestor/cargador.
- Un paquete sin `xcsh`/`pi` sigue siendo instalable y listable.
- La carga de plugins en tiempo de ejecución (`getEnabledPlugins`) omite paquetes sin manifiesto `xcsh`/`pi`.
- `manifest.version` siempre se sobrescribe desde la `version` del paquete.

Un JSON malformado en `package.json` es un fallo severo en tiempo de lectura; una forma de manifiesto malformada puede fallar después, solo cuando se consumen campos específicos.

## Flujo de instalación/actualización (`PluginManager.install`)

1. Analizar la sintaxis de corchetes de características de la especificación de instalación.
2. Validar el nombre del paquete contra regex + lista de denegación de metacaracteres de shell.
3. Asegurar que el `package.json` del plugin existe (`xcsh-plugins`, mapa de dependencias privadas).
4. Ejecutar `bun install <packageSpec>` en `~/.xcsh/plugins`.
5. Leer el `node_modules/<name>/package.json` del paquete instalado.
6. Resolver el manifiesto y calcular `enabledFeatures`:
   - `[*]`: todas las características declaradas (o `null` si no hay mapa de características)
   - `[a,b]`: valida que cada característica exista en el mapa de características del manifiesto
   - `[]`: lista de características vacía
   - especificación simple: `null` (usar política de valores por defecto posteriormente en el cargador)
7. Insertar/actualizar el estado en tiempo de ejecución del lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semántica de actualización

Dado que la actualización está dirigida por la instalación:

- `xcsh plugin install pkg@newVersion` actualiza la dependencia y la versión del lockfile.
- Las configuraciones existentes se preservan; la entrada de estado se sobrescribe para versión/características/habilitado.
- No existe lógica separada de "verificar actualizaciones" ni migración transaccional.

## Flujo de eliminación (`PluginManager.uninstall`)

1. Validar el nombre del paquete.
2. Ejecutar `bun uninstall <name>` en el directorio de plugins.
3. Eliminar el estado en tiempo de ejecución del plugin del lockfile:
   - `config.plugins[name]`
   - `config.settings[name]`

Si el comando de desinstalación falla, el estado en tiempo de ejecución no se modifica.

## Flujo de listado (`PluginManager.list`)

1. Leer el mapa de dependencias del plugin desde `~/.xcsh/plugins/package.json`.
2. Cargar la configuración en tiempo de ejecución del lockfile (archivo ausente -> valores por defecto vacíos).
3. Cargar sobrecargas del proyecto (`<cwd>/.xcsh/plugin-overrides.json`, errores de lectura/análisis -> objeto vacío con advertencia).
4. Para cada dependencia con un package.json resoluble:
   - construir registro `InstalledPlugin`
   - fusionar estado de características/habilitación:
     - base desde el lockfile (o valores por defecto)
     - las sobrecargas del proyecto pueden reemplazar la selección de características
     - la lista `disabled` del proyecto enmascara el plugin como deshabilitado

Este es el estado efectivo utilizado por la salida de estado del CLI y las operaciones de configuración/características.

## Flujo de enlace (`PluginManager.link`)

`link` soporta el desarrollo local de plugins creando un enlace simbólico de un paquete local en `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamiento:

1. Resolver `localPath` contra el cwd del gestor.
2. Requerir `package.json` local y campo `name`.
3. Asegurar que los directorios de plugins existan.
4. Para nombres con scope, crear el directorio de scope.
5. Eliminar la ruta existente en la ubicación de destino del enlace.
6. Crear enlace simbólico.
7. Agregar entrada en el lockfile de tiempo de ejecución habilitada con características por defecto (`null`).

Advertencia: actualmente `PluginManager.link` no aplica la verificación de límite de ruta `cwd` presente en el `installer.ts` heredado (`normalizedPath.startsWith(normalizedCwd)`), por lo que la confianza es responsabilidad del invocador.

## Carga en tiempo de ejecución: del plugin instalado a capacidades invocables

## Puerta de descubrimiento

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lee:

- manifiesto de dependencias del plugin (`package.json`)
- estado en tiempo de ejecución del lockfile
- sobrecargas del proyecto vía `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtrado:

- omitir si no hay package.json del plugin
- omitir si el manifiesto (`xcsh`/`pi`) está ausente
- omitir si está globalmente deshabilitado en el lockfile
- omitir si está deshabilitado por el proyecto

## Resolución de rutas de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolutor incluye entradas base más entradas de características:

- lista de características explícita -> solo características seleccionadas
- `enabledFeatures === null` -> habilitar características marcadas como `default: true`

Los archivos ausentes se omiten silenciosamente (protección `existsSync`).

## Diferencias actuales en el cableado en tiempo de ejecución

- **Las herramientas están cableadas al tiempo de ejecución actualmente** vía `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que llama a `getAllPluginToolPaths(cwd)`.
- Las rutas se deduplicar por ruta absoluta resuelta en el descubrimiento de herramientas personalizadas (conjunto `seen`, la primera ruta gana).
- **Los resolutores de hooks/comandos existen** y están exportados, pero esta ruta de código actualmente no los conecta a un registro en tiempo de ejecución de la misma forma en que las herramientas están conectadas.

## Detalles de gestión de bloqueo/estado

`PluginManager` almacena en caché la configuración en tiempo de ejecución en memoria por instancia (`#runtimeConfig`) y la carga perezosamente una vez.

Comportamiento de carga:

- lockfile ausente -> `{ plugins: {}, settings: {} }`
- fallo de lectura/análisis del lockfile -> advertencia + mismos valores por defecto vacíos

Comportamiento de guardado:

- escribe el JSON completo del lockfile con formato legible en cada mutación

No existe bloqueo entre procesos ni estrategia de fusión; escritores concurrentes pueden sobrescribirse mutuamente.

## Verificaciones de seguridad y límites de confianza

## Validación de entrada/paquete

La ruta activa del gestor aplica validación del nombre de paquete:

- regex para especificaciones de paquetes con y sin scope (opcionalmente con versión)
- lista de denegación explícita de metacaracteres de shell (`[;&|`$(){}[]<>\\]`)

Esto limita el riesgo de inyección de comandos al invocar `bun install/uninstall`.

## Límite de confianza del sistema de archivos

- El código del plugin se ejecuta en proceso cuando se importan módulos de herramientas personalizadas; no hay sandboxing.
- Las rutas relativas del manifiesto se unen contra el directorio del paquete del plugin y solo se verifica su existencia.
- El paquete del plugin en sí es código de confianza una vez instalado.

## Verificaciones exclusivas del instalador heredado

`installer.ts` incluye verificaciones adicionales en tiempo de enlace no replicadas en `PluginManager.link`:

- la ruta local debe resolverse dentro del cwd del proyecto
- protecciones adicionales contra traversal de nombre/ruta del paquete para el nombre del destino del enlace simbólico

Dado que el CLI utiliza `PluginManager`, estas protecciones más estrictas de enlace no están actualmente en la ruta principal.

## Comportamiento de fallos, éxito parcial y reversión

El gestor de plugins no es transaccional.

| Etapa de operación | Comportamiento ante fallo | Reversión |
| --- | --- | --- |
| `bun install` falla | la instalación aborta con stderr | N/A (aún no hay escrituras de estado) |
| Instalación exitosa, luego falla la validación de manifiesto/características | el comando falla | Sin reversión de desinstalación; la dependencia puede permanecer en `node_modules`/`package.json` |
| Instalación exitosa, luego falla la escritura del lockfile | el comando falla | Sin reversión del paquete instalado |
| `bun uninstall` exitoso, falla la escritura del lockfile | el comando falla | Paquete eliminado, puede quedar estado en tiempo de ejecución obsoleto |
| `link` elimina el destino anterior, luego falla la creación del enlace simbólico | el comando falla | Sin restauración del enlace/directorio anterior |

Operativamente, `doctor --fix` puede reparar cierta deriva (`bun install`, limpieza de configuración huérfana, limpieza de características inválidas), pero es de mejor esfuerzo.

## Resumen del comportamiento ante manifiesto malformado/ausente

- Campo `xcsh`/`pi` ausente:
  - instalación/listado: tolerado (manifiesto mínimo)
  - descubrimiento de plugins habilitados en tiempo de ejecución: omitido como no-plugin
- Característica ausente referenciada por especificación de instalación o `features --set/--enable`: error severo con lista de características disponibles
- `plugin-overrides.json` inválido: ignorado con alternativa a `{}` tanto en las rutas del gestor como del cargador
- Rutas de archivos de herramienta/hook/comando ausentes referenciadas por el manifiesto: ignoradas silenciosamente durante la expansión del resolutor; señaladas como errores solo por `doctor`

## Diferencias de modo y precedencia

- `--dry-run` (instalación): devuelve resultado de instalación sintético, sin escrituras al sistema de archivos/red/estado.
- `--json`: solo formato de salida, sin cambio de comportamiento.
- Las sobrecargas del proyecto siempre tienen precedencia sobre el lockfile global para la vista de características/configuraciones.
- La habilitación efectiva es `runtimeEnabled && !projectDisabled`.

## Archivos de implementación

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaración del comando CLI y mapeo de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de acciones, manejadores de comandos orientados al usuario
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementación activa de instalación/eliminación/listado/enlace/estado/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — auxiliares heredados del instalador y verificaciones adicionales de seguridad de enlace
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descubrimiento de plugins habilitados y resolución de rutas de herramientas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — auxiliares de análisis de especificaciones de instalación y nombres de paquetes
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos para manifiesto/tiempo de ejecución/sobrecargas
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cableado en tiempo de ejecución para módulos de herramientas proporcionados por plugins
