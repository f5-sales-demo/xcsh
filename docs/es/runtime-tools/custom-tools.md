---
title: Herramientas Personalizadas
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

# Herramientas Personalizadas

Las herramientas personalizadas son funciones invocables por el modelo que se integran en el mismo pipeline de ejecución de herramientas que las herramientas incorporadas.

Una herramienta personalizada es un módulo TypeScript/JavaScript que exporta una factoría. La factoría recibe una API del host (`CustomToolAPI`) y retorna una herramienta o un arreglo de herramientas.

## Qué es esto (y qué no es)

- **Herramienta personalizada**: invocable por el modelo durante un turno (`execute` + esquema TypeBox).
- **Extensión**: framework de ciclo de vida/eventos que puede registrar herramientas e interceptar/modificar eventos.
- **Hook**: scripts externos de pre/post comando.
- **Skill**: paquete estático de guía/contexto, no código de herramienta ejecutable.

Si necesita que el modelo invoque código directamente, use una herramienta personalizada.

## Rutas de integración en el código actual

Existen dos estilos de integración activos:

1. **Herramientas personalizadas proporcionadas por el SDK** (`options.customTools`)
   - Envueltas en herramientas del agente mediante `CustomToolAdapter` o wrappers de extensión.
   - Siempre incluidas en el conjunto inicial de herramientas activas durante el bootstrap del SDK.

2. **Módulos descubiertos en el sistema de archivos mediante la API del cargador** (`discoverAndLoadCustomTools` / `loadCustomTools`)
   - Expuestas como APIs de biblioteca en `src/extensibility/custom-tools/loader.ts`.
   - El código del host puede invocarlas para descubrir y cargar módulos de herramientas desde rutas de configuración/proveedor/plugin.

```text
Flujo de invocación de herramientas del modelo

Invocación de herramienta por el LLM
   │
   ▼
Registro de herramientas (incorporadas + adaptadores de herramientas personalizadas)
   │
   ▼
CustomTool.execute(toolCallId, params, onUpdate, ctx, signal)
   │
   ├─ onUpdate(...)  -> resultado parcial transmitido
   └─ return result  -> contenido/detalles finales de la herramienta
```

## Ubicaciones de descubrimiento (API del cargador)

`discoverAndLoadCustomTools(configuredPaths, cwd, builtInToolNames)` fusiona:

1. Proveedores de capacidad (`toolCapability`), incluyendo:
   - Configuración nativa OMP (`~/.xcsh/agent/tools`, `.xcsh/tools`)
   - Configuración de Claude (`~/.claude/tools`, `.claude/tools`)
   - Configuración de Codex (`~/.codex/tools`, `.codex/tools`)
   - Proveedor de caché de plugins del marketplace de Claude
2. Manifiestos de plugins instalados (`~/.xcsh/plugins/node_modules/*` mediante el cargador de plugins)
3. Rutas configuradas explícitas pasadas al cargador

### Comportamiento importante

- Las rutas resueltas duplicadas se deduplicar.
- Los conflictos de nombres de herramientas se rechazan contra las incorporadas y las herramientas personalizadas ya cargadas.
- Los archivos `.md` y `.json` son descubiertos como metadatos de herramientas por algunos proveedores, pero el cargador de módulos ejecutables los rechaza como herramientas ejecutables.
- Las rutas configuradas relativas se resuelven desde `cwd`; `~` se expande.

## Contrato del módulo

Un módulo de herramienta personalizada debe exportar una función (se prefiere la exportación por defecto):

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
- `logger`: logger compartido de archivos
- `typebox`: `@sinclair/typebox` inyectado
- `pi`: exportaciones de `@f5xc-salesdemos/xcsh` inyectadas
- `pushPendingAction(action)`: registrar una acción de vista previa para la herramienta oculta `resolve` (`docs/resolve-tool-runtime.md`)

El cargador comienza con un contexto de UI no-op y requiere que el código del host invoque `setUIContext(...)` cuando la UI real esté lista.

## Contrato de ejecución y tipado

Firma de `CustomTool.execute`:

```ts
execute(toolCallId, params, onUpdate, ctx, signal)
```

- `params` está tipado estáticamente desde su esquema TypeBox mediante `Static<TParams>`.
- La validación de argumentos en tiempo de ejecución ocurre antes de la ejecución en el bucle del agente.
- `onUpdate` emite resultados parciales para la transmisión en la UI.
- `ctx` incluye el estado de sesión/modelo y un helper `abort()`.
- `signal` transporta la cancelación.

`CustomToolAdapter` conecta esto con la interfaz de herramientas del agente y reenvía las invocaciones en el orden correcto de argumentos.

## Cómo se exponen las herramientas al modelo

- Las herramientas se envuelven en instancias de `AgentTool` (`CustomToolAdapter` o wrappers de extensión).
- Se insertan en el registro de herramientas de la sesión por nombre.
- En el bootstrap del SDK, las herramientas personalizadas y las registradas por extensiones se incluyen forzosamente en el conjunto activo inicial.
- `--tools` en CLI actualmente valida solo nombres de herramientas incorporadas; la inclusión de herramientas personalizadas se maneja a través de las rutas de descubrimiento/registro y las opciones del SDK.

## Hooks de renderizado

Hooks de renderizado opcionales:

- `renderCall(args, theme)`
- `renderResult(result, options, theme, args?)`

Comportamiento en tiempo de ejecución en TUI:

- Si los hooks existen, la salida de la herramienta se renderiza dentro de un contenedor `Box`.
- `renderResult` recibe `{ expanded, isPartial, spinnerFrame? }`.
- Los errores del renderizador se capturan y registran; la UI recurre al renderizado de texto por defecto.

## Manejo de sesión/estado

El método opcional `onSession(event, ctx)` recibe eventos del ciclo de vida de la sesión, incluyendo:

- `start`, `switch`, `branch`, `tree`, `shutdown`
- `auto_compaction_start`, `auto_compaction_end`
- `auto_retry_start`, `auto_retry_end`
- `ttsr_triggered`, `todo_reminder`

Use `ctx.sessionManager` para reconstruir el estado desde el historial cuando cambie el contexto de rama/sesión.

## Semánticas de fallos y cancelación

### Fallos síncronos/asíncronos

- Lanzar excepciones (o promesas rechazadas) en `execute` se trata como fallo de la herramienta.
- El runtime del agente convierte los fallos en mensajes de resultado de herramienta con `isError: true` y contenido de texto del error.
- Con wrappers de extensión, los manejadores de `tool_result` pueden reescribir adicionalmente contenido/detalles e incluso anular el estado de error.

### Cancelación

- La cancelación del agente se propaga a través de `AbortSignal` hacia `execute`.
- Reenvíe `signal` al trabajo de subprocesos (`pi.exec(..., { signal })`) para cancelación cooperativa.
- `ctx.abort()` permite que una herramienta solicite la cancelación de la operación actual del agente.

### Errores de onSession

- Los errores de `onSession` se capturan y registran como advertencias; no provocan el fallo de la sesión.

## Restricciones reales a considerar en el diseño

- Los nombres de herramientas deben ser globalmente únicos en el registro activo.
- Prefiera salidas deterministas con forma de esquema en `details` para la reconstrucción del renderizador/estado.
- Proteja el uso de la UI con `pi.hasUI`.
- Trate los archivos `.md`/`.json` en directorios de herramientas como metadatos, no como módulos ejecutables.
