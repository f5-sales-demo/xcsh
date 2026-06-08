---
title: Plugin Manager and Installer Plumbing
description: >-
  Internos del gestor de plugins que cubren instalación, validación, resolución
  de dependencias y gestión del ciclo de vida.
sidebar:
  order: 5
  label: Gestor de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Infraestructura del gestor e instalador de plugins

Este documento describe cómo las operaciones de `xcsh plugin` modifican el estado de los plugins en disco y cómo los plugins instalados se convierten en capacidades en tiempo de ejecución (herramientas actualmente, resolución de rutas para hooks/comandos disponible).

## Alcance y arquitectura

Existen dos implementaciones de gestión de plugins en el código base:

1. **Ruta activa utilizada por los comandos CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar heredado**: funciones del instalador (`src/extensibility/plugins/installer.ts`)

La ejecución de comandos `xcsh plugin ...` pasa a través de `PluginManager`.

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

- `src/commands/plugin.ts` define comandos/flags y los reenvía a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapea subcomandos a métodos de `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- No existe una acción explícita de `update`; la actualización se realiza re-ejecutando `install` con una nueva especificación de paquete/versión.

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

Las sobrecargas son de solo lectura desde la perspectiva del gestor/cargador (no hay ruta de escritura aquí) y pueden deshabilitar plugins o sobrescribir características/configuraciones para este proyecto.

## Análisis de especificaciones de plugins e interpretación de metadatos

## Gramática de especificación de instalación

`parsePluginSpec` (`parser.ts`) soporta:

- `pkg` -> `features: null` (comportamiento por defecto)
- `pkg[*]` -> habilitar todas las características del manifiesto
- `pkg[]` -> no habilitar características opcionales
- `pkg[a,b]` -> habilitar características nombradas
- `@scope/pkg@1.2.3[feat]` -> paquete con ámbito + versión con selección explícita de características

`extractPackageName` elimina el sufijo de versión para la búsqueda de ruta en disco después de la instalación.

## Origen del manifiesto y campos requeridos

El manifiesto se resuelve como:

1. `package.json.xcsh`
2. respaldo `package.json.pi`
3. respaldo `{ version: package.version }`

Implicaciones:

- No existe validación estricta de esquema en el gestor/cargador.
- Un paquete sin `xcsh`/`pi` sigue siendo instalable y listable.
- La carga de plugins en tiempo de ejecución (`getEnabledPlugins`) omite paquetes sin manifiesto `xcsh`/`pi`.
- `manifest.version` siempre se sobrescribe desde la `version` del paquete.

Un JSON malformado en `package.json` es un fallo crítico en el momento de lectura; una forma malformada del manifiesto puede fallar después solo cuando se consumen campos específicos.

## Flujo de instalación/actualización (`PluginManager.install`)

1. Analizar la sintaxis de corchetes de características de la especificación de instalación.
2. Validar el nombre del paquete contra regex + lista de denegación de metacaracteres de shell.
3. Asegurar que el `package.json` del plugin existe (`xcsh-plugins`, mapa de dependencias privadas).
4. Ejecutar `bun install <packageSpec>` en `~/.xcsh/plugins`.
5. Leer el `package.json` del paquete instalado en `node_modules/<name>/package.json`.
6. Resolver el manifiesto y calcular `enabledFeatures`:
   - `[*]`: todas las características declaradas (o `null` si no hay mapa de características)
   - `[a,b]`: valida que cada característica existe en el mapa de características del manifiesto
   - `[]`: lista vacía de características
   - especificación simple: `null` (usar política de valores por defecto después en el cargador)
7. Insertar/actualizar estado en tiempo de ejecución del lockfile: `{ version, enabledFeatures, enabled: true }`.

### Semántica de actualización

Dado que la actualización es impulsada por la instalación:

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
2. Cargar la configuración en tiempo de ejecución del lockfile (archivo faltante -> valores por defecto vacíos).
3. Cargar sobrecargas del proyecto (`<cwd>/.xcsh/plugin-overrides.json`, errores de análisis/lectura -> objeto vacío con advertencia).
4. Para cada dependencia con un package.json resoluble:
   - construir registro `InstalledPlugin`
   - fusionar estado de características/habilitación:
     - base desde el lockfile (o valores por defecto)
     - las sobrecargas del proyecto pueden reemplazar la selección de características
     - la lista `disabled` del proyecto enmascara el plugin como deshabilitado

Este es el estado efectivo utilizado por la salida de estado del CLI y las operaciones de configuraciones/características.

## Flujo de enlace (`PluginManager.link`)

`link` soporta el desarrollo local de plugins mediante la creación de un enlace simbólico de un paquete local en `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamiento:

1. Resolver `localPath` contra el cwd del gestor.
2. Requerir `package.json` local y campo `name`.
3. Asegurar que los directorios de plugins existan.
4. Para nombres con ámbito, crear el directorio del ámbito.
5. Eliminar la ruta existente en la ubicación de destino del enlace.
6. Crear enlace simbólico.
7. Agregar entrada en el lockfile en tiempo de ejecución habilitada con características por defecto (`null`).

Advertencia: el `PluginManager.link` actual no aplica la verificación de límite de ruta `cwd` presente en el `installer.ts` heredado (`normalizedPath.startsWith(normalizedCwd)`), por lo que la confianza es responsabilidad del llamador.

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
- omitir si está deshabilitado en el proyecto

## Resolución de rutas de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolutor incluye entradas base más entradas de características:

- lista explícita de características -> solo las características seleccionadas
- `enabledFeatures === null` -> habilitar características marcadas con `default: true`

Los archivos faltantes se omiten silenciosamente (verificación `existsSync`).

## Diferencias actuales en la conexión en tiempo de ejecución

- **Las herramientas están conectadas al tiempo de ejecución actualmente** vía `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que llama a `getAllPluginToolPaths(cwd)`.
- Las rutas se deduplicado por ruta absoluta resuelta en el descubrimiento de herramientas personalizadas (conjunto `seen`, la primera ruta gana).
- **Los resolutores de hooks/comandos existen** y están exportados, pero esta ruta de código actualmente no los conecta a un registro en tiempo de ejecución de la misma manera que las herramientas están conectadas.

## Detalles de gestión de bloqueo/estado

`PluginManager` almacena en caché la configuración en tiempo de ejecución en memoria por instancia (`#runtimeConfig`) y la carga perezosamente una vez.

Comportamiento de carga:

- lockfile faltante -> `{ plugins: {}, settings: {} }`
- fallo de lectura/análisis del lockfile -> advertencia + mismos valores por defecto vacíos

Comportamiento de guardado:

- escribe el JSON completo del lockfile con formato legible en cada mutación

No existe bloqueo entre procesos ni estrategia de fusión; los escritores concurrentes pueden sobrescribirse mutuamente.

## Verificaciones de seguridad y límites de confianza

## Validación de entrada/paquete

La ruta activa del gestor aplica validación del nombre del paquete:

- regex para especificaciones de paquetes con y sin ámbito (opcionalmente con versión)
- lista de denegación explícita de metacaracteres de shell (`[;&|`$(){}[]<>\\]`)

Esto limita el riesgo de inyección de comandos al invocar `bun install/uninstall`.

## Límite de confianza del sistema de archivos

- El código del plugin se ejecuta en el mismo proceso cuando se importan los módulos de herramientas personalizadas; no hay sandboxing.
- Las rutas relativas del manifiesto se unen contra el directorio del paquete del plugin y solo se verifica su existencia.
- El paquete del plugin en sí mismo es código de confianza una vez instalado.

## Verificaciones exclusivas del instalador heredado

`installer.ts` incluye verificaciones adicionales en tiempo de enlace no reflejadas en `PluginManager.link`:

- la ruta local debe resolverse dentro del cwd del proyecto
- verificaciones adicionales de nombre de paquete/traversal de ruta para el nombre del destino del enlace simbólico

Dado que el CLI utiliza `PluginManager`, estas verificaciones de enlace más estrictas no están actualmente en la ruta principal.

## Comportamiento de fallos, éxito parcial y reversión

El gestor de plugins no es transaccional.

| Etapa de operación | Comportamiento de fallo | Reversión |
| --- | --- | --- |
| `bun install` falla | la instalación se aborta con stderr | N/A (no hay escrituras de estado aún) |
| La instalación tiene éxito, luego falla la validación de manifiesto/características | el comando falla | No hay reversión de desinstalación; la dependencia puede permanecer en `node_modules`/`package.json` |
| La instalación tiene éxito, luego falla la escritura del lockfile | el comando falla | No hay reversión del paquete instalado |
| `bun uninstall` tiene éxito, falla la escritura del lockfile | el comando falla | Paquete eliminado, estado en tiempo de ejecución obsoleto puede permanecer |
| `link` elimina el destino anterior y luego falla la creación del enlace simbólico | el comando falla | No hay restauración del enlace/directorio anterior |

Operativamente, `doctor --fix` puede reparar cierta desviación (ejecución de `bun install`, limpieza de configuración huérfana, limpieza de características inválidas), pero es de mejor esfuerzo.

## Resumen del comportamiento con manifiesto malformado/ausente

- Campo `xcsh`/`pi` ausente:
  - install/list: tolerado (manifiesto mínimo)
  - descubrimiento de plugins habilitados en tiempo de ejecución: omitido como no-plugin
- Característica faltante referenciada por la especificación de instalación o `features --set/--enable`: error crítico con lista de características disponibles
- `plugin-overrides.json` inválido: ignorado con respaldo a `{}` tanto en las rutas del gestor como del cargador
- Rutas de archivos de herramientas/hooks/comandos faltantes referenciadas por el manifiesto: ignoradas silenciosamente durante la expansión del resolutor; señaladas como errores solo por `doctor`

## Diferencias de modo y precedencia

- `--dry-run` (install): devuelve resultado de instalación sintético, sin escrituras en sistema de archivos/red/estado.
- `--json`: solo formato de salida, sin cambio de comportamiento.
- Las sobrecargas del proyecto siempre tienen precedencia sobre el lockfile global para la vista de características/configuraciones.
- La habilitación efectiva es `runtimeEnabled && !projectDisabled`.

## Archivos de implementación

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaración de comandos CLI y mapeo de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de acciones, manejadores de comandos orientados al usuario
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementación activa de install/remove/list/link/state/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — funciones auxiliares del instalador heredado y verificaciones adicionales de seguridad de enlace
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descubrimiento de plugins habilitados y resolución de rutas de herramientas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — funciones auxiliares de análisis de especificaciones de instalación y nombres de paquetes
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos de manifiesto/tiempo de ejecución/sobrecargas
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — conexión en tiempo de ejecución para módulos de herramientas proporcionados por plugins
