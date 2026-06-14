---
title: Extensiones de manifiesto Gemini
description: >-
  Formato de extensión de manifiesto Gemini para compatibilidad de habilidades y
  agentes entre plataformas.
sidebar:
  order: 7
  label: Manifiesto Gemini
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensiones de manifiesto Gemini (`gemini-extension.json`)

Este documento cubre cómo el agente de codificación descubre y analiza las extensiones de manifiesto de estilo Gemini (`gemini-extension.json`) en la capacidad `extensions`.

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

El proveedor Gemini (`id: gemini`, prioridad `60`) registra un cargador de `extensions` que escanea dos raíces fijas:

- Usuario: `~/.gemini/extensions`
- Proyecto: `<cwd>/.gemini/extensions`

La resolución de rutas se realiza directamente desde `ctx.home` y `ctx.cwd` mediante `getUserPath()` / `getProjectPath()`.

Regla de alcance importante: la búsqueda de proyecto es **solo en cwd**. No recorre directorios padre.

---

## Reglas de escaneo de directorios

Para cada raíz (`~/.gemini/extensions` y `<cwd>/.gemini/extensions`), el descubrimiento realiza:

1. `readDirEntries(root)`
2. conserva solo los directorios hijo directos (`entry.isDirectory()`)
3. para cada hijo `<name>`, intenta leer exactamente:
   - `<root>/<name>/gemini-extension.json`

No existe un escaneo recursivo más allá de un nivel de directorio.

### Directorios ocultos

El descubrimiento de manifiestos Gemini **no** filtra los nombres de directorio con prefijo de punto. Si existe un directorio hijo oculto que contiene `gemini-extension.json`, se considera.

### Archivos faltantes o ilegibles

Si `gemini-extension.json` falta o no se puede leer, ese directorio se omite silenciosamente (sin advertencia).

---

## Estructura del manifiesto (según implementación)

El tipo de capacidad define esta estructura de manifiesto:

```ts
interface ExtensionManifest {
 name?: string;
 description?: string;
 mcpServers?: Record<string, Omit<MCPServer, "name" | "_source">>;
 tools?: unknown[];
 context?: unknown;
}
```

El comportamiento en tiempo de descubrimiento es intencionalmente flexible:

- Se requiere que el análisis de JSON sea exitoso.
- No existe validación de esquema en tiempo de ejecución para tipos/contenido de campos más allá de la sintaxis JSON.
- El objeto analizado se almacena como `manifest` en el elemento de capacidad.

### Normalización de nombre

`Extension.name` se establece en:

1. `manifest.name` si no es `null`/`undefined`
2. de lo contrario, el nombre del directorio de extensión

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
- La validación de capacidad a nivel de registro para `extensions` solo verifica la presencia de `name` y `path`.
- Los elementos internos del manifiesto (`mcpServers`, `tools`, `context`) no se validan durante el descubrimiento.

---

## Manejo de errores y semántica de advertencias

### Advertido

- JSON no válido en un archivo de manifiesto:
  - formato de advertencia: `Invalid JSON in <manifestPath>`

### No advertido (omisión silenciosa)

- Directorio `extensions` faltante
- El directorio hijo no tiene `gemini-extension.json`
- Archivo de manifiesto ilegible
- El JSON del manifiesto es sintácticamente válido pero semánticamente extraño/incompleto

Esto significa que la validez parcial es aceptada: solo el fallo sintáctico de JSON emite una advertencia.

---

## Precedencia y deduplicación con otras fuentes

La capacidad `extensions` se agrega entre proveedores por el registro de capacidades.

Proveedores actuales para esta capacidad:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridad `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridad `60`

La clave de deduplicación es `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedencia entre proveedores

El proveedor de mayor prioridad gana en nombres de extensión duplicados.

- Si `native` y `gemini` emiten ambos el nombre de extensión `foo`, se conserva el elemento nativo.
- El duplicado de menor prioridad se retiene solo en `result.all` con `_shadowed = true`.

### Efectos de orden dentro del proveedor

Dado que la deduplicación funciona con "el primero visto gana", el orden de los elementos locales del proveedor importa.

- El cargador Gemini añade primero el **usuario** y luego el **proyecto**.
- Por lo tanto, los nombres duplicados entre `~/.gemini/extensions` y `<cwd>/.gemini/extensions` conservan la entrada de usuario y ocultan la entrada de proyecto.

Por el contrario, el proveedor nativo construye el orden de los directorios de configuración de manera diferente (`project` luego `user` en `getConfigDirs()`), por lo que la ocultación intra-proveedor nativa sigue la dirección opuesta.

---

## Resumen del comportamiento usuario vs. proyecto

Para los manifiestos Gemini específicamente:

- Ambas raíces, de usuario y de proyecto, se escanean en cada carga.
- La raíz del proyecto está fijada a `<cwd>/.gemini/extensions` (sin recorrido de ancestros).
- Los nombres duplicados dentro de la fuente Gemini se resuelven con el usuario primero.
- Los nombres duplicados frente a proveedores de mayor prioridad (principalmente nativos) pierden por prioridad.

---

## Límite: metadatos de descubrimiento vs. carga de extensiones en tiempo de ejecución

El descubrimiento de `gemini-extension.json` actualmente alimenta los metadatos de capacidad (elementos `Extension`). **No** carga directamente módulos de extensión TS/JS ejecutables.

La carga de módulos en tiempo de ejecución (`discoverAndLoadExtensions()` / `loadExtensions()`) utiliza `extension-modules` y rutas explícitas, y actualmente filtra los módulos autodescubiertos solo al proveedor `native`.

Implicación práctica:

- Las extensiones de manifiesto Gemini son detectables como registros de capacidad.
- Por sí mismas, no son ejecutadas como módulos de extensión en tiempo de ejecución por la canalización del cargador de extensiones.

Este límite es intencional en la implementación actual y explica por qué el descubrimiento de manifiestos y la carga de módulos ejecutables pueden divergir.
