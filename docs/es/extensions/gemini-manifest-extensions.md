---
title: Gemini Manifest Extensions
description: >-
  Formato de extensión de manifiesto Gemini para compatibilidad multiplataforma
  de habilidades y agentes.
sidebar:
  order: 7
  label: Gemini manifest
i18n:
  sourceHash: 7134165a5f6d
  translator: machine
---

# Extensiones de Manifiesto Gemini (`gemini-extension.json`)

Este documento cubre cómo el coding-agent descubre y analiza las extensiones de manifiesto estilo Gemini (`gemini-extension.json`) en la capacidad `extensions`.

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

La resolución de rutas es directa desde `ctx.home` y `ctx.cwd` mediante `getUserPath()` / `getProjectPath()`.

Regla de alcance importante: la búsqueda del proyecto es **solo cwd**. No recorre directorios padre.

---

## Reglas de escaneo de directorios

Para cada raíz (`~/.gemini/extensions` y `<cwd>/.gemini/extensions`), el descubrimiento realiza:

1. `readDirEntries(root)`
2. mantiene solo los directorios hijos directos (`entry.isDirectory()`)
3. para cada hijo `<name>`, intenta leer exactamente:
   - `<root>/<name>/gemini-extension.json`

No hay escaneo recursivo más allá de un nivel de directorio.

### Directorios ocultos

El descubrimiento de manifiestos Gemini **no** filtra los nombres de directorio con prefijo de punto. Si existe un directorio hijo oculto y contiene `gemini-extension.json`, se considera.

### Archivos faltantes/ilegibles

Si `gemini-extension.json` falta o no se puede leer, ese directorio se omite silenciosamente (sin advertencia).

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

El comportamiento en tiempo de descubrimiento es intencionalmente flexible:

- Se requiere que el análisis JSON sea exitoso.
- No hay validación de esquema en tiempo de ejecución para tipos/contenido de campos más allá de la sintaxis JSON.
- El objeto analizado se almacena como `manifest` en el elemento de capacidad.

### Normalización del nombre

`Extension.name` se establece como:

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
- La validación de capacidad a nivel de registro para `extensions` solo verifica la presencia de `name` y `path`.
- Los internos del manifiesto (`mcpServers`, `tools`, `context`) no se validan durante el descubrimiento.

---

## Manejo de errores y semántica de advertencias

### Con advertencia

- JSON inválido en un archivo de manifiesto:
  - formato de advertencia: `Invalid JSON in <manifestPath>`

### Sin advertencia (omisión silenciosa)

- Directorio `extensions` faltante
- El directorio hijo no tiene `gemini-extension.json`
- Archivo de manifiesto ilegible
- El JSON del manifiesto es sintácticamente válido pero semánticamente extraño/incompleto

Esto significa que se acepta validez parcial: solo un fallo sintáctico de JSON emite una advertencia.

---

## Precedencia y deduplicación con otras fuentes

La capacidad `extensions` se agrega entre proveedores mediante el registro de capacidades.

Proveedores actuales para esta capacidad:

- `native` (`packages/coding-agent/src/discovery/builtin.ts`) prioridad `100`
- `gemini` (`packages/coding-agent/src/discovery/gemini.ts`) prioridad `60`

La clave de deduplicación es `ext.name` (`extensionCapability.key = ext => ext.name`).

### Precedencia entre proveedores

El proveedor de mayor prioridad gana en nombres de extensión duplicados.

- Si tanto `native` como `gemini` emiten una extensión con nombre `foo`, se conserva el elemento de native.
- El duplicado de menor prioridad se retiene solo en `result.all` con `_shadowed = true`.

### Efectos del orden intra-proveedor

Dado que la deduplicación funciona con "el primero visto gana", el orden local de elementos del proveedor importa.

- El cargador Gemini agrega **primero usuario**, luego **proyecto**.
- Por lo tanto, los nombres duplicados entre `~/.gemini/extensions` y `<cwd>/.gemini/extensions` conservan la entrada de usuario y ensombrecen la entrada del proyecto.

Por contraste, el proveedor native construye el orden de directorios de configuración de manera diferente (`project` luego `user` en `getConfigDirs()`), por lo que el ensombrecimiento intra-proveedor de native va en dirección opuesta.

---

## Resumen del comportamiento usuario vs proyecto

Para manifiestos Gemini específicamente:

- Ambas raíces, usuario y proyecto, se escanean en cada carga.
- La raíz del proyecto está fijada a `<cwd>/.gemini/extensions` (sin recorrido de ancestros).
- Los nombres duplicados dentro de la fuente Gemini se resuelven dando prioridad al usuario.
- Los nombres duplicados contra proveedores de mayor prioridad (notablemente native) pierden por prioridad.

---

## Límite: metadatos de descubrimiento vs carga de extensiones en tiempo de ejecución

El descubrimiento de `gemini-extension.json` actualmente alimenta metadatos de capacidad (elementos `Extension`). **No** carga directamente módulos de extensión TS/JS ejecutables.

La carga de módulos en tiempo de ejecución (`discoverAndLoadExtensions()` / `loadExtensions()`) usa `extension-modules` y rutas explícitas, y actualmente filtra los módulos auto-descubiertos solo para el proveedor `native`.

Implicación práctica:

- Las extensiones de manifiesto Gemini son descubribles como registros de capacidad.
- Por sí mismas, no son ejecutadas como módulos de extensión en tiempo de ejecución por el pipeline del cargador de extensiones.

Este límite es intencional en la implementación actual y explica por qué el descubrimiento de manifiestos y la carga de módulos ejecutables pueden divergir.
