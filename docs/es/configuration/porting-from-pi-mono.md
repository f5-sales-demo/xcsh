---
title: 'Portando Desde pi-mono: Una Guía Práctica de Fusión'
description: Guía práctica para migrar código del monorepo pi-mono al código base de xcsh.
sidebar:
  order: 9
  label: Portando desde pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Portando Desde pi-mono: Una Guía Práctica de Fusión

Esta guía es una lista de verificación repetible para portar cambios de pi-mono a este repositorio.
Úsela para cualquier fusión: archivo individual, rama de funcionalidad o sincronización completa de versión.

## Último Punto de Sincronización

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Fecha:** 2026-03-22

Actualice esta sección después de cada sincronización; no reutilice el rango anterior.

Al iniciar una nueva sincronización, genere parches desde este commit en adelante:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Definir el alcance

- Identifique la referencia upstream (commit, etiqueta o PR).
- Liste los paquetes o carpetas que planea modificar.
- Decida qué funcionalidades están dentro del alcance y cuáles se omiten intencionalmente.

## 1) Traer el código de forma segura

- Prefiera un diff limpio y enfocado en lugar de una copia completa.
- Evite copiar artefactos compilados o archivos generados.
- Si upstream agregó archivos nuevos, agréguelos explícitamente y revise su contenido.

## 2) Cumplir con las convenciones de extensión de importaciones

La mayoría de los archivos fuente TypeScript en tiempo de ejecución omiten `.js` en las importaciones internas, pero algunos puntos de entrada de pruebas/benchmarks mantienen `.js` para compatibilidad en tiempo de ejecución con ESM. Siga el estilo existente del paquete local; no elimine extensiones de forma generalizada.

- En los archivos fuente de tiempo de ejecución de `packages/coding-agent`, mantenga las importaciones internas sin extensión a menos que se importen recursos no-TS.
- En `packages/tui/test` y `packages/natives/bench`, mantenga `.js` donde los archivos circundantes ya lo usan.
- Mantenga las extensiones reales de archivo cuando las herramientas lo requieran (p. ej., `.json`, `.css`, incrustaciones de texto `.md`).
- Ejemplo: `import { x } from "./foo.js";` → `import { x } from "./foo";` (solo cuando la convención del paquete es sin extensión).

## 3) Reemplazar los ámbitos de importación

Upstream usa ámbitos de paquete diferentes. Reemplácelos de forma consistente.

- Reemplace los ámbitos antiguos con el ámbito local usado aquí.
- Ejemplos (ajuste para coincidir con los paquetes reales que está portando):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Usar APIs de Bun cuando mejoren sobre Node

Ejecutamos sobre Bun. Reemplace las APIs de Node solo cuando Bun proporcione una alternativa mejor.

**SÍ reemplazar:**

- Creación de procesos: `child_process.spawn` → Bun Shell `$` para comandos simples, `Bun.spawn`/`Bun.spawnSync` para trabajo con streaming o de larga duración
- E/S de archivos: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Clientes HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing criptográfico: `node:crypto` → Web Crypto o `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Carga de variables de entorno: `dotenv` → Bun carga `.env` automáticamente

**NO reemplazar (estos funcionan bien en Bun):**

- `os.homedir()` — NO reemplazar con `Bun.env.HOME`, `Bun.env.HOME`, o el literal `"~"`
- `os.tmpdir()` — NO reemplazar con `Bun.env.TMPDIR || "/tmp"` o rutas codificadas
- `fs.mkdtempSync()` — NO reemplazar con construcción manual de rutas
- `path.join()`, `path.resolve()`, etc. — estos están bien

**Estilo de importación:** Use el prefijo `node:` con importaciones de espacio de nombres únicamente (sin importaciones nombradas de `node:fs` o `node:path`).

**Convenciones adicionales de Bun:**

- Prefiera Bun Shell `$` para comandos cortos sin streaming; use `Bun.spawn` solo cuando necesite E/S con streaming o control de procesos.
- Use `Bun.file()`/`Bun.write()` para archivos y `node:fs/promises` para directorios.
- Evite las verificaciones `Bun.file().exists()`; use manejo `isEnoent` en try/catch.
- Prefiera `Bun.sleep(ms)` sobre envoltorios de `setTimeout`.

**Incorrecto:**

```typescript
// ROTO: las variables de entorno pueden ser undefined, "~" no se expande
const home = Bun.env.HOME || "~";
const tmp = Bun.env.TMPDIR || "/tmp";
```

**Correcto:**

```typescript
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

const configDir = path.join(os.homedir(), ".config", "myapp");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "myapp-"));
```

## 5) Preferir incrustaciones de Bun (sin copiar)

No copie recursos de tiempo de ejecución ni archivos de proveedores en tiempo de compilación.

- Si upstream copia recursos en una carpeta dist, reemplace con incrustaciones compatibles con Bun.
- Los prompts son archivos `.md` estáticos; use importaciones de texto de Bun (`with { type: "text" }`) y Handlebars en lugar de cadenas de prompt en línea.
- Use `import.meta.dir` + `Bun.file` para cargar recursos adyacentes no textuales.
- Mantenga los recursos en el repositorio y deje que el bundler los incluya.
- Elimine scripts de copia a menos que el usuario los solicite explícitamente.
- Si upstream lee un archivo de respaldo empaquetado en tiempo de ejecución, reemplace las lecturas del sistema de archivos con una importación de incrustación de texto de Bun.
  - Ejemplo (respaldo de instrucciones de Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> eliminado
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Use `return FALLBACK_INSTRUCTIONS;` en lugar de `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Portar `package.json` con cuidado

Trate `package.json` como un contrato. Fusione intencionalmente.

- Mantenga los valores existentes de `name`, `version`, `type`, `exports` y `bin` a menos que el port requiera cambios.
- Reemplace scripts de npm/node con equivalentes de Bun (p. ej., `bun check`, `bun test`).
- Asegúrese de que las dependencias usen el ámbito correcto.
- No degrade dependencias para corregir errores de tipos; actualice en su lugar.
- Valide los enlaces de paquetes del workspace y `peerDependencies`.

## 7) Alinear estilo de código y herramientas

- Mantenga las convenciones de formato existentes.
- No introduzca `any` a menos que sea necesario.
- Evite importaciones dinámicas e importaciones de tipos en línea; use solo importaciones de nivel superior.
- Nunca construya prompts en código; los prompts son archivos `.md` estáticos renderizados con Handlebars.
- En coding-agent, nunca use `console.log`/`console.warn`/`console.error`; use `logger` de `@f5xc-salesdemos/pi-utils`.
- Use `Promise.withResolvers()` en lugar de `new Promise((resolve, reject) => ...)`.
- **Sin palabras clave `private`/`protected`/`public` en campos o métodos de clase.** Use campos privados ES `#` para encapsulación; deje los miembros accesibles sin palabra clave. La única excepción son las propiedades de parámetros del constructor (`constructor(private readonly x: T)`), donde la palabra clave es requerida por TypeScript. Al portar código upstream que usa `private foo` o `protected bar`, convierta a `#foo` (privado) o `bar` sin modificador (accesible).
- Prefiera helpers y utilidades existentes sobre código ad-hoc nuevo.
- Preserve los cambios de infraestructura Bun-first ya realizados en este repositorio:
  - El runtime es Bun (sin puntos de entrada de Node).
  - El gestor de paquetes es Bun (sin lockfiles de npm).
  - Las APIs pesadas de Node (`child_process`, `readline`) están reemplazadas con equivalentes de Bun.
  - Las APIs ligeras de Node (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) se mantienen.
  - Los shebangs de CLI usan `bun` (no `node`, no `tsx`).
  - Los paquetes usan archivos fuente directamente (sin paso de compilación de TypeScript).
  - Los workflows de CI ejecutan Bun para instalar/verificar/probar.

## 8) Eliminar capas de compatibilidad antiguas

A menos que se solicite, elimine los shims de compatibilidad de upstream.

- Elimine APIs antiguas que fueron reemplazadas.
- Actualice todos los sitios de llamada a la nueva API directamente.
- No mantenga versiones `*_v2` o paralelas.

## 9) Actualizar documentación y referencias

- Reemplace los enlaces al repositorio pi-mono donde sea apropiado.
- Actualice los ejemplos para usar Bun y los ámbitos de paquete correctos.
- Asegúrese de que las instrucciones del README aún coincidan con el comportamiento actual del repositorio.

## 10) Validar el port

Ejecute las verificaciones estándar después de los cambios:

- `bun check`

Si el repositorio ya tiene verificaciones fallidas no relacionadas con sus cambios, señálelo.
Las pruebas usan el ejecutor de Bun (no Vitest), pero solo ejecute `bun test` cuando se solicite explícitamente.

## 11) Proteger funcionalidades mejoradas (lista de trampas de regresión)

Si ya mejoró el comportamiento localmente, trate esas mejoras como **no negociables**. Antes de portar, documente las mejoras y agregue verificaciones explícitas para que no se pierdan en la fusión.

- **Congele el comportamiento esperado**: agregue una nota breve de "antes/después" para cada mejora (entradas, salidas, valores por defecto, casos límite). Esto previene reversiones silenciosas.
- **Mapee APIs antiguas → nuevas**: si upstream renombró conceptos (hooks → extensions, custom tools → tools, etc.), asegúrese de que cada punto de entrada antiguo siga conectado. Un flag o exportación olvidada equivale a funcionalidad perdida.
- **Verifique las exportaciones**: revise los `exports` de `package.json`, tipos públicos y archivos barrel. Los ports de upstream frecuentemente olvidan re-exportar adiciones locales.
- **Cubra los caminos no felices**: si corrigió manejo de errores, timeouts o lógica de respaldo, agregue una prueba o al menos una lista de verificación manual que ejercite esas rutas.
- **Verifique los valores por defecto y el orden de fusión de configuración**: las mejoras frecuentemente residen en los valores por defecto. Confirme que los nuevos valores por defecto no revirtieron (p. ej., nueva precedencia de configuración, funcionalidades deshabilitadas, listas de herramientas).
- **Audite el comportamiento de env/shell**: si corrigió la ejecución o el sandboxing, verifique que la nueva ruta siga usando su entorno sanitizado y no reintroduzca sobrecargas de alias/funciones.
- **Re-ejecute muestras específicas**: mantenga un conjunto mínimo de ejemplos "conocidos como buenos" y ejecútelos después del port (flags de CLI, registro de extensiones, ejecución de herramientas).

## 12) Detectar y manejar código reestructurado

Antes de portar un archivo, verifique si upstream lo refactorizó significativamente:

```bash
# Compare el archivo que está por portar contra lo que tiene localmente
git diff HEAD upstream/main -- path/to/file.ts
```

Si el diff muestra que el archivo fue **reestructurado** (no solo parcheado):

- Nuevas abstracciones, conceptos renombrados, módulos fusionados, flujo de datos cambiado

Entonces debe **leer la nueva implementación completamente** antes de portar. La fusión ciega de código reestructurado pierde funcionalidad porque:

Nota: el modo interactivo fue recientemente dividido en controllers/utils/types. Al retroportar cambios relacionados, porte las actualizaciones a los archivos individuales que creamos y asegúrese de que el cableado de `interactive-mode.ts` se mantenga sincronizado.

1. **Los valores por defecto cambian silenciosamente** - Una nueva variable `defaultFoo = [a, b]` puede reemplazar un antiguo `getAllFoo()` que retornaba `[a, b, c, d, e]`.

2. **Las opciones de API se eliminan** - Cuando los sistemas se fusionan (p. ej., `hooks` + `customTools` → `extensions`), las opciones antiguas pueden no conectarse a la nueva implementación.

3. **Las rutas de código quedan obsoletas** - Un concepto renombrado (p. ej., `hookMessage` → `custom`) necesita actualizaciones en cada declaración switch, guardia de tipo y manejador—no solo en la definición.

4. **El contexto/capacidades se reducen** - Las APIs antiguas pueden haber expuesto `{ logger, typebox, pi }` que las nuevas APIs olvidaron incluir.

### Proceso de portado semántico

Cuando upstream reestructuró un módulo:

1. **Lea la implementación antigua** - Entienda qué hacía, qué opciones aceptaba, qué exponía.

2. **Lea la nueva implementación** - Entienda las nuevas abstracciones y cómo se mapean al comportamiento anterior.

3. **Verifique la paridad de funcionalidades** - Para cada capacidad en el código antiguo, confirme que el nuevo código la preserva o la elimina explícitamente.

4. **Busque rezagados** - Busque nombres/conceptos antiguos que pueden haberse omitido en declaraciones switch, manejadores, componentes de UI.

5. **Pruebe los límites** - Flags de CLI, opciones del SDK, manejadores de eventos, valores por defecto—aquí es donde se esconden las regresiones.

### Verificaciones rápidas

```bash
# Encontrar todos los usos de un concepto antiguo que puede necesitar actualización
rg "oldConceptName" --type ts

# Comparar valores por defecto entre versiones
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Verificar si todos los valores de enum/unión tienen manejadores
rg "case \"" path/to/file.ts
```

## 13) Lista de verificación rápida de auditoría

Use esto como una pasada final antes de terminar:

- [ ] Las extensiones de importación siguen la convención del paquete local (sin eliminación generalizada de `.js`)
- [ ] Sin APIs exclusivas de Node en código nuevo/portado
- [ ] Todos los ámbitos de paquete actualizados
- [ ] Los scripts de `package.json` usan Bun
- [ ] Los prompts son importaciones de texto `.md` (sin cadenas de prompt en línea)
- [ ] Sin `console.*` en coding-agent (usar `logger`)
- [ ] Los recursos se cargan mediante patrones de incrustación de Bun (sin scripts de copia)
- [ ] Las pruebas o verificaciones se ejecutan (o se nota explícitamente como bloqueado)
- [ ] Sin regresiones de funcionalidad (ver secciones 11-12)

## 14) Formato de mensaje de commit

Al hacer commit de un retroporte, siga el formato del repositorio `<tipo>(alcance): <descripción en pasado>` y mantenga el rango de commits en el título.

```
fix(coding-agent): backported pi-mono changes (<from>..<to>)

packages/<package>:
- <type>: <description>
- <type>: <description> (#<issue> by @<contributor>)

packages/<other-package>:
- <type>: <description>
```

**Ejemplo:**

```
fix(coding-agent): backported pi-mono changes (9f3eef65f..52532c7c0)

packages/ai:
- fix: handle "sensitive" stop reason from Anthropic API
- fix: normalize tool call IDs with special characters for Responses API
- fix: add overflow detection for Bedrock, MiniMax, Kimi providers
- fix: 429 status is rate limiting, not context overflow

packages/tui:
- fix: refactored autocomplete state tracking
- fix: file autocomplete should not trigger on empty text
- fix: configurable autocomplete max visible items
- fix: improved table column width calculation with word-aware wrapping

packages/coding-agent:
- fix: preserve external config.yml edits on save (#1046 by @nicobailonMD)
- fix: resolve macOS NFD and curly quote variants in file paths
```

**Reglas:**

- Agrupe los cambios por paquete
- Use tipos de commit convencionales (`fix`, `feat`, `refactor`, `perf`, `docs`)
- Incluya números de issue/PR de upstream y atribución al contribuidor para contribuciones externas
- El rango de commits en el título ayuda a rastrear los puntos de sincronización

## 15) Divergencias Intencionales

Nuestro fork tiene decisiones arquitectónicas que difieren de upstream. **No porte estos patrones de upstream:**

### Arquitectura de UI

| Upstream                                    | Nuestro Fork                                              | Razón                                                                 |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Clase `FooterDataProvider`                  | `StatusLineComponent`                                     | Línea de estado más simple e integrada                                |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub en modos no-TUI                                     | Implementado en TUI, no-op en otros modos                             |
| `ctx.ui.setEditorComponent()`               | Stub en modos no-TUI                                     | Implementado en TUI, no-op en otros modos                             |
| Objeto de opciones `InteractiveModeOptions` | Args posicionales en constructor (tipo de opciones aún exportado) | Mantener firma del constructor; actualizar el tipo cuando upstream agregue campos |

### Nomenclatura de Componentes

| Upstream                     | Nuestro Fork            |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Nomenclatura de API

| Upstream                                 | Nuestro Fork                             | Notas                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Usamos `sessionName` en todo el código    |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Igual (unificamos para coincidir con el RPC de upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Igual                                     |

### Consolidación de Archivos

| Upstream                                           | Nuestro Fork                            | Razón                                   |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (archivos de herramientas) | Módulo clipboard de `@f5xc-salesdemos/pi-natives` | Fusionado en implementación nativa N-API |

### Framework de Pruebas

| Upstream                  | Nuestro Fork                  |
| ------------------------- | ----------------------------- |
| `vitest` con `vi.mock()`  | `bun:test` con `vi` de bun   |
| Aserciones de `node:test` | Matchers `expect()`           |

### Arquitectura de Herramientas

| Upstream                            | Nuestro Fork                                                      | Notas                                                     |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` vía registro `BUILTIN_TOOLS`  | Las fábricas de herramientas aceptan `ToolSession` y pueden retornar `null` |
| Interfaces `*Operations` por herramienta | Las interfaces por herramienta se mantienen (`FindOperations`, `GrepOperations`) | Usadas para sobrecargas SSH/remotas                       |
| `fs/promises` de Node.js en todas partes | `Bun.file()`/`Bun.write()` para archivos; `node:fs/promises` para directorios | Preferir APIs de Bun cuando simplifiquen                  |

### Almacenamiento de Autenticación

| Upstream                        | Nuestro Fork                                | Notas                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credenciales almacenadas exclusivamente en `agent.db` |
| Una credencial por proveedor    | Multi-credencial con selección round-robin   | Se preserva la afinidad de sesión y la lógica de backoff |

### Extensiones

| Upstream                      | Nuestro Fork                               |
| ----------------------------- | ------------------------------------------ |
| `jiti` para carga de TypeScript | `import()` nativo de Bun                  |
| Campo de manifiesto `pkg.pi`   | `pkg.xcsh ?? pkg.pi` (preferir nuestro namespace) |

### Omitir Estas Funcionalidades de Upstream

Al portar, **omita** estos archivos/funcionalidades completamente:

- `footer-data-provider.ts` — usamos StatusLineComponent
- `clipboard-image.ts` — clipboard está en el módulo N-API de `@f5xc-salesdemos/pi-natives`
- Archivos de workflow de GitHub — tenemos nuestro propio CI
- `models.generated.ts` — auto-generado, regenerar localmente (como models.json en su lugar)

### Funcionalidades que Agregamos (Preservar Estas)

Estas existen en nuestro fork pero no en upstream. **Nunca sobrescribir:**

- `StatusLineComponent` en modo interactivo
- Autenticación multi-credencial con afinidad de sesión
- Sistema de descubrimiento basado en capacidades (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, etc.)
- Integraciones MCP/Exa/SSH
- Writethrough LSP para formato al guardar
- Intercepción de Bash (`checkBashInterception`)
- Sugerencias de rutas difusas en la herramienta de lectura
