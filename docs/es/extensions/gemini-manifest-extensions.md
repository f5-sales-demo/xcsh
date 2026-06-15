---
title: Extensiones de manifiesto Gemini
description: >-
  Formato de extensiones de manifiesto Gemini para compatibilidad entre
  plataformas de habilidades y agentes.
sidebar:
  order: 7
  label: Manifiesto Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensiones de manifiesto Gemini (`gemini-extension.json`)

Este documento describe cómo el agente de codificación descubre y analiza las extensiones de manifiesto de estilo Gemini (`gemini-extension.json`) en la capacidad `extensions`.

**No** cubre la carga de módulos de extensión TypeScript/JavaScript (`extensions/*.ts`, `index.ts`, `package.json xcsh.extensions`), que está documentada en `extension-loading.md`.

## Archivos de implementación

- [`../src/discovery/gemini.ts`](../../packages/coding-agent/src/discovery/gemini.ts)
- [`../src/discovery/builtin.ts`](../../packages/coding-agent/src/discovery/builtin.ts)
- [`../src/discovery/helpers.ts`](../../packages/coding-agent/src/discovery/helpers.ts)
- [`../src/capability/extension.ts`](../../packages/coding-agent/src/capability/extension.ts)
- [`../src/capability/index.ts`](../../packages/coding-agent/src/capability/index.ts)
- [`../src/extensibility/extensions/loader.ts`](../../packages/coding-agent/src/extensibility/extensions/loader.ts)

---

## Qué se descubre

El proveedor Gemini (`id: gemini`, prioridad `60`) registra un cargador `extensions` que analiza dos raíces fijas:

- Usuario: `~/.gemini/extensions`
- Proyecto: `<cwd>/.gemini/extensions`

La resolución de rutas se realiza directamente desde `ctx.home` y `ctx.cwd` a través de `getUserPath()` / `getProjectPath()`.

Regla de ámbito importante: la búsqueda del proyecto es **solo cwd**. No recorre los directorios padre.

---

## Reglas de análisis de directorios

Para cada raíz (`~/.gemini/extensions` y `<cwd>/.gemini/extensions`), el proceso de descubrimiento realiza:

1. `readDirEntries(root)`
2. conserva solo los subdirectorios directos (`entry.isDirectory()`)
3. para cada hijo `<name>`, intenta leer exactamente:
   - `<root>/<name>/gemini-extension.json`

No existe análisis recursivo más allá de un nivel de directorio.

### Directorios ocultos

El descubrimiento de manifiestos Gemini **no** filtra los nombres de directorio con prefijo de punto. Si existe un subdirectorio oculto que contiene `gemini-extension.json`, se considera.

### Archivos faltantes o ilegibles

Si `gemini-extension.json` no existe o no puede leerse, ese directorio se omite silenciosamente (sin advertencia).

---

## Forma del manifiesto (según implementación)

El tipo de capacidad define esta forma de manifiesto:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

El comportamiento durante el descubrimiento es deliberadamente flexible:

- Se requiere que el análisis JSON sea exitoso.
- No hay validación de esquema en tiempo de ejecución para tipos/contenido de campos más allá de la sintaxis JSON.
- El objeto analizado se almacena como `manifest` en el elemento de capacidad.

### Normalización del nombre

`Extension.name` se establece en:

1. `manifest.name` si no es `null`/`undefined`
2. de lo contrario, el nombre del directorio de la extensión

No se aplica ninguna verificación de tipo de cadena aquí.

---

## Materialización en elementos de capacidad

Un manifiesto analizado válido crea un elemento de capacidad `Extension`:

```ts
{
 name: manifest.name ?? <directory-name>,
 path: <extension-directory>,
 manifest: <parsed-json>,
 level: "user" | "project",
 _source: {
  provider: "gemini",
  providerName: "Gemini CLI" // adjuntado por el registro de capacidades
  path: <absolute-manifest-path>,
  level: "user" | "project"
 }
}
```

Notas:

- `_source.path` se normaliza a una ruta absoluta mediante `createSourceMeta()`.
- La validación de capacidades a nivel de registro para `extensions` solo verifica la presencia de `name` y `path`.
- Los elementos internos del manifiesto (`mcpServers`, `tools`, `context`) no se validan durante el descubrimiento.

---

## Manejo de errores y semántica de advertencias

### Con advertencia

- JSON no válido en un archivo de manifiesto:
  - formato de advertencia: `Invalid JSON in <manifestPath>`

### Sin advertencia (omisión silenciosa)

- directorio `extensions` inexistente
- el subdirectorio no tiene `gemini-extension.json`
- archivo de manifiesto ilegible
- el JSON del manifiesto es sintácticamente válido pero semánticamente inusual/incompleto

Esto significa que se acepta validez parcial: solo el fallo sintáctico de JSON emite una advertencia.

---

## Precedencia y deduplicación con otras fuentes

La capacidad `extensions` se agrega entre proveedores mediante el registro de capacidades.

Proveedores actuales para esta capacidad:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridad `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridad `60`

La clave de deduplicación es `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedencia entre proveedores

El proveedor de mayor prioridad prevalece ante nombres de extensión duplicados.

- Si tanto `native` como `gemini` emiten el nombre de extensión `foo`, se conserva el elemento nativo.
- El duplicado de menor prioridad se retiene únicamente en `result.all` con `_shadowed = true`.

### Efectos del orden dentro del mismo proveedor

Dado que la deduplicación funciona con el principio de "primer elemento visto gana", el orden de los elementos locales del proveedor importa.

- El cargador Gemini añade primero los de **usuario** y luego los de **proyecto**.
- Por lo tanto, los nombres duplicados entre `~/.gemini/extensions` y `<cwd>/.gemini/extensions` conservan la entrada del usuario y proyectan sombra sobre la entrada del proyecto.

Por el contrario, el proveedor nativo construye el orden de directorio de configuración de manera diferente (`project` antes que `user` en `getConfigDirs()`), por lo que la proyección de sombra interna del proveedor nativo funciona en dirección opuesta.

---

## Resumen del comportamiento usuario vs. proyecto

Para los manifiestos Gemini específicamente:

- Ambas raíces, de usuario y de proyecto, se analizan en cada carga.
- La raíz del proyecto está fija en `<cwd>/.gemini/extensions` (sin recorrido de directorios ancestros).
- Los nombres duplicados dentro de la fuente Gemini se resuelven dando prioridad al usuario.
- Los nombres duplicados frente a proveedores de mayor prioridad (especialmente el nativo) pierden por prioridad.

---

## Límite: metadatos de descubrimiento vs. carga de extensiones en tiempo de ejecución

El descubrimiento de `gemini-extension.json` actualmente alimenta los metadatos de capacidad (elementos `Extension`). **No** carga directamente módulos de extensión TS/JS ejecutables.

La carga de módulos en tiempo de ejecución (`discoverAndLoadExtensions()` / `loadExtensions()`) utiliza `extension-modules` y rutas explícitas, y actualmente filtra los módulos autodescubiertos al proveedor `native` únicamente.

Implicación práctica:

- Las extensiones de manifiesto Gemini son detectables como registros de capacidad.
- Por sí mismas, no son ejecutadas como módulos de extensión en tiempo de ejecución por el pipeline del cargador de extensiones.

Este límite es intencional en la implementación actual y explica por qué el descubrimiento de manifiestos y la carga de módulos ejecutables pueden divergir.
