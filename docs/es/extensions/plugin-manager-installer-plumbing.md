---
title: Gestión de plugins e instalación interna
description: >-
  Funcionamiento interno del gestor de plugins, incluyendo instalación,
  validación, resolución de dependencias y gestión del ciclo de vida.
sidebar:
  order: 5
  label: Gestor de plugins
i18n:
  sourceHash: 9c33e5a2c22a
  translator: machine
---

# Gestión de plugins e instalación interna

Este documento describe cómo las operaciones de `xcsh plugin` modifican el estado de los plugins en disco y cómo los plugins instalados se convierten en capacidades en tiempo de ejecución (herramientas actualmente, con resolución de rutas para hooks/comandos disponible).

## Alcance y arquitectura

Existen dos implementaciones de gestión de plugins en el código base:

1. **Ruta activa utilizada por los comandos de CLI**: `PluginManager` (`src/extensibility/plugins/manager.ts`)
2. **Módulo auxiliar heredado**: funciones del instalador (`src/extensibility/plugins/installer.ts`)

La ejecución del comando `xcsh plugin ...` pasa por `PluginManager`.

`installer.ts` todavía documenta comprobaciones de seguridad importantes y el comportamiento del sistema de archivos, pero no es la ruta utilizada por `src/commands/plugin.ts` + `src/cli/plugin-cli.ts`.

## Ciclo de vida: desde la invocación de CLI hasta la disponibilidad en tiempo de ejecución

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

- `src/commands/plugin.ts` define el comando y los flags, y los reenvía a `runPluginCommand`.
- `src/cli/plugin-cli.ts` mapea los subcomandos a los métodos de `PluginManager`:
  - `install`, `uninstall`, `list`, `link`, `doctor`, `features`, `config`, `enable`, `disable`
- No existe una acción explícita de `update`; la actualización se realiza volviendo a ejecutar `install` con una nueva especificación de paquete/versión.

## Modelo en disco

El estado global de los plugins reside en `~/.xcsh/plugins`:

- `package.json` — manifiesto de dependencias utilizado por `bun install`/`bun uninstall`
- `node_modules/` — paquetes de plugins instalados o enlaces simbólicos
- `xcsh-plugins.lock.json` — estado en tiempo de ejecución:
  - habilitado/deshabilitado por plugin
  - conjunto de características seleccionadas por plugin
  - configuraciones de plugins persistidas

Las sobreescrituras locales del proyecto residen en:

- `<cwd>/.xcsh/plugin-overrides.json`

Las sobreescrituras son de solo lectura desde la perspectiva del gestor/cargador (no existe ruta de escritura aquí) y pueden deshabilitar plugins o sobreescribir características/configuraciones para este proyecto.

## Análisis de especificaciones de plugins e interpretación de metadatos

## Gramática de especificaciones de instalación

`parsePluginSpec` (`parser.ts`) admite:

- `pkg` -> `features: null` (comportamiento predeterminado)
- `pkg[*]` -> habilitar todas las características del manifiesto
- `pkg[]` -> no habilitar características opcionales
- `pkg[a,b]` -> habilitar características con nombre
- `@scope/pkg@1.2.3[feat]` -> paquete con ámbito y versión con selección explícita de características

`extractPackageName` elimina el sufijo de versión para la búsqueda de rutas en disco después de la instalación.

## Fuente del manifiesto y campos requeridos

El manifiesto se resuelve de la siguiente manera:

1. `package.json.xcsh`
2. alternativa `package.json.pi`
3. alternativa `{ version: package.version }`

Implicaciones:

- No existe validación estricta de esquema en el gestor/cargador.
- Un paquete sin manifiesto `xcsh`/`pi` sigue siendo instalable y listable.
- La carga de plugins en tiempo de ejecución (`getEnabledPlugins`) omite los paquetes sin manifiesto `xcsh`/`pi`.
- `manifest.version` siempre se sobreescribe desde la `version` del paquete.

Un JSON de `package.json` malformado es un error grave en el momento de lectura; una forma de manifiesto malformada puede fallar más tarde solo cuando se consumen campos específicos.

## Flujo de instalación/actualización (`PluginManager.install`)

1. Analizar la sintaxis de corchetes de características desde la especificación de instalación.
2. Validar el nombre del paquete contra una expresión regular y una lista de denegación de metacaracteres de shell.
3. Asegurarse de que `package.json` del plugin exista (`xcsh-plugins`, mapa de dependencias privadas).
4. Ejecutar `bun install <packageSpec>` en `~/.xcsh/plugins`.
5. Leer `node_modules/<name>/package.json` del paquete instalado.
6. Resolver el manifiesto y calcular `enabledFeatures`:
   - `[*]`: todas las características declaradas (o `null` si no hay mapa de características)
   - `[a,b]`: valida que cada característica exista en el mapa de características del manifiesto
   - `[]`: lista de características vacía
   - especificación sin corchetes: `null` (usar la política de valores predeterminados más tarde en el cargador)
7. Actualizar el estado en tiempo de ejecución del archivo de bloqueo: `{ version, enabledFeatures, enabled: true }`.

### Semántica de actualización

Dado que la actualización se realiza mediante instalación:

- `xcsh plugin install pkg@newVersion` actualiza la dependencia y la versión en el archivo de bloqueo.
- La configuración existente se conserva; la entrada de estado se sobreescribe para versión/características/habilitado.
- No existe lógica de "verificar actualizaciones" ni de migración transaccional.

## Flujo de eliminación (`PluginManager.uninstall`)

1. Validar el nombre del paquete.
2. Ejecutar `bun uninstall <name>` en el directorio de plugins.
3. Eliminar el estado en tiempo de ejecución del plugin del archivo de bloqueo:
   - `config.plugins[name]`
   - `config.settings[name]`

Si el comando de desinstalación falla, el estado en tiempo de ejecución no se modifica.

## Flujo de listado (`PluginManager.list`)

1. Leer el mapa de dependencias de plugins desde `~/.xcsh/plugins/package.json`.
2. Cargar la configuración en tiempo de ejecución del archivo de bloqueo (si el archivo no existe, se usan valores predeterminados vacíos).
3. Cargar sobreescrituras del proyecto (`<cwd>/.xcsh/plugin-overrides.json`; errores de análisis/lectura generan un objeto vacío con advertencia).
4. Para cada dependencia con un `package.json` resoluble:
   - construir un registro `InstalledPlugin`
   - combinar el estado de características/habilitación:
     - base desde el archivo de bloqueo (o valores predeterminados)
     - las sobreescrituras del proyecto pueden reemplazar la selección de características
     - la lista `disabled` del proyecto enmascara el plugin como deshabilitado

Este es el estado efectivo utilizado por la salida de estado de CLI y las operaciones de configuración/características.

## Flujo de enlace (`PluginManager.link`)

`link` admite el desarrollo local de plugins creando un enlace simbólico de un paquete local en `~/.xcsh/plugins/node_modules/<pkg.name>`.

Comportamiento:

1. Resolver `localPath` respecto al cwd del gestor.
2. Requerir `package.json` local y el campo `name`.
3. Asegurarse de que los directorios de plugins existan.
4. Para nombres con ámbito, crear el directorio de ámbito.
5. Eliminar la ruta existente en la ubicación del enlace de destino.
6. Crear el enlace simbólico.
7. Agregar una entrada en el archivo de bloqueo en tiempo de ejecución habilitada con características predeterminadas (`null`).

Advertencia: el `PluginManager.link` actual no aplica la verificación de límite de ruta `cwd` presente en el `installer.ts` heredado (`normalizedPath.startsWith(normalizedCwd)`), por lo que la confianza es responsabilidad del llamador.

## Carga en tiempo de ejecución: desde el plugin instalado hasta las capacidades invocables

## Puerta de descubrimiento

`getEnabledPlugins(cwd)` (`plugins/loader.ts`) lee:

- manifiesto de dependencias de plugins (`package.json`)
- estado en tiempo de ejecución del archivo de bloqueo
- sobreescrituras del proyecto mediante `getConfigDirPaths("plugin-overrides.json", { user: false, cwd })`

Filtrado:

- omitir si no hay `package.json` del plugin
- omitir si el manifiesto (`xcsh`/`pi`) está ausente
- omitir si está deshabilitado globalmente en el archivo de bloqueo
- omitir si está deshabilitado en el proyecto

## Resolución de rutas de capacidades

Para cada plugin habilitado:

- `resolvePluginToolPaths(plugin)`
- `resolvePluginHookPaths(plugin)`
- `resolvePluginCommandPaths(plugin)`

Cada resolvedor incluye entradas base más entradas de características:

- lista de características explícita -> solo las características seleccionadas
- `enabledFeatures === null` -> habilitar las características marcadas como `default: true`

Los archivos faltantes se omiten silenciosamente (guardia `existsSync`).

## Diferencias actuales en el cableado en tiempo de ejecución

- **Las herramientas están cableadas en tiempo de ejecución actualmente** mediante `discoverAndLoadCustomTools` (`custom-tools/loader.ts`), que llama a `getAllPluginToolPaths(cwd)`.
- Las rutas se desduplicanan por ruta absoluta resuelta en el descubrimiento de herramientas personalizadas (conjunto `seen`, gana la primera ruta).
- **Los resolutores de hooks/comandos existen** y están exportados, pero esta ruta de código actualmente no los conecta a un registro en tiempo de ejecución de la misma manera en que se conectan las herramientas.

## Detalles de gestión de bloqueo/estado

`PluginManager` almacena en caché la configuración en tiempo de ejecución en memoria por instancia (`#runtimeConfig`) y la carga de forma diferida una vez.

Comportamiento de carga:

- archivo de bloqueo ausente -> `{ plugins: {}, settings: {} }`
- fallo de lectura/análisis del archivo de bloqueo -> advertencia + mismos valores predeterminados vacíos

Comportamiento de guardado:

- escribe el JSON completo del archivo de bloqueo con formato de impresión en cada mutación

No existe bloqueo entre procesos ni estrategia de combinación; los escritores concurrentes pueden sobreescribirse mutuamente.

## Comprobaciones de seguridad y límites de confianza

## Validación de entrada/paquetes

La ruta del gestor activo aplica la validación del nombre del paquete:

- expresión regular para especificaciones de paquetes con y sin ámbito (opcionalmente con versión)
- lista de denegación explícita de metacaracteres de shell (`[;&|`$(){}[]<>\\]`)

Esto limita el riesgo de inyección de comandos al invocar `bun install/uninstall`.

## Límite de confianza del sistema de archivos

- El código del plugin se ejecuta dentro del proceso cuando se importan los módulos de herramientas personalizadas; no existe aislamiento.
- Las rutas relativas del manifiesto se combinan con el directorio del paquete del plugin y solo se verifica su existencia.
- El paquete del plugin en sí es código de confianza una vez instalado.

## Comprobaciones exclusivas del instalador heredado

`installer.ts` incluye comprobaciones adicionales en el momento del enlace que no están reflejadas en `PluginManager.link`:

- la ruta local debe resolverse dentro del cwd del proyecto
- guardias adicionales de nombre de paquete/recorrido de ruta para la nomenclatura del destino del enlace simbólico

Dado que la CLI utiliza `PluginManager`, estas guardias de enlace más estrictas no están actualmente en la ruta principal.

## Comportamiento ante fallos, éxito parcial y reversión

El gestor de plugins no es transaccional.

| Etapa de operación | Comportamiento ante fallos | Reversión |
| --- | --- | --- |
| `bun install` falla | la instalación se interrumpe con stderr | N/A (aún no se han escrito estados) |
| La instalación tiene éxito, luego falla la validación del manifiesto/características | el comando falla | Sin reversión de desinstalación; la dependencia puede permanecer en `node_modules`/`package.json` |
| La instalación tiene éxito, luego falla la escritura del archivo de bloqueo | el comando falla | Sin reversión del paquete instalado |
| `bun uninstall` tiene éxito, falla la escritura del archivo de bloqueo | el comando falla | El paquete fue eliminado, puede quedar un estado en tiempo de ejecución obsoleto |
| `link` elimina el destino anterior y luego falla la creación del enlace simbólico | el comando falla | Sin restauración del enlace/directorio anterior |

Operacionalmente, `doctor --fix` puede reparar algunas discrepancias (`bun install`, limpieza de configuración huérfana, limpieza de características no válidas), pero es un proceso de mejor esfuerzo.

## Resumen del comportamiento ante manifiestos malformados o ausentes

- Campo `xcsh`/`pi` ausente:
  - instalar/listar: tolerado (manifiesto mínimo)
  - descubrimiento de plugins habilitados en tiempo de ejecución: omitido como no-plugin
- Característica faltante referenciada por la especificación de instalación o `features --set/--enable`: error grave con la lista de características disponibles
- `plugin-overrides.json` no válido: ignorado con reserva a `{}` tanto en las rutas del gestor como del cargador
- Rutas de archivos de herramientas/hooks/comandos referenciadas por el manifiesto que no existen: ignoradas silenciosamente durante la expansión del resolvedor; marcadas como errores solo por `doctor`

## Diferencias de modo y precedencia

- `--dry-run` (instalación): devuelve un resultado de instalación sintético, sin escrituras en el sistema de archivos, la red ni el estado.
- `--json`: solo formato de salida, sin cambios de comportamiento.
- Las sobreescrituras del proyecto siempre tienen precedencia sobre el archivo de bloqueo global para la vista de características/configuración.
- La habilitación efectiva es `runtimeEnabled && !projectDisabled`.

## Archivos de implementación

- [`src/commands/plugin.ts`](../../packages/coding-agent/src/commands/plugin.ts) — declaración de comandos de CLI y mapeo de flags
- [`src/cli/plugin-cli.ts`](../../packages/coding-agent/src/cli/plugin-cli.ts) — despacho de acciones, manejadores de comandos orientados al usuario
- [`src/extensibility/plugins/manager.ts`](../../packages/coding-agent/src/extensibility/plugins/manager.ts) — implementación activa de instalación/eliminación/listado/enlace/estado/doctor
- [`src/extensibility/plugins/installer.ts`](../../packages/coding-agent/src/extensibility/plugins/installer.ts) — auxiliares del instalador heredado y comprobaciones de seguridad adicionales para enlace
- [`src/extensibility/plugins/loader.ts`](../../packages/coding-agent/src/extensibility/plugins/loader.ts) — descubrimiento de plugins habilitados y resolución de rutas de herramientas/hooks/comandos
- [`src/extensibility/plugins/parser.ts`](../../packages/coding-agent/src/extensibility/plugins/parser.ts) — auxiliares de análisis de especificaciones de instalación y nombres de paquetes
- [`src/extensibility/plugins/types.ts`](../../packages/coding-agent/src/extensibility/plugins/types.ts) — contratos de tipos para manifiesto/tiempo de ejecución/sobreescrituras
- [`src/extensibility/custom-tools/loader.ts`](../../packages/coding-agent/src/extensibility/custom-tools/loader.ts) — cableado en tiempo de ejecución para módulos de herramientas proporcionados por plugins
