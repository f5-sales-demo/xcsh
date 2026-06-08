---
title: 'Migración desde pi-mono: Guía Práctica de Merge'
description: Guía práctica para migrar código del monorepo pi-mono al código base de xcsh.
sidebar:
  order: 9
  label: Migración desde pi-mono
i18n:
  sourceHash: dbba6f6c0987
  translator: machine
---

# Migración desde pi-mono: Guía Práctica de Merge

Esta guía es una lista de verificación repetible para migrar cambios de pi-mono a este repositorio.
Úsela para cualquier merge: archivo individual, rama de feature o sincronización de release completa.

## Último Punto de Sincronización

**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`
**Fecha:** 2026-03-22

Actualice esta sección después de cada sincronización; no reutilice el rango anterior.

Al iniciar una nueva sincronización, genere parches desde este commit en adelante:

```bash
git format-patch b21b42d032919de2f2e6920a76fa9a37c3920c0a..HEAD --stdout > changes.patch
```

## 0) Definir el alcance

- Identifique la referencia upstream (commit, tag o PR).
- Liste los paquetes o carpetas que planea modificar.
- Decida qué funcionalidades están dentro del alcance y cuáles se omiten intencionalmente.

## 1) Traer el código de forma segura

- Prefiera un diff limpio y enfocado en lugar de una copia completa.
- Evite copiar artefactos compilados o archivos generados.
- Si upstream agregó archivos nuevos, agréguelos explícitamente y revise su contenido.

## 2) Respetar las convenciones de extensión en imports

La mayoría de los archivos TypeScript de runtime omiten `.js` en los imports internos, pero algunos entrypoints de test/bench mantienen `.js` para compatibilidad con ESM en runtime. Siga el estilo existente del paquete local; no elimine extensiones de forma indiscriminada.

- En los archivos de runtime de `packages/coding-agent`, mantenga los imports internos sin extensión a menos que se importen assets que no son TS.
- En `packages/tui/test` y `packages/natives/bench`, mantenga `.js` donde los archivos circundantes ya lo usan.
- Mantenga las extensiones de archivo reales cuando las herramientas lo requieran (p. ej., `.json`, `.css`, embeds de texto `.md`).
- Ejemplo: `import { x } from "./foo.js";` → `import { x } from "./foo";` (solo cuando la convención del paquete es sin extensión).

## 3) Reemplazar los scopes de import

Upstream utiliza diferentes scopes de paquete. Reemplácelos de forma consistente.

- Reemplace los scopes antiguos con el scope local utilizado aquí.
- Ejemplos (ajuste según los paquetes reales que esté migrando):
  - `@mariozechner/pi-coding-agent` → `@f5xc-salesdemos/xcsh`
  - `@mariozechner/pi-agent-core` → `@f5xc-salesdemos/pi-agent-core`
  - `@mariozechner/pi-tui` → `@f5xc-salesdemos/pi-tui`
  - `@mariozechner/pi-ai` → `@f5xc-salesdemos/pi-ai`

## 4) Usar APIs de Bun donde mejoren a las de Node

Ejecutamos sobre Bun. Reemplace APIs de Node solo cuando Bun proporcione una alternativa mejor.

**SÍ reemplace:**

- Ejecución de procesos: `child_process.spawn` → Bun Shell `$` para comandos simples, `Bun.spawn`/`Bun.spawnSync` para trabajo de streaming o larga duración
- I/O de archivos: `fs.readFileSync` → `Bun.file().text()` / `Bun.write()`
- Clientes HTTP: `node-fetch`, `axios` → `fetch` nativo
- Hashing criptográfico: `node:crypto` → Web Crypto o `Bun.hash`
- SQLite: `better-sqlite3` → `bun:sqlite`
- Carga de env: `dotenv` → Bun carga `.env` automáticamente

**NO reemplace (estos funcionan bien en Bun):**

- `os.homedir()` — NO reemplace con `Bun.env.HOME`, `Bun.env.HOME`, o el literal `"~"`
- `os.tmpdir()` — NO reemplace con `Bun.env.TMPDIR || "/tmp"` o rutas hardcodeadas
- `fs.mkdtempSync()` — NO reemplace con construcción manual de rutas
- `path.join()`, `path.resolve()`, etc. — estos están bien

**Estilo de import:** Use el prefijo `node:` con imports de namespace únicamente (sin imports nombrados de `node:fs` o `node:path`).

**Convenciones adicionales de Bun:**

- Prefiera Bun Shell `$` para comandos cortos sin streaming; use `Bun.spawn` solo cuando necesite I/O de streaming o control de procesos.
- Use `Bun.file()`/`Bun.write()` para archivos y `node:fs/promises` para directorios.
- Evite verificaciones con `Bun.file().exists()`; use manejo `isEnoent` en try/catch.
- Prefiera `Bun.sleep(ms)` sobre wrappers de `setTimeout`.

**Incorrecto:**

```typescript
// BROKEN: env vars may be undefined, "~" is not expanded
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

## 5) Preferir embeds de Bun (sin copiar)

No copie assets de runtime ni archivos de vendor en tiempo de build.

- Si upstream copia assets a una carpeta dist, reemplace con embeds compatibles con Bun.
- Los prompts son archivos `.md` estáticos; use imports de texto de Bun (`with { type: "text" }`) y Handlebars en lugar de strings de prompt inline.
- Use `import.meta.dir` + `Bun.file` para cargar recursos adyacentes que no sean texto.
- Mantenga los assets en el repositorio y deje que el bundler los incluya.
- Elimine scripts de copia a menos que el usuario los solicite explícitamente.
- Si upstream lee un archivo de fallback empaquetado en runtime, reemplace las lecturas del sistema de archivos con un import de embed de texto de Bun.
  - Ejemplo (fallback de instrucciones de Codex):
    - `const FALLBACK_PROMPT_PATH = join(import.meta.dir, "codex-instructions.md");` -> eliminado
    - `import FALLBACK_INSTRUCTIONS from "./codex-instructions.md" with { type: "text" };`
    - Use `return FALLBACK_INSTRUCTIONS;` en lugar de `readFileSync(FALLBACK_PROMPT_PATH, "utf8")`

## 6) Migrar `package.json` con cuidado

Trate `package.json` como un contrato. Haga merge intencionalmente.

- Mantenga los valores existentes de `name`, `version`, `type`, `exports` y `bin` a menos que la migración requiera cambios.
- Reemplace scripts de npm/node con equivalentes de Bun (p. ej., `bun check`, `bun test`).
- Asegúrese de que las dependencias usen el scope correcto.
- No degrade dependencias para corregir errores de tipos; actualice en su lugar.
- Valide los links de paquetes del workspace y `peerDependencies`.

## 7) Alinear estilo de código y herramientas

- Mantenga las convenciones de formateo existentes.
- No introduzca `any` a menos que sea necesario.
- Evite imports dinámicos e imports de tipos inline; use solo imports de nivel superior.
- Nunca construya prompts en código; los prompts son archivos `.md` estáticos renderizados con Handlebars.
- En coding-agent, nunca use `console.log`/`console.warn`/`console.error`; use `logger` de `@f5xc-salesdemos/pi-utils`.
- Use `Promise.withResolvers()` en lugar de `new Promise((resolve, reject) => ...)`.
- **No use palabras clave `private`/`protected`/`public` en campos o métodos de clase.** Use campos privados ES `#` para encapsulación; deje los miembros accesibles sin palabra clave. La única excepción son las propiedades de parámetros del constructor (`constructor(private readonly x: T)`), donde la palabra clave es requerida por TypeScript. Al migrar código upstream que usa `private foo` o `protected bar`, convierta a `#foo` (privado) o `bar` sin modificador (accesible).
- Prefiera helpers y utilidades existentes sobre código ad-hoc nuevo.
- Preserve los cambios de infraestructura Bun-first ya realizados en este repositorio:
  - El runtime es Bun (sin entry points de Node).
  - El gestor de paquetes es Bun (sin lockfiles de npm).
  - Las APIs pesadas de Node (`child_process`, `readline`) están reemplazadas con equivalentes de Bun.
  - Las APIs ligeras de Node (`os.homedir`, `os.tmpdir`, `fs.mkdtempSync`, `path.*`) se mantienen.
  - Los shebangs de CLI usan `bun` (no `node`, no `tsx`).
  - Los paquetes usan archivos fuente directamente (sin paso de compilación de TypeScript).
  - Los workflows de CI ejecutan Bun para install/check/test.

## 8) Eliminar capas de compatibilidad antiguas

A menos que se solicite, elimine los shims de compatibilidad de upstream.

- Elimine APIs antiguas que fueron reemplazadas.
- Actualice todos los puntos de uso a la nueva API directamente.
- No mantenga versiones `*_v2` o paralelas.

## 9) Actualizar documentación y referencias

- Reemplace los links al repositorio pi-mono donde sea apropiado.
- Actualice los ejemplos para usar Bun y los scopes de paquete correctos.
- Asegúrese de que las instrucciones del README aún coincidan con el comportamiento actual del repositorio.

## 10) Validar la migración

Ejecute las verificaciones estándar después de los cambios:

- `bun check`

Si el repositorio ya tiene verificaciones fallidas no relacionadas con sus cambios, señálelo.
Los tests usan el runner de Bun (no Vitest), pero solo ejecute `bun test` cuando se solicite explícitamente.

## 11) Proteger funcionalidades mejoradas (lista trampa de regresiones)

Si ya mejoró comportamiento localmente, trátelo como **no negociable**. Antes de migrar, documente
las mejoras y agregue verificaciones explícitas para que no se pierdan en el merge.

- **Congele el comportamiento esperado**: agregue una nota breve de "antes/después" para cada mejora (entradas, salidas,
  valores por defecto, casos límite). Esto previene reversiones silenciosas.
- **Mapee APIs antiguas → nuevas**: si upstream renombró conceptos (hooks → extensions, custom tools → tools, etc.),
  asegúrese de que cada punto de entrada antiguo siga conectado. Un flag u export omitido equivale a funcionalidad perdida.
- **Verifique los exports**: revise `exports` de `package.json`, tipos públicos y archivos barrel. Las migraciones de upstream
  frecuentemente olvidan re-exportar adiciones locales.
- **Cubra los caminos no felices**: si corrigió manejo de errores, timeouts o lógica de fallback, agregue un test o
  al menos una lista de verificación manual que ejercite esas rutas.
- **Verifique los valores por defecto y el orden de merge de configuración**: las mejoras frecuentemente residen en los valores por defecto. Confirme que los nuevos
  valores por defecto no revirtieron (p. ej., nueva precedencia de configuración, features deshabilitadas, listas de herramientas).
- **Audite el comportamiento de env/shell**: si corrigió la ejecución o el sandboxing, verifique que la nueva ruta aún use su
  env sanitizado y no reintroduzca overrides de alias/funciones.
- **Re-ejecute muestras dirigidas**: mantenga un conjunto mínimo de ejemplos "conocidos como buenos" y ejecútelos después de la migración
  (flags de CLI, registro de extensiones, ejecución de herramientas).

## 12) Detectar y manejar código refactorizado

Antes de migrar un archivo, verifique si upstream lo refactorizó significativamente:

```bash
# Compare the file you're about to port against what you have locally
git diff HEAD upstream/main -- path/to/file.ts
```

Si el diff muestra que el archivo fue **refactorizado** (no solo parcheado):

- Nuevas abstracciones, conceptos renombrados, módulos fusionados, flujo de datos cambiado

Entonces debe **leer la nueva implementación a fondo** antes de migrar. El merge a ciegas de código refactorizado pierde funcionalidad porque:

Nota: el modo interactivo fue recientemente dividido en controllers/utils/types. Al hacer backport de cambios relacionados, migre las actualizaciones a los archivos individuales que creamos y asegúrese de que la conexión en `interactive-mode.ts` se mantenga sincronizada.

1. **Los valores por defecto cambian silenciosamente** - Una nueva variable `defaultFoo = [a, b]` puede reemplazar un antiguo `getAllFoo()` que retornaba `[a, b, c, d, e]`.

2. **Las opciones de API se eliminan** - Cuando los sistemas se fusionan (p. ej., `hooks` + `customTools` → `extensions`), las opciones antiguas pueden no conectarse con la nueva implementación.

3. **Las rutas de código se vuelven obsoletas** - Un concepto renombrado (p. ej., `hookMessage` → `custom`) necesita actualizaciones en cada sentencia switch, type guard y handler—no solo en la definición.

4. **El contexto/capacidades se reducen** - Las APIs antiguas pueden haber expuesto `{ logger, typebox, pi }` que las nuevas APIs olvidaron incluir.

### Proceso de migración semántica

Cuando upstream refactorizó un módulo:

1. **Lea la implementación antigua** - Entienda qué hacía, qué opciones aceptaba, qué exponía.

2. **Lea la implementación nueva** - Entienda las nuevas abstracciones y cómo se mapean al comportamiento anterior.

3. **Verifique la paridad de funcionalidades** - Para cada capacidad en el código antiguo, confirme que el código nuevo la preserva o la elimina explícitamente.

4. **Busque rezagados** - Busque nombres/conceptos antiguos que puedan haberse omitido en sentencias switch, handlers, componentes de UI.

5. **Pruebe los límites** - Flags de CLI, opciones del SDK, handlers de eventos, valores por defecto—aquí es donde se esconden las regresiones.

### Verificaciones rápidas

```bash
# Find all uses of an old concept that may need updating
rg "oldConceptName" --type ts

# Compare default values between versions
git show upstream/main:path/to/file.ts | rg "default|DEFAULT"

# Check if all enum/union values have handlers
rg "case \"" path/to/file.ts
```

## 13) Lista de verificación rápida de auditoría

Use esto como pasada final antes de terminar:

- [ ] Las extensiones de import siguen la convención del paquete local (sin eliminación indiscriminada de `.js`)
- [ ] No hay APIs exclusivas de Node en código nuevo/migrado
- [ ] Todos los scopes de paquete actualizados
- [ ] Los scripts de `package.json` usan Bun
- [ ] Los prompts son imports de texto `.md` (sin strings de prompt inline)
- [ ] No hay `console.*` en coding-agent (use `logger`)
- [ ] Los assets se cargan mediante patrones de embed de Bun (sin scripts de copia)
- [ ] Los tests o verificaciones se ejecutan (o se indica explícitamente que están bloqueados)
- [ ] Sin regresiones de funcionalidad (ver secciones 11-12)

## 14) Formato de mensaje de commit

Al hacer commit de un backport, siga el formato del repositorio `<type>(scope): <descripción en pasado>` y mantenga el
rango de commits en el título.

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
- Incluya números de issue/PR de upstream y atribución de contribuidores para contribuciones externas
- El rango de commits en el título ayuda a rastrear los puntos de sincronización

## 15) Divergencias Intencionales

Nuestro fork tiene decisiones arquitectónicas que difieren de upstream. **No migre estos patrones de upstream:**

### Arquitectura de UI

| Upstream                                    | Nuestro Fork                                              | Razón                                                                 |
| ------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Clase `FooterDataProvider`                  | `StatusLineComponent`                                     | Línea de estado más simple e integrada                                |
| `ctx.ui.setHeader()` / `ctx.ui.setFooter()` | Stub en modos no-TUI                                     | Implementado en TUI, no-op en otros casos                             |
| `ctx.ui.setEditorComponent()`               | Stub en modos no-TUI                                     | Implementado en TUI, no-op en otros casos                             |
| Objeto de opciones `InteractiveModeOptions` | Args posicionales en constructor (el tipo de opciones aún se exporta) | Mantener la firma del constructor; actualizar el tipo cuando upstream agregue campos |

### Nomenclatura de Componentes

| Upstream                     | Nuestro Fork            |
| ---------------------------- | ----------------------- |
| `extension-input.ts`         | `hook-input.ts`         |
| `extension-selector.ts`      | `hook-selector.ts`      |
| `ExtensionInputComponent`    | `HookInputComponent`    |
| `ExtensionSelectorComponent` | `HookSelectorComponent` |

### Nomenclatura de APIs

| Upstream                                 | Nuestro Fork                             | Notas                                     |
| ---------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)`    | Usamos `sessionName` en todo el código    |
| `sessionManager.getSessionName()`        | `sessionManager.getSessionName()`        | Igual (unificamos para coincidir con el RPC de upstream) |
| `agent.sessionName` / `setSessionName()` | `agent.sessionName` / `setSessionName()` | Igual                                     |

### Consolidación de Archivos

| Upstream                                           | Nuestro Fork                            | Razón                                   |
| -------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `clipboard.ts` + `clipboard-image.ts` (archivos de herramientas) | Módulo clipboard de `@f5xc-salesdemos/pi-natives` | Fusionado en implementación nativa N-API |

### Framework de Tests

| Upstream                  | Nuestro Fork                  |
| ------------------------- | ----------------------------- |
| `vitest` con `vi.mock()`  | `bun:test` con `vi` de bun   |
| Assertions de `node:test`  | Matchers `expect()`           |

### Arquitectura de Herramientas

| Upstream                            | Nuestro Fork                                                              | Notas                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `createTool(cwd: string, options?)` | `createTools(session: ToolSession)` vía registro `BUILTIN_TOOLS`          | Las factories de herramientas aceptan `ToolSession` y pueden retornar `null` |
| Interfaces `*Operations` por herramienta | Las interfaces por herramienta se mantienen (`FindOperations`, `GrepOperations`) | Usadas para overrides SSH/remotos                         |
| `fs/promises` de Node.js en todos lados | `Bun.file()`/`Bun.write()` para archivos; `node:fs/promises` para directorios | Preferir APIs de Bun cuando simplifican                   |

### Almacenamiento de Autenticación

| Upstream                        | Nuestro Fork                                | Notas                                        |
| ------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `proper-lockfile` + `auth.json` | `agent.db` (bun:sqlite)                     | Credenciales almacenadas exclusivamente en `agent.db` |
| Una credencial por proveedor    | Multi-credencial con selección round-robin   | Lógica de afinidad de sesión y backoff preservada |

### Extensiones

| Upstream                      | Nuestro Fork                               |
| ----------------------------- | ------------------------------------------ |
| `jiti` para carga de TypeScript | `import()` nativo de Bun                   |
| Campo de manifiesto `pkg.pi`   | `pkg.xcsh ?? pkg.pi` (preferir nuestro namespace) |

### Omitir Estas Funcionalidades de Upstream

Al migrar, **omita** estos archivos/funcionalidades por completo:

- `footer-data-provider.ts` — usamos StatusLineComponent
- `clipboard-image.ts` — clipboard está en el módulo N-API de `@f5xc-salesdemos/pi-natives`
- Archivos de workflow de GitHub — tenemos nuestro propio CI
- `models.generated.ts` — auto-generado, regenerar localmente (como models.json en su lugar)

### Funcionalidades que Agregamos (Preservar Estas)

Estas existen en nuestro fork pero no en upstream. **Nunca sobrescriba:**

- `StatusLineComponent` en modo interactivo
- Autenticación multi-credencial con afinidad de sesión
- Sistema de descubrimiento basado en capacidades (`defineCapability`, `registerProvider`, `loadCapability`, `skillCapability`, etc.)
- Integraciones MCP/Exa/SSH
- Writethrough de LSP para format-on-save
- Intercepción de Bash (`checkBashInterception`)
- Sugerencias de rutas con fuzzy matching en herramienta de lectura
