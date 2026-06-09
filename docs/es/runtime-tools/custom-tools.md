---
title: Herramientas personalizadas
description: >-
  Registro de herramientas personalizadas, definición de esquemas y pipeline de
  ejecución para extender el agente.
sidebar:
  order: 4
  label: Herramientas personalizadas
i18n:
  sourceHash: 4557bc868e23
  translator: machine
---

# Herramientas personalizadas

Las herramientas personalizadas son funciones invocables por el modelo que se integran en el mismo pipeline de ejecución de herramientas que las herramientas incorporadas.

Una herramienta personalizada es un módulo TypeScript/JavaScript que exporta una factoría. La factoría recibe una API del host (`CustomToolAPI`) y devuelve una herramienta o un array de herramientas.

## Qué es esto (y qué no es)

- **Herramienta personalizada**: invocable por el modelo durante un turno (`execute` + esquema TypeBox).
- **Extensión**: framework de ciclo de vida/eventos que puede registrar herramientas e interceptar/modificar eventos.
- **Hook**: scripts externos de pre/post comando.
- **Skill**: paquete estático de guía/contexto, no código de herramienta ejecutable.

Si necesita que el modelo invoque código directamente, utilice una herramienta personalizada.

## Rutas de integración en el código actual

Existen dos estilos de integración activos:

1. **Herramientas personalizadas proporcionadas por el SDK** (`options.customTools`)
   - Envueltas en herramientas del agente a través de `CustomToolAdapter` o wrappers de extensión.
   - Siempre incluidas en el conjunto inicial de herramientas activas en el bootstrap del SDK.

2. **Módulos descubiertos en el sistema de archivos a través de la API del loader** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Expuestas como APIs de biblioteca en `src/extensibility/custom-tools/loader.ts`.
   - El código del host puede invocarlas para descubrir y cargar módulos de herramientas desde rutas de configuración/proveedor/plugin.

```text
Model tool call flow

LLM tool call
   │
   ▼
Tool registry (built-ins + custom tool adapters)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> streamed partial result
   └─ return result  -> final tool content/details
```

## Ubicaciones de descubrimiento (API del loader)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` fusiona:

1. Proveedores de capacidades (`toolCapability`), incluyendo:
   - Configuración nativa OMP (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configuración Claude (`~/.claude/tools`, `.claude/tools`)
   - Configuración Codex (`~/.codex/tools`, `.codex/tools`)
   - Proveedor de caché de plugins del marketplace de Claude
2. Manifiestos de plugins instalados (`~/.xcsh/plugins/node_modules/*` a través del plugin loader)
3. Rutas configuradas explícitamente pasadas al loader

### Comportamiento importante

- Las rutas resueltas duplicadas se deduplicen.
- Los conflictos de nombres de herramientas se rechazan frente a las incorporadas y las herramientas personalizadas ya cargadas.
- Los archivos `.md` y `.json` son descubiertos como metadatos de herramientas por algunos proveedores, pero el loader de módulos ejecutables los rechaza como herramientas ejecutables.
- Las rutas configuradas relativas se resuelven desde `cwd`; `~` se expande.

## Contrato del módulo

Un módulo de herramienta personalizada debe exportar una función (se prefiere export default):

```ts
import type { CustomToolFactory } from "@f5xc-salesdemos/xcsh";

const factory: CustomToolFactory = (pi) => ({
 name: "repo_stats",
 label: "Repo Stats",
 description: "Counts tracked TypeScript files",
 parameters: pi.typebox.Type.Object({
  glob: pi.typebox.Type.Optional(pi.typebox.Type.String({ default: "**/*.ts" })),
 }),

 async execute(toolCallId, params, onUpdate, ctx, signal) {
  onUpdate?.({
   content: [{ type: "text", text: "Scanning files..." }],
   details: { phase: "scan" },
  });

  const result = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
  if (result.killed) {
   throw new Error("Scan was cancelled");
  }
  if (result.code !== 0) {
   throw new Error(result.stderr || "git ls-files failed");
  }

  const files = result.stdout.split("\n").filter(Boolean);
  return {
   content: [{ type: "text", text: `Found ${files.length} files` }],
   details: { count: files.length, sample: files.slice(0, 10) },
  };
 },

 onSession(event) {
  if (event.reason === "shutdown") {
   // cleanup resources if needed
  }
 },
});

export default factory;
```

Tipo de retorno de la factoría:

- `CustomTool`
- `CustomTool[]`
- `Promise<CustomTool | CustomTool[]>`

## Superficie de API pasada a las factorías (`CustomToolAPI`)

Desde `types.ts` y `loader.ts`:

- `cwd`: directorio de trabajo del host
- `exec(command, args, options?)`: helper de ejecución de procesos
- `ui`: contexto de UI (puede ser no-op en modos headless)
- `hasUI`: `false` en flujos no interactivos
- `logger`: logger de archivo compartido
- `typebox`: `@sinclair/typebox` inyectado
- `pi`: exports de `@f5xc-salesdemos/xcsh` inyectados
- `pushPendingAction(action)`: registra una acción de vista previa para la herramienta oculta `resolve` (`docs/resolve-tool-runtime.md`)

El loader comienza con un contexto de UI no-op y requiere que el código del host invoque `setUIContext(...)` cuando la UI real esté lista.

## Contrato de ejecución y tipado

Firma de `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` está tipado estáticamente desde su esquema TypeBox a través de `Static<TParams>`.
- La validación de argumentos en tiempo de ejecución ocurre antes de la ejecución en el bucle del agente.
- `onUpdate` emite resultados parciales para streaming en la UI.
- `ctx` incluye estado de sesión/modelo y un helper `abort()`.
- `signal` transporta la cancelación.

`CustomToolAdapter` conecta esto con la interfaz de herramientas del agente y reenvía las llamadas en el orden correcto de argumentos.

## Cómo se exponen las herramientas al modelo

- Las herramientas se envuelven en instancias de `AgentTool` (`CustomToolAdapter` o wrappers de extensión).
- Se insertan en el registro de herramientas de la sesión por nombre.
- En el bootstrap del SDK, las herramientas personalizadas y las registradas por extensiones se incluyen forzosamente en el conjunto activo inicial.
- `--tools` en CLI actualmente valida solo nombres de herramientas incorporadas; la inclusión de herramientas personalizadas se gestiona a través de las rutas de descubrimiento/registro y las opciones del SDK.

## Hooks de renderizado

Hooks de renderizado opcionales:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportamiento en tiempo de ejecución en la TUI:

- Si los hooks existen, la salida de la herramienta se renderiza dentro de un contenedor `Box`.
- `renderResult` recibe `{ expanded, isPartial, spinnerFrame? }`.
- Los errores del renderer se capturan y registran; la UI recurre al renderizado de texto por defecto.

## Manejo de sesión/estado

El opcional `onSession(event, ctx)` recibe eventos del ciclo de vida de la sesión, incluyendo:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Utilice `ctx.sessionManager` para reconstruir el estado desde el historial cuando cambie el contexto de rama/sesión.

## Semántica de fallos y cancelación

### Fallos síncronos/asíncronos

- Lanzar excepciones (o promesas rechazadas) en `execute` se trata como fallo de herramienta.
- El runtime del agente convierte los fallos en mensajes de resultado de herramienta con `isError: true` y contenido de texto de error.
- Con wrappers de extensión, los handlers de `tool_result` pueden reescribir adicionalmente el contenido/detalles e incluso sobreescribir el estado de error.

### Cancelación

- La cancelación del agente se propaga a través de `AbortSignal` hasta `execute`.
- Reenvíe `signal` al trabajo de subprocesos (`pi.exec(..., { signal })`) para cancelación cooperativa.
- `ctx.abort()` permite que una herramienta solicite la cancelación de la operación actual del agente.

### Errores en onSession

- Los errores de `onSession` se capturan y registran como advertencias; no hacen fallar la sesión.

## Restricciones reales para tener en cuenta en el diseño

- Los nombres de herramientas deben ser globalmente únicos en el registro activo.
- Prefiera salidas determinísticas con forma de esquema en `details` para la reconstrucción del renderer/estado.
- Proteja el uso de la UI con `pi.hasUI`.
- Trate los archivos `.md`/`.json` en directorios de herramientas como metadatos, no como módulos ejecutables.
